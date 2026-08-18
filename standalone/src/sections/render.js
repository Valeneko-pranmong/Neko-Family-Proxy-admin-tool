import {
  escapeHtml,
  formatBps,
  formatBytes,
  formatDate,
  formatRelativeAge,
  formatTime,
  formatTrendBucket,
  formatUptime,
  statusIcon,
} from "../ui/escape.js";
import { cell, dateCell, statusBadge, table } from "../ui/table.js";

function heading(title, subtitle, action = "") {
  return `
    <div class="section-head">
      <div><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(subtitle)}</p></div>
      ${action}
    </div>
  `;
}

export function renderSectionRefreshNotice(ui = {}) {
  if (ui.refreshing) {
    return `<div class="inline-refresh" role="status">กำลังอัปเดตข้อมูล…</div>`;
  }
  if (ui.error) {
    return `<div class="inline-alert" role="alert">อัปเดตไม่สำเร็จ: ${escapeHtml(ui.error)} · กำลังแสดงข้อมูลล่าสุดที่มี</div>`;
  }
  return "";
}

function actionButton(action, id, label, extra = "", busy = false) {
  return `<button class="button button-small ${extra}" data-action="${action}" data-id="${escapeHtml(id)}" ${busy ? "disabled" : ""}>${busy ? "กำลังดำเนินการ…" : escapeHtml(label)}</button>`;
}

export function renderServerHealth(server = {}, stats = {}) {
  const hostStatus = String(server?.host_status || "UNKNOWN").toUpperCase();
  const pingStatus = String(server?.ping_status || "UNKNOWN").toUpperCase();
  const pingLabel = escapeHtml(server?.ping_target_label || "VPS → Upstream");
  const pingDisplay = server?.ping_ms !== null && server?.ping_ms !== undefined
    ? `${server.ping_ms} ms`
    : (pingStatus === "TIMEOUT" ? "Timeout" : pingStatus === "UNSUPPORTED" ? "Unsupported" : "—");
  const lossDisplay = server?.packet_loss_percent !== null && server?.packet_loss_percent !== undefined
    ? `${server.packet_loss_percent}%`
    : "—";

  const rxRate = formatBps(server?.rx_bps);
  const txRate = formatBps(server?.tx_bps);
  const rxTotal = formatBytes(server?.rx_bytes_total);
  const txTotal = formatBytes(server?.tx_bytes_total);
  const uptime = formatUptime(server?.uptime_seconds);
  const relativeAge = formatRelativeAge(server?.age_seconds);

  const ssService = String(server?.shadowsocks_service_status || "unknown").toLowerCase();
  const ssListener = String(server?.shadowsocks_listener_status || "unknown").toLowerCase();

  const activeUsers = server?.online_session_count ?? stats.onlineSessionCount ?? stats.recentlyOnline ?? 0;
  const entitledUsers = server?.entitled_active_user_count ?? stats.entitledActiveUserCount ?? stats.recentlyOnline ?? 0;

  const staleNotice = server?.is_stale
    ? `<span class="server-stale-warn"><span class="status-glyph" aria-hidden="true">◷</span> ข้อมูลค้าง (>30s)</span>`
    : "";

  return `
    <section class="panel server-health-panel" aria-label="สถานะเซิร์ฟเวอร์หลัก Japan VPS">
      <div class="panel-title-row">
        <div>
          <div class="panel-eyebrow">INFRASTRUCTURE AUTHORITY</div>
          <h3>เซิร์ฟเวอร์หลัก (Japan VPS)</h3>
          <p class="muted">ข้อมูลโครงสร้างพื้นฐานโดยรวมจาก VPS และสถิติผู้ใช้ออนไลน์จาก Session Authority</p>
        </div>
        <div class="server-status-badge">
          ${staleNotice}
          <span class="status status-${escapeHtml(hostStatus.toLowerCase())}">
            <span class="status-glyph" aria-hidden="true">${statusIcon(hostStatus)}</span>
            ${escapeHtml(hostStatus)}
          </span>
        </div>
      </div>
      <div class="server-metrics-grid">
        <div class="server-metric-card host-status-card">
          <span class="metric-label">Host Status</span>
          <strong class="metric-value">
            <span class="status status-${escapeHtml(hostStatus.toLowerCase())}">
              <span class="status-glyph" aria-hidden="true">${statusIcon(hostStatus)}</span>
              ${escapeHtml(hostStatus)}
            </span>
          </strong>
          <small class="metric-sub">สังเกตล่าสุด: ${escapeHtml(relativeAge)}</small>
        </div>
        <div class="server-metric-card">
          <span class="metric-label">${pingLabel}</span>
          <strong class="metric-value">${escapeHtml(pingDisplay)}</strong>
          <small class="metric-sub">Loss: ${escapeHtml(lossDisplay)} · Probe: ${escapeHtml(pingStatus)}</small>
        </div>
        <div class="server-metric-card">
          <span class="metric-label">Packet Loss</span>
          <strong class="metric-value">${escapeHtml(lossDisplay)}</strong>
          <small class="metric-sub">สถานะโพรบ: ${escapeHtml(pingStatus)}</small>
        </div>
        <div class="server-metric-card">
          <span class="metric-label">VPS Download (RX)</span>
          <strong class="metric-value rx-value">${escapeHtml(rxRate)}</strong>
          <small class="metric-sub">รวมทั้งโฮสต์: ${escapeHtml(rxTotal)}</small>
        </div>
        <div class="server-metric-card">
          <span class="metric-label">VPS Upload (TX)</span>
          <strong class="metric-value tx-value">${escapeHtml(txRate)}</strong>
          <small class="metric-sub">รวมทั้งโฮสต์: ${escapeHtml(txTotal)}</small>
        </div>
        <div class="server-metric-card active-users-card">
          <span class="metric-label">ผู้ใช้ออนไลน์ (Active Users)</span>
          <strong class="metric-value">${escapeHtml(activeUsers)}</strong>
          <small class="metric-sub">${escapeHtml(entitledUsers)} มี License ใช้งานได้</small>
        </div>
      </div>
      <div class="server-details-bar">
        <div class="detail-item">
          <span class="detail-label">Host Uptime</span>
          <span class="detail-value">${escapeHtml(uptime)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Shadowsocks Daemon</span>
          <span class="detail-value">${statusBadge(ssService)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Shadowsocks Listener</span>
          <span class="detail-value">${statusBadge(ssListener)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Server ID</span>
          <span class="detail-value server-id-chip">${escapeHtml(server?.server_id || "japan-vps-1")}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Last Observation</span>
          <span class="detail-value">${server?.observed_at ? escapeHtml(formatTime(server.observed_at)) : "—"}</span>
        </div>
      </div>
    </section>
  `;
}

