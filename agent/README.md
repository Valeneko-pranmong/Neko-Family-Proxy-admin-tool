# Japan VPS Monitoring Agent Deployment Guide (Phase T4B)

## 1. Overview
The `neko_server_agent.py` daemon runs on the Japan VPS to observe aggregate server infrastructure metrics and push them to the Backend Ingest API.

## 2. Invariants & Trust Boundary
- **Observational Only**: The agent does not alter routing, firewall, or proxy configuration. If the agent crashes, proxying continues unaffected.
- **Zero Client Telemetry**: The agent observes whole-interface `/proc/net/dev` totals, host `/proc/uptime`, Shadowsocks systemd state, and local listener socket. No client telemetry, process PIDs, or user tokens are ever collected.
- **Push Architecture**: Outbound HTTPS (port 443) only. Inbound ports on Japan VPS remain completely closed.

## 3. Installation Steps on Japan VPS (Ubuntu/Debian)

```bash
# 1. Create agent directory
sudo mkdir -p /opt/neko /etc/neko

# 2. Copy agent script
sudo cp neko_server_agent.py /opt/neko/
sudo chmod 755 /opt/neko/neko_server_agent.py

# 3. Configure environment file
sudo cp server-agent.env.example /etc/neko/server-agent.env
sudo chmod 600 /etc/neko/server-agent.env

# Edit /etc/neko/server-agent.env with:
# INGEST_URL, SERVER_METRICS_INGEST_SECRET, UPSTREAM_MONITOR_TARGET, etc.
sudo nano /etc/neko/server-agent.env

# 4. Install systemd service
sudo cp neko-server-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now neko-server-monitor.service

# 5. Check status
sudo systemctl status neko-server-monitor.service
sudo journalctl -u neko-server-monitor.service -f
```
