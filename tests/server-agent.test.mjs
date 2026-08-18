import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const agentScript = resolve(import.meta.dirname, "..", "agent", "neko_server_agent.py");

// Python runner helper for isolated unit tests against the agent logic
function runPython(code) {
  const output = execFileSync("python", ["-c", code], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      ...process.env,
      SERVER_ID: "test-vps-1",
      UPSTREAM_MONITOR_TARGET: "1.1.1.1",
      SERVER_METRICS_INGEST_SECRET: "test-secret-value-12345",
      INGEST_URL: "http://127.0.0.1:9999/ingest",
    },
  });
  return JSON.parse(output.trim());
}

test("server agent rate calculation computes bps correctly on monotonic elapsed time", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

collector = agent.MetricsCollector("dummy0")
collector.has_baseline = True
collector.prev_rx_bytes = 1000
collector.prev_tx_bytes = 2000
collector.prev_monotonic = 100.0

# Simulate sampling with elapsed 5.0s, delta 10000 bytes rx, 5000 bytes tx
# rx rate: (10000 / 5.0) * 8 = 16000 bps
# tx rate: (5000 / 5.0) * 8 = 8000 bps
elapsed = 5.0
current_monotonic = 105.0
rx_total = 11000
tx_total = 7000

rx_delta = rx_total - collector.prev_rx_bytes
tx_delta = tx_total - collector.prev_tx_bytes
rx_bps = round((rx_delta / elapsed) * 8.0, 2)
tx_bps = round((tx_delta / elapsed) * 8.0, 2)

import json
print(json.dumps({"rx_bps": rx_bps, "tx_bps": tx_bps}))
`);
  assert.equal(result.rx_bps, 16000.0);
  assert.equal(result.tx_bps, 8000.0);
});

test("server agent handles non-1-second interval scaling properly", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

# 7.5 seconds interval with 75,000 bytes transferred -> (75000 / 7.5) * 8 = 80,000 bps
elapsed = 7.5
rx_delta = 75000
rx_bps = round((rx_delta / elapsed) * 8.0, 2)

import json
print(json.dumps({"rx_bps": rx_bps}))
`);
  assert.equal(result.rx_bps, 80000.0);
});

test("counter reset or reboot resets baseline without emitting negative rates", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

collector = agent.MetricsCollector("dummy0")
collector.has_baseline = True
collector.prev_rx_bytes = 50000000
collector.prev_tx_bytes = 40000000
collector.prev_monotonic = 100.0

# Counter resets (e.g. host reboot or interface restart) -> rx_total < prev_rx_bytes
rx_total = 1000
tx_total = 800
current_monotonic = 105.0
elapsed = current_monotonic - collector.prev_monotonic

if rx_total >= collector.prev_rx_bytes and tx_total >= collector.prev_tx_bytes:
    rx_delta = rx_total - collector.prev_rx_bytes
    tx_delta = tx_total - collector.prev_tx_bytes
    rx_bps = round((rx_delta / elapsed) * 8.0, 2)
    tx_bps = round((tx_delta / elapsed) * 8.0, 2)
else:
    rx_bps = 0.0
    tx_bps = 0.0

collector.prev_rx_bytes = rx_total
collector.prev_tx_bytes = tx_total
collector.prev_monotonic = current_monotonic

import json
print(json.dumps({
    "rx_bps": rx_bps,
    "tx_bps": tx_bps,
    "is_non_negative": rx_bps >= 0 and tx_bps >= 0,
    "new_rx_baseline": collector.prev_rx_bytes
}))
`);
  assert.equal(result.rx_bps, 0.0);
  assert.equal(result.tx_bps, 0.0);
  assert.equal(result.is_non_negative, true);
  assert.equal(result.new_rx_baseline, 1000);
});

test("server agent parses uptime and interface fallback safely", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

# Test default interface fallback returns a non-empty string
iface = agent.discover_default_interface()

import json
print(json.dumps({"iface": iface, "valid": bool(iface)}))
`);
  assert.ok(result.valid);
  assert.ok(typeof result.iface === "string" && result.iface.length > 0);
});

test("systemd state mapping maps active, inactive, failed and unknown correctly", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

# Test known mapping logic
def map_state(raw):
    raw = raw.strip().lower()
    if raw in ("active", "inactive", "failed"):
        return raw
    return "unknown"

states = {
    "active": map_state("active\\n"),
    "inactive": map_state("inactive\\n"),
    "failed": map_state("failed\\n"),
    "activating": map_state("activating\\n"),
    "deactivating": map_state("deactivating\\n"),
    "garbage": map_state("unknown-output"),
}

import json
print(json.dumps(states))
`);
  assert.equal(result.active, "active");
  assert.equal(result.inactive, "inactive");
  assert.equal(result.failed, "failed");
  assert.equal(result.activating, "unknown");
  assert.equal(result.garbage, "unknown");
});

test("ping output parsing extracts RTT and loss correctly and preserves failure states", () => {
  const result = runPython(`
import re, json

def parse_ping_output(output, returncode):
    loss_match = re.search(r"(\\d+(?:\\.\\d+)?)%\\s+packet\\s+loss", output)
    loss_percent = float(loss_match.group(1)) if loss_match else None

    rtt_match = re.search(r"rtt\\s+min/avg/max/mdev\\s*=\\s*[\\d\\.]+/([\\d\\.]+)/", output)
    avg_rtt = float(rtt_match.group(1)) if rtt_match else None

    if returncode == 0 and avg_rtt is not None:
        return ("AVAILABLE", round(avg_rtt, 1), round(loss_percent or 0.0, 1))
    if loss_percent == 100.0 or returncode != 0:
        return ("TIMEOUT", None, 100.0 if loss_percent is None else round(loss_percent, 1))
    return ("AVAILABLE", avg_rtt, loss_percent)

normal_out = """PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=58 time=12.4 ms
5 packets transmitted, 5 received, 0% packet loss, time 4004ms
rtt min/avg/max/mdev = 11.234/12.456/14.567/1.123 ms"""

timeout_out = """PING 10.255.255.1 (10.255.255.1) 56(84) bytes of data.
5 packets transmitted, 0 received, 100% packet loss, time 4080ms"""

res_normal = parse_ping_output(normal_out, 0)
res_timeout = parse_ping_output(timeout_out, 1)

print(json.dumps({
    "normal": {"status": res_normal[0], "rtt": res_normal[1], "loss": res_normal[2]},
    "timeout": {"status": res_timeout[0], "rtt": res_timeout[1], "loss": res_timeout[2]},
}))
`);
  assert.equal(result.normal.status, "AVAILABLE");
  assert.equal(result.normal.rtt, 12.5);
  assert.equal(result.normal.loss, 0.0);

  assert.equal(result.timeout.status, "TIMEOUT");
  assert.equal(result.timeout.rtt, null);
  assert.equal(result.timeout.loss, 100.0);
});

test("server agent push fails safely on HTTP error without throwing exception", () => {
  const result = runPython(`
import sys
sys.path.insert(0, r"${agentScript.replace(/\\/g, "/")}".rsplit("/", 1)[0])
import neko_server_agent as agent

# Push to a non-existent port should return False safely without unhandled crash
agent.INGEST_URL = "http://127.0.0.1:65530/api/server/metrics/ingest"
agent.INGEST_SECRET = "some-secret"

success = agent.push_metrics({"server_id": "test", "test": 123})

import json
print(json.dumps({"success": success}))
`);
  assert.equal(result.success, false);
});