export function renderLiveServerChart(history = [], server = {}) {
  const points = Array.isArray(history) ? history : [];
  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const currentRx = latestPoint ? formatBps(latestPoint.rxBps) : formatBps(server?.rx_bps);
  const currentTx = latestPoint ? formatBps(latestPoint.txBps) : formatBps(server?.tx_bps);

  let statusBadgeHtml = "";
  if (server?.is_stale || server?.host_status === "STALE") {
    statusBadgeHtml = `<span class="live-status-tag status-stale"><span class="status-glyph" aria-hidden="true">◷</span> ข้อมูลค้าง (>30s) — หยุดรับจุดชั่วคราว</span>`;
  } else if (points.length === 0) {
    statusBadgeHtml = `<span class="live-status-tag"><span class="status-glyph" aria-hidden="true">○</span> รอรับข้อมูล Snapshot แรก…</span>`;
  } else {
    statusBadgeHtml = `<span class="live-status-tag status-live"><span class="status-glyph" aria-hidden="true">●</span> Live (${points.length}/60 จุด · ~5 นาที)</span>`;
  }

  const width = 840;
  const height = 240;
  const pad = { left: 68, right: 20, top: 24, bottom: 36 };

  let chartBody = "";
  if (points.length === 0) {
    chartBody = `
      <div class="chart-empty">
        <strong>ยังไม่มีข้อมูล Live Network Activity ในเซสชันนี้</strong>
        <span>กราฟจะบันทึกข้อมูลแบบ Rolling ในหน่วยความจำเบราว์เซอร์ตั้งแต่เปิดหน้านี้ (ไม่สร้างประวัติย้อนหลังจำลอง)</span>
      </div>
    `;
  } else {
    const maxVal = Math.max(1000, ...points.flatMap((p) => [Number(p.rxBps) || 0, Number(p.txBps) || 0]));
    const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, points.length - 1);
    const y = (value) => height - pad.bottom - ((Number(value) || 0) * (height - pad.top - pad.bottom)) / maxVal;

    const rxPolyline = points.map((p, i) => `${x(i)},${y(p.rxBps)}`).join(" ");
    const txPolyline = points.map((p, i) => `${x(i)},${y(p.txBps)}`).join(" ");

    const rxDots = points.map((p, i) => {
      const title = `${formatTime(p.observedAt)} · VPS Download: ${formatBps(p.rxBps)}`;
      return `<circle tabindex="0" cx="${x(i)}" cy="${y(p.rxBps)}" r="3.5" fill="#3f76b7" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title></circle>`;
    }).join("");

    const txDots = points.map((p, i) => {
      const title = `${formatTime(p.observedAt)} · VPS Upload: ${formatBps(p.txBps)}`;
      return `<circle tabindex="0" cx="${x(i)}" cy="${y(p.txBps)}" r="3.5" fill="#287b5b" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title></circle>`;
    }).join("");

    const timeLabels = points.map((p, i) => {
      const step = Math.max(1, Math.floor(points.length / 5));
      if (i % step !== 0 && i !== points.length - 1) return "";
      return `<text x="${x(i)}" y="${height - 12}" text-anchor="middle" class="chart-time-label">${escapeHtml(formatTime(p.observedAt))}</text>`;
    }).join("");

    chartBody = `
      <div class="chart-wrap" role="img" aria-label="กราฟ Live Network Activity">
        <svg class="activity-chart live-network-chart" viewBox="0 0 ${width} ${height}" aria-hidden="false">
          <line x1="${pad.left}" y1="${pad.top}" x2="${width - pad.right}" y2="${pad.top}" class="chart-grid" />
          <line x1="${pad.left}" y1="${y(maxVal / 2)}" x2="${width - pad.right}" y2="${y(maxVal / 2)}" class="chart-grid" />
          <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" class="chart-axis" />
          <text x="8" y="${pad.top + 5}" class="chart-max">${escapeHtml(formatBps(maxVal))}</text>
          <text x="8" y="${y(maxVal / 2) + 4}" class="chart-max">${escapeHtml(formatBps(maxVal / 2))}</text>
          <text x="36" y="${height - pad.bottom + 4}" class="chart-max">0 bps</text>
          <polyline points="${rxPolyline}" fill="none" stroke="#3f76b7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          <polyline points="${txPolyline}" fill="none" stroke="#287b5b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${rxDots}
          ${txDots}
          ${timeLabels}
        </svg>
      </div>
    `;
  }

  return `
    <section class="panel live-chart-panel" aria-label="Live Network Activity">
      <div class="panel-title-row">
        <div>
          <div class="panel-eyebrow">REAL-TIME TRAFFIC</div>
          <h3>Live Network Activity</h3>
          <p class="muted">Live — Since Dashboard Opened · บันทึกในหน่วยความจำเบราว์เซอร์ (Rolling Buffer สูงสุด 60 จุด / ~5 นาที)</p>
        </div>
        <div class="chart-meta-actions">
          ${statusBadgeHtml}
        </div>
      </div>
      <div class="live-chart-legend">
        <span class="legend-item"><i class="legend-dot legend-rx"></i> VPS Download: <strong>${escapeHtml(currentRx)}</strong></span>
        <span class="legend-item"><i class="legend-dot legend-tx"></i> VPS Upload: <strong>${escapeHtml(currentTx)}</strong></span>
      </div>
      ${chartBody}
    </section>
  `;
}

