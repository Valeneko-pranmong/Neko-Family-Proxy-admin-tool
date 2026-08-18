#!/usr/bin/env python3
"""
Neko Family Proxy — Japan VPS Server Monitoring Agent (Phase T4B)
Observational aggregate metrics collector for Japan VPS infrastructure.

Privacy Boundary:
- Collects exclusively VPS-level aggregate metrics (host uptime, whole-interface traffic,
  Shadowsocks daemon health, local listener state, upstream latency probe).
- NEVER collects or transmits client telemetry, user identifiers, packet payloads,
  destination hosts/IPs, or proxy credentials.
"""

import os
import sys
import time
import json
import socket
import subprocess
import urllib.request
import urllib.error
import re
from datetime import datetime, timezone

# -----------------------------------------------------------------------------
# Configuration Authority (Environment / Systemd Driven)
# -----------------------------------------------------------------------------

def get_env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()

def get_env_int(name: str, default: int) -> int:
    try:
        val = os.environ.get(name, "").strip()
        return int(val) if val else default
    except ValueError:
        return default

SERVER_ID = get_env_str("SERVER_ID", "japan-vps-1").lower()
INGEST_URL = get_env_str("INGEST_URL", "")
INGEST_SECRET = get_env_str("SERVER_METRICS_INGEST_SECRET", "")
UPSTREAM_MONITOR_TARGET = get_env_str("UPSTREAM_MONITOR_TARGET", "")
NETWORK_INTERFACE = get_env_str("NETWORK_INTERFACE", "")
SHADOWSOCKS_SYSTEMD_UNIT = get_env_str("SHADOWSOCKS_SYSTEMD_UNIT", "shadowsocks-libev")
SHADOWSOCKS_LOCAL_HOST = get_env_str("SHADOWSOCKS_LOCAL_HOST", "127.0.0.1")
SHADOWSOCKS_LOCAL_PORT = get_env_int("SHADOWSOCKS_LOCAL_PORT", 8388)
SAMPLE_CADENCE_SECONDS = max(5, min(10, get_env_int("SAMPLE_CADENCE_SECONDS", 5)))
PING_CADENCE_SECONDS = max(15, get_env_int("PING_CADENCE_SECONDS", 30))

# -----------------------------------------------------------------------------
# System & Network Inspection Helpers
# -----------------------------------------------------------------------------

