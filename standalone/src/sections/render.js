import { escapeHtml } from "../ui/escape.js";
import { cell, dateCell, statusBadge, table } from "../ui/table.js";

function heading(title, subtitle, action = "") {
  return `
    <div class="section-head">
      <div><h2>${escapeHtml(title)}</h2><p class="muted">${escapeHtml(subtitle)}</p></div>
      ${action}
    </div>
  `;
}

function actionButton(action, id, label, extra = "") {
  return `<button class="button button-small ${extra}" data-action="${action}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

export function renderOverview(data = {}) {
  const stats = data.stats || {};
  const cards = [
    ["สมาชิก", stats.users ?? 0, "users"],
    ["สินค้าที่เปิดใช้", stats.products ?? 0, "product"],
    ["License ที่ใช้งาน", stats.activeLicenses ?? 0, "active"],
    ["อุปกรณ์ที่ใช้งาน", stats.activeInstallations ?? 0, "device"],
    ["Session ออนไลน์", stats.activeSessions ?? 0, "session"],
    ["คูปองพร้อมใช้", stats.unusedCoupons ?? 0, "coupon"],
  ];
  const recent = (data.recent || []).map(
    (event) =>
      `<tr>${cell(event.title)}${cell(event.detail)}${dateCell(event.time)}</tr>`,
  );
  return `
    ${heading("ภาพรวมระบบ", "สถานะล่าสุดจากฐานข้อมูล")}
    <section class="stats-grid">${cards
      .map(([label, value, tone]) => `<article class="stat-card stat-${tone}"><span>${label}</span><strong>${value}</strong></article>`)
      .join("")}</section>
    <section class="panel">
      <div class="panel-title-row"><h3>กิจกรรมล่าสุด</h3></div>
      ${table(["รายการ", "รายละเอียด", "เวลา"], recent)}
    </section>
  `;
}

export function renderUsers(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.email, "primary")}${cell(row.username)}${cell(row.display_name)}${cell(row.role)}<td>${statusBadge(row.status)}</td>${dateCell(row.updated_at)}<td class="actions">${actionButton("toggle_user_status", row.id, row.status === "active" ? "ระงับ" : "เปิดใช้", row.status === "active" ? "button-danger" : "button-success")}</td></tr>`,
  );
  return `${heading("สมาชิก", "ข้อมูลบัญชีจาก Auth และ public.profiles")}${table(["อีเมล", "Username", "ชื่อแสดง", "บทบาท", "สถานะ", "แก้ไขล่าสุด", "คำสั่ง"], body)}`;
}

export function renderProducts(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.code, "primary")}${cell(row.name)}${cell(row.max_devices)}<td>${statusBadge(row.is_active ? "active" : "inactive")}</td>${dateCell(row.created_at)}</tr>`,
  );
  return `${heading("สินค้า", "รายการสินค้าและจำนวนอุปกรณ์ที่รองรับ")}${table(["รหัสสินค้า", "ชื่อ", "อุปกรณ์สูงสุด", "สถานะ", "สร้างเมื่อ"], body)}`;
}

export function renderLicenses(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.email, "primary")}${cell(row.product)}${cell(row.product_code)}<td>${statusBadge(row.status)}</td>${dateCell(row.valid_from)}${dateCell(row.valid_until)}${cell(row.max_devices ?? "ตามสินค้า")}<td class="actions">${actionButton("extend_license", row.id, "ต่ออายุ")} ${row.status !== "revoked" ? actionButton("revoke_license", row.id, "ยกเลิก", "button-danger") : ""}</td></tr>`,
  );
  return `${heading("สิทธิ์ใช้งาน", "ต่ออายุหรือยกเลิก License")}${table(["สมาชิก", "สินค้า", "รหัสสินค้า", "สถานะ", "เริ่มใช้", "หมดอายุ", "อุปกรณ์", "คำสั่ง"], body)}`;
}

export function renderCoupons(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.batch, "primary")}${cell(row.product)}${cell(row.product_code)}${cell(row.duration_days)}${cell(`${row.active_count}/${row.actual_quantity}`)}${cell(row.redeemed_count)}<td>${statusBadge(row.status)}</td>${dateCell(row.expires_at)}${dateCell(row.created_at)}<td class="actions">${row.status === "active" ? actionButton("revoke_batch", row.id, "ยกเลิกชุด", "button-danger") : ""}</td></tr>`,
  );
  return `
    ${heading("คูปอง", "สร้างและยกเลิกชุดคูปอง", `<button class="button button-primary" data-action="show-coupon-form">สร้างคูปอง</button>`)}
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

export function renderSessions(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.email, "primary")}${cell(row.device)}${cell(row.license_id ? row.license_id.slice(0, 8) : "—")}<td>${statusBadge(row.revoked_at ? "revoked" : "active")}</td>${dateCell(row.created_at)}${dateCell(row.last_seen_at)}<td class="actions">${row.revoked_at ? "" : actionButton("revoke_session", row.id, "ยกเลิก", "button-danger")}</td></tr>`,
  );
  return `${heading("เซสชันออนไลน์", "ตรวจสอบและยกเลิกการเชื่อมต่อของเครื่องลูกค้า")}${table(["สมาชิก", "อุปกรณ์", "License", "สถานะ", "เริ่มเมื่อ", "ใช้งานล่าสุด", "คำสั่ง"], body)}`;
}

export function renderInstallations(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.email, "primary")}${cell(row.display_name)}${cell(row.id.slice(0, 8))}<td>${statusBadge(row.status)}</td>${dateCell(row.created_at)}${dateCell(row.last_seen_at)}<td class="actions">${row.revoked_at ? "" : actionButton("revoke_installation", row.id, "เพิกถอนอุปกรณ์", "button-danger")}</td></tr>`,
  );
  return `${heading("อุปกรณ์", "อุปกรณ์ที่ลงทะเบียนและเวลาใช้งานล่าสุด")}${table(["สมาชิก", "ชื่ออุปกรณ์", "รหัส", "สถานะ", "สร้างเมื่อ", "ใช้งานล่าสุด", "คำสั่ง"], body)}`;
}

export function renderRedemptions(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.email, "primary")}${cell(row.product)}${cell(row.batch)}<td>${statusBadge(row.succeeded ? "success" : "rejected")}</td>${cell(row.error_code)}${dateCell(row.attempted_at)}</tr>`,
  );
  return `${heading("การใช้คูปอง", "ประวัติความสำเร็จและข้อผิดพลาดในการใช้คูปอง")}${table(["สมาชิก", "สินค้า", "ชุด", "ผลลัพธ์", "ข้อผิดพลาด", "เวลา"], body)}`;
}

export function renderAudit(rows = []) {
  const body = rows.map(
    (row) =>
      `<tr>${cell(row.event_type, "primary")}${cell(row.email)}${cell(JSON.stringify(row.metadata))}${dateCell(row.created_at)}</tr>`,
  );
  return `${heading("ประวัติการใช้งาน", "Audit log จากระบบ Launcher และคำสั่งผู้ดูแล")}${table(["ประเภท", "ผู้ใช้", "รายละเอียด", "เวลา"], body)}`;
}

export function renderSection(section, data) {
  if (section === "users") return renderUsers(data);
  if (section === "products") return renderProducts(data);
  if (section === "licenses") return renderLicenses(data);
  if (section === "coupons") return renderCoupons(data);
  if (section === "redemptions") return renderRedemptions(data);
  if (section === "installations") return renderInstallations(data);
  if (section === "sessions") return renderSessions(data);
  if (section === "audit") return renderAudit(data);
  return renderOverview(data);
}