export function renderOverview(data = {}) {
  const stats = data.stats || {};
  const server = data.server || {};
  const liveServerHistory = data.liveServerHistory || [];
  const safeCount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const cards = [
    ["สมาชิกทั้งหมด", stats.users ?? 0, "users", "บัญชีสมาชิกทั้งหมดในระบบ", `${stats.userBreakdown?.suspended ?? 0} ระงับ · ${stats.userBreakdown?.banned ?? 0} แบน`],
    ["License ใช้งานได้", stats.activeLicenses ?? 0, "active", "สถานะ active และอยู่ในช่วงเวลาที่ใช้ได้", `${stats.licenseBreakdown?.expiringSoon ?? 0} ใกล้หมดอายุ`],
    ["Session ปัจจุบัน", stats.activeSessions ?? 0, "session", "Session ที่ยังไม่ถูก revoke", "ไม่เท่ากับผู้ใช้ออนไลน์"],
    ["Online ล่าสุด", stats.onlineSessionCount ?? stats.recentlyOnline ?? 0, "online", "Current session ที่ heartbeat ภายใน 2 นาที", "ค่าประมาณจาก heartbeat"],
    ["การติดตั้งที่จดจำ", stats.installations ?? stats.activeInstallations ?? 0, "device", "ประวัติเครื่องที่บัญชีเคยจดจำ", "ไม่ใช่อุปกรณ์ออนไลน์"],
    ["คูปองพร้อมใช้", stats.usableCoupons ?? stats.unusedCoupons ?? 0, "coupon", "คูปอง active ใน batch ที่ยังใช้ได้", "ตัด batch หมดอายุ/revoke แล้ว"],
  ];
  const recent = (data.recent || []).map(
    (event) =>
      `<tr>${cell(event.title)}${cell(event.detail)}${dateCell(event.time)}</tr>`,
  );
  const range = ["24h", "7d", "14d", "30d"].includes(data.range) ? data.range : "14d";
  const trend = Array.isArray(data.trend) ? data.trend : [];
  const maxValue = Math.max(1, ...trend.flatMap((point) => [safeCount(point.sessions), safeCount(point.redemptions)]));
  const width = 840;
  const height = 280;
  const pad = { left: 46, right: 18, top: 18, bottom: 42 };
  const x = (index) => pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, trend.length - 1);
  const y = (value) => height - pad.bottom - (value * (height - pad.top - pad.bottom)) / maxValue;
  const series = (field, color, label) => {
    const points = trend.map((point, index) => `${x(index)},${y(safeCount(point[field]))}`).join(" ");
    const dots = trend.map((point, index) => {
      const count = safeCount(point[field]);
      const context = `${formatDate(point.bucket)} · ${label} ${count}`;
      return `<circle tabindex="0" cx="${x(index)}" cy="${y(count)}" r="4" fill="${color}" aria-label="${escapeHtml(context)}"><title>${escapeHtml(context)}</title></circle>`;
    }).join("");
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
  };
  const labels = trend.map((point, index) => {
    const every = Math.max(1, Math.ceil(trend.length / 7));
    if (index % every !== 0 && index !== trend.length - 1) return "";
    return `<text x="${x(index)}" y="${height - 14}" text-anchor="middle">${escapeHtml(formatTrendBucket(point.bucket, range))}</text>`;
  }).join("");
  const graph = trend.length
    ? `<div class="chart-wrap" role="img" aria-label="กราฟ Launcher activity">
        <svg class="activity-chart" viewBox="0 0 ${width} ${height}" aria-hidden="false">
          <line x1="${pad.left}" y1="${pad.top}" x2="${width - pad.right}" y2="${pad.top}" class="chart-grid" />
          <line x1="${pad.left}" y1="${y(maxValue / 2)}" x2="${width - pad.right}" y2="${y(maxValue / 2)}" class="chart-grid" />
          <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" class="chart-axis" />
          <text x="8" y="${pad.top + 6}" class="chart-max">${maxValue}</text>
          <text x="8" y="${y(maxValue / 2) + 4}" class="chart-max">${Math.round(maxValue / 2)}</text>
          <text x="28" y="${height - pad.bottom + 4}" class="chart-max">0</text>
          ${series("sessions", "#d83e80", "Session เริ่มใหม่")}
          ${series("redemptions", "#287b5b", "ใช้คูปองสำเร็จ")}
          ${labels}
        </svg>
      </div>`
    : `<div class="chart-empty"><strong>ยังไม่มีกิจกรรมในช่วงเวลานี้</strong><span>ระบบจะไม่สร้างข้อมูลจำลองหรือเส้นศูนย์แทนข้อมูลจริง</span></div>`;
  const refreshState = data._ui?.refreshing ? `<span class="refreshing" role="status">กำลังอัปเดต…</span>` : "";
  const error = data._ui?.error ? `<div class="inline-alert" role="alert">อัปเดตไม่สำเร็จ: ${escapeHtml(data._ui.error)} · กำลังแสดงข้อมูลล่าสุดที่มี</div>` : "";
  return `
    <div class="dashboard-head">
      <div>
        <span class="system-status"><i></i> เชื่อมต่อ Admin API แล้ว · Auto-polling 5s</span>
        <h2>ภาพรวมระบบ</h2>
        <p class="muted">Metrics ที่แยก Session, Online ล่าสุด, VPS Infrastructure และ Live Network อย่างถูกต้อง</p>
      </div>
      <div class="refresh-meta">
        <span>อัปเดต ${escapeHtml(formatTime(data.generatedAt))}</span>
        <span>${escapeHtml(data.timezone || "Asia/Bangkok")} (UTC+7)</span>
        <div>
          ${refreshState}
          <button class="button" data-action="refresh_overview" aria-label="รีเฟรชข้อมูล Dashboard" ${data._ui?.refreshing ? "disabled" : ""}>↻ รีเฟรช</button>
        </div>
      </div>
    </div>
    ${error}
    ${renderServerHealth(server, stats)}
    ${renderLiveServerChart(liveServerHistory, server)}
    <div class="section-title-divider">
      <h3>สถิติสมาชิกและสิทธิ์การใช้งาน (Session Authority)</h3>
    </div>
    <section class="stats-grid">${cards
      .map(([label, value, tone, explanation, secondary]) => `<article class="stat-card stat-${tone}"><span>${label}</span><strong>${escapeHtml(safeCount(value))}</strong><p>${explanation}</p><small>${escapeHtml(secondary)}</small></article>`)
      .join("")}</section>
    <section class="panel chart-panel">
      <div class="panel-title-row">
        <div>
          <div class="panel-eyebrow">HISTORICAL AGGREGATE</div>
          <h3>Launcher Activity</h3>
          <p class="muted">Session เริ่มใหม่และการใช้คูปองสำเร็จ · เวลา Asia/Bangkok</p>
        </div>
        <div class="range-switch" aria-label="ช่วงเวลากราฟ">
          ${["24h", "7d", "14d", "30d"].map((value) => `<button class="${value === range ? "is-selected" : ""}" data-action="set_range" data-range="${value}" aria-pressed="${value === range}">${value.toUpperCase()}</button>`).join("")}
        </div>
      </div>
      <div class="chart-legend"><span><i class="legend-sessions"></i>Session เริ่มใหม่</span><span><i class="legend-redemptions"></i>ใช้คูปองสำเร็จ</span></div>
      ${graph}
    </section>
    <section class="ops-grid">
      <article class="panel ops-summary"><h3>Operational summary</h3><dl><div><dt>สมาชิก Active</dt><dd>${safeCount(stats.userBreakdown?.active)}</dd></div><div><dt>License หมดอายุ</dt><dd>${safeCount(stats.licenseBreakdown?.expired)}</dd></div><div><dt>License ถูกยกเลิก</dt><dd>${safeCount(stats.licenseBreakdown?.revoked)}</dd></div></dl></article>
      <section class="panel">
        <div class="panel-title-row"><h3>กิจกรรมล่าสุด</h3></div>
        ${table(["รายการ", "รายละเอียด", "เวลา"], recent)}
      </section>
    </section>
  `;
}