def discover_default_interface() -> str:
    """Discover configured or default route network interface."""
    if NETWORK_INTERFACE:
        return NETWORK_INTERFACE

    # 1. Try reading /proc/net/route for default route (dest 00000000)
    try:
        if os.path.exists("/proc/net/route"):
            with open("/proc/net/route", "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines[1:]:
                parts = line.strip().split()
                if len(parts) >= 2 and parts[1] == "00000000":
                    iface = parts[0]
                    if iface and iface != "lo":
                        return iface
    except Exception:
        pass

    # 2. Try parsing `ip route show default`
    try:
        proc = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False
        )
        if proc.returncode == 0 and proc.stdout:
            match = re.search(r"\bdev\s+(\S+)", proc.stdout)
            if match:
                return match.group(1)
    except Exception:
        pass

    # 3. Fallback: inspect /proc/net/dev for first non-loopback interface
    try:
        if os.path.exists("/proc/net/dev"):
            with open("/proc/net/dev", "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines[2:]:
                iface = line.split(":")[0].strip()
                if iface and iface != "lo":
                    return iface
    except Exception:
        pass

    return "eth0"


def read_interface_bytes(iface: str) -> tuple[int, int]:
    """Read cumulative (rx_bytes, tx_bytes) for the given interface."""
    # Method A: /proc/net/dev
    try:
        if os.path.exists("/proc/net/dev"):
            with open("/proc/net/dev", "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines[2:]:
                parts = line.split(":")
                if len(parts) == 2 and parts[0].strip() == iface:
                    fields = parts[1].split()
                    if len(fields) >= 9:
                        rx = int(fields[0])
                        tx = int(fields[8])
                        return (max(0, rx), max(0, tx))
    except Exception:
        pass

    # Method B: sysfs /sys/class/net/<iface>/statistics/
    rx_path = f"/sys/class/net/{iface}/statistics/rx_bytes"
    tx_path = f"/sys/class/net/{iface}/statistics/tx_bytes"
    try:
        if os.path.exists(rx_path) and os.path.exists(tx_path):
            with open(rx_path, "r", encoding="utf-8") as f:
                rx = int(f.read().strip())
            with open(tx_path, "r", encoding="utf-8") as f:
                tx = int(f.read().strip())
            return (max(0, rx), max(0, tx))
    except Exception:
        pass

    return (0, 0)


def read_host_uptime() -> int:
    """Read host uptime in seconds from /proc/uptime."""
    try:
        if os.path.exists("/proc/uptime"):
            with open("/proc/uptime", "r", encoding="utf-8") as f:
                val = f.read().split()[0]
                return max(0, int(float(val)))
    except Exception:
        pass
    return 0


def check_shadowsocks_service(unit_name: str) -> str:
    """Check systemd service status (active/inactive/failed/unknown)."""
    if not unit_name:
        return "unknown"
    try:
        proc = subprocess.run(
            ["systemctl", "is-active", unit_name],
            capture_output=True,
            text=True,
            timeout=3,
            check=False
        )
        status = proc.stdout.strip().lower()
        if status in ("active", "inactive", "failed"):
            return status
        if proc.returncode != 0:
            if "inactive" in status:
                return "inactive"
            if "failed" in status:
                return "failed"
        return "unknown"
    except FileNotFoundError:
        # Non-systemd system
        return "unknown"
    except Exception:
        return "unknown"


def check_shadowsocks_listener(host: str, port: int) -> str:
    """Probe local TCP socket listener (listening/closed/error/unknown)."""
    if not port or port <= 0:
        return "unknown"
    try:
        with socket.create_connection((host, port), timeout=1.0) as sock:
            return "listening"
    except ConnectionRefusedError:
        return "closed"
    except (socket.timeout, OSError):
        return "error"
    except Exception:
        return "unknown"


def probe_upstream_ping(target: str) -> tuple[str, float | None, float | None]:
    """
    Run bounded ICMP probe to target.
    Returns (status, avg_ping_ms, packet_loss_percent).
    Status in: 'AVAILABLE', 'TIMEOUT', 'UNSUPPORTED', 'UNKNOWN'.
    """
    if not target:
        return ("UNKNOWN", None, None)

    try:
        # Send 5 packets with 1 second timeout per packet (bounded burst)
        proc = subprocess.run(
            ["ping", "-c", "5", "-W", "1", target],
            capture_output=True,
            text=True,
            timeout=8,
            check=False
        )
        output = proc.stdout

        # Parse packet loss: e.g. "0% packet loss" or "100% packet loss"
        loss_match = re.search(r"(\d+(?:\.\d+)?)%\s+packet\s+loss", output)
        loss_percent = float(loss_match.group(1)) if loss_match else None

        # Parse RTT: e.g. "rtt min/avg/max/mdev = 12.345/14.567/18.901/1.234 ms"
        rtt_match = re.search(r"rtt\s+min/avg/max/mdev\s*=\s*[\d\.]+/([\d\.]+)/", output)
        avg_rtt = float(rtt_match.group(1)) if rtt_match else None

        if proc.returncode == 0 and avg_rtt is not None:
            return ("AVAILABLE", round(avg_rtt, 1), round(loss_percent or 0.0, 1))

        if loss_percent == 100.0 or proc.returncode != 0:
            return ("TIMEOUT", None, 100.0 if loss_percent is None else round(loss_percent, 1))

        return ("AVAILABLE", avg_rtt, loss_percent)
    except FileNotFoundError:
        return ("UNSUPPORTED", None, None)
    except subprocess.TimeoutExpired:
        return ("TIMEOUT", None, 100.0)
    except Exception:
        return ("UNKNOWN", None, None)


def read_cpu_and_memory() -> tuple[float | None, float | None]:
    """Read instantaneous CPU load and RAM usage percent."""
    mem_percent = None
    cpu_percent = None

    # Memory
    try:
        if os.path.exists("/proc/meminfo"):
            mem_total = None
            mem_avail = None
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        mem_total = int(line.split()[1])
                    elif line.startswith("MemAvailable:"):
                        mem_avail = int(line.split()[1])
            if mem_total and mem_avail is not None and mem_total > 0:
                mem_percent = round((1.0 - (mem_avail / mem_total)) * 100.0, 1)
    except Exception:
        pass

    return (cpu_percent, mem_percent)


# -----------------------------------------------------------------------------
# Rate Calculation & State Tracking
# -----------------------------------------------------------------------------

class MetricsCollector:
    def __init__(self, iface: str):
        self.iface = iface
        self.prev_rx_bytes = 0
        self.prev_tx_bytes = 0
        self.prev_monotonic = 0.0
        self.has_baseline = False

        # Ping cache
        self.last_ping_time = 0.0
        self.cached_ping_status = "UNKNOWN"
        self.cached_ping_ms = None
        self.cached_packet_loss = None

    def sample(self) -> dict:
        now_utc = datetime.now(timezone.utc).isoformat()
        current_monotonic = time.monotonic()
        rx_total, tx_total = read_interface_bytes(self.iface)
        uptime = read_host_uptime()

        rx_bps = 0.0
        tx_bps = 0.0

        if self.has_baseline and self.prev_monotonic > 0:
            elapsed = max(0.001, current_monotonic - self.prev_monotonic)
            # Detect counter reset, reboot, or interface change
            if rx_total >= self.prev_rx_bytes and tx_total >= self.prev_tx_bytes:
                rx_delta = rx_total - self.prev_rx_bytes
                tx_delta = tx_total - self.prev_tx_bytes
                rx_bps = round((rx_delta / elapsed) * 8.0, 2)
                tx_bps = round((tx_delta / elapsed) * 8.0, 2)
            else:
                # Reset baseline without negative rates (Invariant: NEGATIVE_SERVER_RATES = IMPOSSIBLE)
                rx_bps = 0.0
                tx_bps = 0.0
        else:
            self.has_baseline = True

        self.prev_rx_bytes = rx_total
        self.prev_tx_bytes = tx_total
        self.prev_monotonic = current_monotonic

        # Shadowsocks daemon and listener state
        ss_service = check_shadowsocks_service(SHADOWSOCKS_SYSTEMD_UNIT)
        ss_listener = check_shadowsocks_listener(SHADOWSOCKS_LOCAL_HOST, SHADOWSOCKS_LOCAL_PORT)

        # Upstream Ping probe (on lower cadence)
        if current_monotonic - self.last_ping_time >= PING_CADENCE_SECONDS or self.cached_ping_status == "UNKNOWN":
            p_status, p_ms, p_loss = probe_upstream_ping(UPSTREAM_MONITOR_TARGET)
            self.cached_ping_status = p_status
            self.cached_ping_ms = p_ms
            self.cached_packet_loss = p_loss
            self.last_ping_time = current_monotonic

        cpu_pct, mem_pct = read_cpu_and_memory()

        return {
            "server_id": SERVER_ID,
            "observed_at": now_utc,
            "host_uptime_seconds": uptime,
            "shadowsocks_service_status": ss_service,
            "shadowsocks_listener_status": ss_listener,
            "ping_ms": self.cached_ping_ms,
            "ping_status": self.cached_ping_status,
            "packet_loss_percent": self.cached_packet_loss,
            "rx_bytes_total": rx_total,
            "tx_bytes_total": tx_total,
            "rx_bps": rx_bps,
            "tx_bps": tx_bps,
            "cpu_percent": cpu_pct,
            "memory_percent": mem_pct,
        }


# -----------------------------------------------------------------------------
# Ingest HTTP Transmission & Isolation
# -----------------------------------------------------------------------------

def push_metrics(payload: dict) -> bool:
    """
    Push metrics to Backend Ingest API.
    Fails safely on network/HTTP errors without crashing agent or affecting proxy.
    Never logs raw Authorization headers or secret values.
    """
    if not INGEST_URL:
        print("[WARN] INGEST_URL is not configured; running in dry-run/local mode.", file=sys.stderr)
        return False
    if not INGEST_SECRET:
        print("[WARN] SERVER_METRICS_INGEST_SECRET is not configured; cannot authenticate ingest.", file=sys.stderr)
        return False

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        INGEST_URL,
        data=data,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {INGEST_SECRET}",
            "User-Agent": "NekoServerMonitor/1.0",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            status = resp.status
            if 200 <= status < 300:
                return True
            print(f"[WARN] Ingest returned non-200 status: {status}", file=sys.stderr)
            return False
    except urllib.error.HTTPError as e:
        print(f"[WARN] Ingest HTTP error: {e.code} ({e.reason})", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"[WARN] Ingest connection failed: {e.reason}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[WARN] Ingest failed: {type(e).__name__}", file=sys.stderr)
        return False


# -----------------------------------------------------------------------------
# Main Loop
# -----------------------------------------------------------------------------

def main():
    iface = discover_default_interface()
    print("============================================================")
    print("Neko Family Proxy — Japan VPS Monitoring Daemon (Phase T4B)")
    print("============================================================")
    print(f"SERVER_ID               : {SERVER_ID}")
    print(f"MONITOR_INTERFACE       : {iface}")
    print(f"SAMPLE_CADENCE          : {SAMPLE_CADENCE_SECONDS}s")
    print(f"PING_TARGET             : {UPSTREAM_MONITOR_TARGET or '(not set)'}")
    print(f"SHADOWSOCKS_UNIT        : {SHADOWSOCKS_SYSTEMD_UNIT}")
    print(f"SHADOWSOCKS_PROBE       : {SHADOWSOCKS_LOCAL_HOST}:{SHADOWSOCKS_LOCAL_PORT}")
    print(f"INGEST_URL              : {INGEST_URL or '(not set)'}")
    print("============================================================")

    collector = MetricsCollector(iface)

    while True:
        try:
            sample = collector.sample()
            success = push_metrics(sample)
            status_str = "OK" if success else "DRY_RUN/FAILED"
            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] {status_str} | "
                f"RX: {sample['rx_bps']/1000:.1f} Kbps, TX: {sample['tx_bps']/1000:.1f} Kbps | "
                f"SS: {sample['shadowsocks_service_status']}/{sample['shadowsocks_listener_status']} | "
                f"Ping: {sample['ping_ms']}ms ({sample['ping_status']})"
            )
        except Exception as e:
            # Trapping any unexpected error to ensure failure isolation (Proxy stays running)
            print(f"[ERROR] Unexpected collection error: {e}", file=sys.stderr)

        time.sleep(SAMPLE_CADENCE_SECONDS)


if __name__ == "__main__":
    main()