export function renderUsers(rows = [], viewer = null) {
  const body = rows.map((row) => {
    const recoveryAction =
      row.role === "customer"
        ? actionButton("generate_recovery_code", row.id, "สร้าง Recovery Code", "button-warning")
        : "";
    const isSelf = row.id === viewer?.userId;
    const statusActions = isSelf
      ? "บัญชีที่กำลังใช้งาน"
      : row.status === "active"
        ? `${actionButton("suspend_user", row.id, "ระงับ", "button-danger")} ${actionButton("ban_user", row.id, "แบน", "button-danger")}`
        : actionButton("activate_user", row.id, "เปิดใช้", "button-success");
    return `<tr>${cell(row.username, "primary")}${cell(row.display_name)}${cell(row.role)}<td>${statusBadge(row.status)}</td>${dateCell(row.updated_at)}<td class="actions">${recoveryAction} ${statusActions}</td></tr>`;
  });
  return `${heading("สมาชิก", "ข้อมูลบัญชีจาก public.profiles")}${table(["Username", "ชื่อแสดง", "บทบาท", "สถานะ", "แก้ไขล่าสุด", "คำสั่ง"], body)}`;
}

export function renderRecoveryCodeDialog(state) {
  if (!state) return "";
  const username = escapeHtml(state.username);
  const error = state.error
    ? `<div class="form-error" role="alert">${escapeHtml(state.error)}</div>`
    : "";
  if (state.phase === "success") {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
          <h2 id="recovery-title">Recovery Code ของ ${username}</h2>
          <p class="muted">ส่งรหัสนี้ให้ลูกค้าผ่านช่องทางส่วนตัว รหัสใช้ได้ครั้งเดียวและระบบจะไม่แสดงซ้ำหลังปิดหรือรีเฟรช</p>
          <code class="temporary-password">${escapeHtml(state.recoveryCode)}</code>
          <p><strong>หมดอายุใน ${escapeHtml(state.countdown || "00:00")}</strong> · ใช้ได้ครั้งเดียว</p>
          <div class="modal-actions">
            <button class="button button-primary" type="button" data-action="copy_recovery_code">คัดลอกรหัส</button>
            <button class="button" type="button" data-action="close_recovery_code">ปิดและล้างรหัส</button>
          </div>
        </section>
      </div>
    `;
  }
  const busy = state.phase === "submitting";
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">สร้าง Recovery Code</h2>
        <p>สร้างรหัสใช้ครั้งเดียวสำหรับ <strong>${username}</strong> รหัสมีอายุ 5 นาที และการสร้างรหัสใหม่จะยกเลิกรหัสเดิมทันที Admin จะไม่ทราบรหัสผ่านใหม่ที่ลูกค้าเลือก</p>
        <form id="recovery-code-form" class="stack">
          <input name="userId" type="hidden" value="${escapeHtml(state.userId)}" />
          <label>
            พิมพ์ Username “${username}” เพื่อยืนยัน
            <input name="confirmUsername" type="text" maxlength="32" autocomplete="off" required ${busy ? "disabled" : ""} />
          </label>
          ${error}
          <div class="modal-actions">
            <button class="button button-warning" type="submit" ${busy ? "disabled" : ""}>${busy ? "กำลังสร้างรหัส…" : "ยืนยันและสร้าง Recovery Code"}</button>
            <button class="button" type="button" data-action="close_recovery_code" ${busy ? "disabled" : ""}>ยกเลิก</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderProducts(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.code, "primary")}${cell(row.name)}<td>${statusBadge(row.is_active ? "active" : "inactive")}</td>${dateCell(row.created_at)}</tr>`,
  );
  return `${heading("สินค้า", "บัญชีจดจำได้หลายเครื่อง แต่ใช้งานพร้อมกันได้หนึ่งเครื่อง")}${table(["รหัสสินค้า", "ชื่อ", "สถานะ", "สร้างเมื่อ"], body)}`;
}

export function renderLicenses(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.username, "primary")}${cell(row.product)}${cell(row.product_code)}<td>${statusBadge(row.effective_status || row.status)}</td>${dateCell(row.valid_from)}${dateCell(row.valid_until)}<td class="actions">${actionButton("extend_license", row.id, "ต่ออายุ")} ${row.status !== "revoked" ? actionButton("revoke_license", row.id, "ยกเลิก", "button-danger") : ""}</td></tr>`,
  );
  return `${heading("สิทธิ์ใช้งาน", "ต่ออายุหรือยกเลิก License การลงชื่อเข้าใช้จากเครื่องใหม่จะแทนที่เซสชันเดิม")}${table(["สมาชิก", "สินค้า", "รหัสสินค้า", "สถานะ", "เริ่มใช้", "หมดอายุ", "คำสั่ง"], body)}`;
}

export function renderCoupons(rows = []) {
  const body = rows.map((row) => {
    const actions = [
      row.has_archived_codes
        ? actionButton("copy_coupon_codes", row.id, "คัดลอกรหัส", "button-success")
        : "",
      row.status === "active"
        ? actionButton("revoke_batch", row.id, "ยกเลิกชุด", "button-danger")
        : "",
      row.status === "revoked" && row.redeemed_count === 0
        ? actionButton("delete_batch", row.id, "ลบ", "button-danger")
        : "",
    ].filter(Boolean).join(" ");
    return `<tr>${cell(row.batch, "primary")}${cell(row.product)}${cell(row.product_code)}${cell(row.duration_days)}${cell(`${row.active_count}/${row.actual_quantity}`)}${cell(row.redeemed_count)}<td>${statusBadge(row.status)}</td>${dateCell(row.expires_at)}${dateCell(row.created_at)}<td class="actions">${actions}</td></tr>`;
  });
  return `
    ${heading("คูปอง", "สร้าง ยกเลิก ลบ และคัดลอกรหัสที่บันทึกไว้ในเบราว์เซอร์นี้", `<button class="button button-primary" data-action="show-coupon-form">สร้างคูปอง</button>`)}
    <div id="coupon-form-host"></div>
    ${table(["ชุด", "สินค้า", "รหัสสินค้า", "วัน", "พร้อมใช้/ทั้งหมด", "ใช้แล้ว", "สถานะ", "หมดอายุ", "สร้างเมื่อ", "คำสั่ง"], body)}
  `;
}

export function couponForm() {
  return `
    <form id="coupon-form" class="panel inline-form">
      <label>Product code<input name="productCode" value="neko-family-proxy" required /></label>
      <label>จำนวนวัน<input name="durationDays" type="number" min="1" max="3650" value="30" required /></label>
      <label>จำนวนคูปอง<input name="quantity" type="number" min="1" max="500" value="10" required /></label>
      <label>หมายเหตุ<input name="note" maxlength="500" /></label>
      <div class="form-actions"><button class="button button-primary" type="submit">สร้าง</button><button class="button" type="button" data-action="hide-coupon-form">ยกเลิก</button></div>
    </form>
  `;
}

export function renderSessions(rows = [], busyId = null, nowMs = Date.now()) {
  const body = rows.map((row) => {
    const isRevoked = Boolean(row.revoked_at);
    const lastSeenMs = Date.parse(row.last_seen_at);
    const isFresh = Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs <= 120 * 1000);

    // Mandatory Correction 3: Online (<=120s), Offline (>120s), Revoked (revoked_at present)
    const sessionStatus = isRevoked ? "revoked" : isFresh ? "online" : "offline";
    const sessionLabel = isRevoked ? "Revoked" : isFresh ? "Online" : "Offline";

    const sessionId = row.id
      ? `<span class="truncated-id copyable-cell" title="คัดลอก Session ID: ${escapeHtml(row.id)}" data-copy="${escapeHtml(row.id)}">${escapeHtml(row.id.slice(0, 8))}…</span>`
      : "—";
    const license = row.license_id
      ? `<span class="truncated-id copyable-cell" title="คัดลอก License ID: ${escapeHtml(row.license_id)}" data-copy="${escapeHtml(row.license_id)}">${escapeHtml(row.license_id.slice(0, 8))}…</span>`
      : "—";

    const isBusy = busyId === row.id;
    const actionCell = isRevoked
      ? `<span class="muted">ยุติแล้ว</span>`
      : actionButton("revoke_session", row.id, "ยุติเซสชัน", "button-danger", isBusy);

    return `<tr>${cell(row.username, "primary")}<td>${statusBadge(sessionStatus, sessionLabel)}</td><td>${sessionId}</td><td>${license}</td>${dateCell(row.created_at)}${dateCell(row.last_seen_at)}<td class="actions">${actionCell}</td></tr>`;
  });
  return `${heading("ประวัติ Launcher session", "แต่ละบัญชีมี session ปัจจุบันได้หนึ่งรายการ รายการก่อนหน้าถูกแทนที่หรือยกเลิกแล้ว")}${table(["สมาชิก", "สถานะ", "Session ID", "License", "เริ่มเมื่อ", "Heartbeat ล่าสุด", "คำสั่ง"], body, "ไม่มี Launcher session ในระบบ")}`;
}

export function renderInstallations(rows = [], busyId = null) {
  const body = rows.map(
    (row) => {
      const isBusy = busyId === row.active_session_id;
      const actionCell = row.active_session_id
        ? actionButton("revoke_session", row.active_session_id, "ยุติเซสชันปัจจุบัน", "button-danger", isBusy)
        : "—";
      return `<tr>${cell(row.username, "primary")}${cell(row.display_name)}${cell(row.installation_key_hash_masked)}<td>${statusBadge("remembered", "จดจำไว้")}</td><td>${row.owns_active_session ? statusBadge("online", "เครื่องที่กำลังใช้งาน") : statusBadge("inactive", "ประวัติการติดตั้ง")}</td>${dateCell(row.created_at)}${dateCell(row.last_seen_at)}${dateCell(row.active_session_created_at)}${dateCell(row.active_session_last_seen_at)}<td class="actions">${actionCell}</td></tr>`;
    },
  );
  return `${heading("การติดตั้งที่จดจำไว้", "อุปกรณ์ที่จดจำไว้ไม่ใช่การเข้าสู่ระบบที่กำลังใช้งาน บัญชีมีเซสชันปัจจุบันได้หนึ่งรายการ และการเข้าใช้เครื่องใหม่จะแทนที่เซสชันเดิม")}${table(["สมาชิก", "ชื่อการติดตั้ง", "Installation hash", "สถานะ", "เซสชันปัจจุบัน", "สร้างเมื่อ", "พบล่าสุด", "เริ่มเซสชัน", "Heartbeat ล่าสุด", "คำสั่ง"], body, "ไม่มีประวัติการติดตั้ง")}`;
}

export function renderRedemptions(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.username, "primary")}${cell(row.product)}${cell(row.batch)}<td>${statusBadge(row.succeeded ? "success" : "rejected")}</td>${cell(row.error_code)}${dateCell(row.attempted_at)}</tr>`,
  );
  return `${heading("การใช้คูปอง", "ประวัติความสำเร็จและข้อผิดพลาดในการใช้คูปอง")}${table(["สมาชิก", "สินค้า", "ชุด", "ผลลัพธ์", "ข้อผิดพลาด", "เวลา"], body, "ยังไม่มีประวัติการใช้คูปอง")}`;
}

export function renderAudit(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.title, "primary")}${cell(row.username)}${cell(row.detail)}${dateCell(row.time)}</tr>`,
  );
  return `${heading("ประวัติการใช้งาน", "Audit log ที่คัดเฉพาะ metadata ที่ปลอดภัยและมีประโยชน์")}${table(["ประเภท", "ผู้ใช้", "รายละเอียด", "เวลา"], body, "ยังไม่มีบันทึก Audit event")}`;
}

export function renderSection(section, data, viewer = null, busyId = null) {
  if (section === "users") return renderUsers(data, viewer);
  if (section === "products") return renderProducts(data);
  if (section === "licenses") return renderLicenses(data);
  if (section === "coupons") return renderCoupons(data);
  if (section === "redemptions") return renderRedemptions(data);
  if (section === "installations") return renderInstallations(data, busyId);
  if (section === "sessions") return renderSessions(data, busyId);
  if (section === "audit") return renderAudit(data);
  return renderOverview(data);
}
