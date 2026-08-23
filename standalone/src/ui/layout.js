import { sections } from "../config.js";
import { escapeHtml } from "./escape.js";

const EYE_OPEN = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>`;
const MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const SUN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`;

export function themeToggleHtml(extraClass = "") {
  return `
    <button type="button" class="theme-toggle ${extraClass}" data-action="toggle_theme" aria-label="สลับโหมดสว่าง/มืด" title="สลับโหมดสว่าง/มืด">
      <span class="icon-moon">${MOON}</span>
      <span class="icon-sun">${SUN}</span>
    </button>
  `;
}

function passwordField({ id, name, label, autocomplete }) {
  return `
    <label for="${id}">${label}</label>
    <div class="field">
      <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" required placeholder="••••••••" />
      <button type="button" class="password-toggle" data-toggle-password="#${id}" aria-label="แสดงหรือซ่อนรหัสผ่าน">
        <span class="eye-open">${EYE_OPEN}</span>
        <span class="eye-closed">${EYE_CLOSED}</span>
      </button>
    </div>
  `;
}

export function loginView(error = "") {
  return `
    <main class="auth-page">
      ${themeToggleHtml("theme-toggle-floating")}
      <section class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark">✦</div>
          <div>
            <div class="brand-mark-text">NEKO CONTROL</div>
            <div class="brand-subtitle">Vercel Admin Console</div>
          </div>
        </div>
        <h1>เข้าสู่ระบบผู้ดูแล</h1>
        <p class="muted auth-sub">ใช้บัญชี Supabase ที่มี role เป็น admin</p>
        <form id="login-form" class="stack">
          <label for="admin-username">Username</label>
          <input id="admin-username" name="username" type="text" autocomplete="username" required placeholder="admin" />
          ${passwordField({
            id: "admin-password",
            name: "password",
            label: "รหัสผ่าน",
            autocomplete: "current-password",
          })}
          <button class="button button-primary" type="submit" data-label-idle="เข้าสู่ระบบ">เข้าสู่ระบบ</button>
          <div id="login-error" class="form-error" role="alert" ${error ? "" : "hidden"}>${escapeHtml(error)}</div>
        </form>
      </section>
      <p class="auth-footnote">การเข้าถึงทั้งหมดได้รับการตรวจสอบสิทธิ์และบันทึกใน audit log</p>
    </main>
  `;
}

export function shellView(active, viewer) {
  const adminName = viewer?.name || viewer?.username || "Admin";
  const avatarText = escapeHtml(
    String(adminName).trim().slice(0, 1).toUpperCase() || "N",
  );
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-row">
            <div class="brand-mark">✦</div>
            <div>
              <div class="brand-mark-text">NEKO CONTROL</div>
              <div class="brand-subtitle">Vercel Admin Console</div>
            </div>
          </div>
        </div>
        <nav class="nav" aria-label="เมนูผู้ดูแล">
          ${sections
            .map(
              (section) =>
                `<button class="nav-item ${section.id === active ? "is-active" : ""}" data-section="${section.id}" ${section.id === active ? 'aria-current="page"' : ""}><span aria-hidden="true">${section.icon || "•"}</span>${section.label}</button>`,
            )
            .join("")}
        </nav>
        <div class="sidebar-footer">
          <div class="admin-chip">
            <div class="avatar" aria-hidden="true">${avatarText}</div>
            <div class="admin-meta">
              <div class="admin-label">${escapeHtml(adminName)}</div>
              <div class="admin-role">Administrator</div>
            </div>
          </div>
          <div class="admin-actions-row">
            <button class="button button-ghost button-small" data-action="logout">ออกจากระบบ</button>
            ${themeToggleHtml()}
          </div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <div class="eyebrow">Neko Family Proxy</div>
            <h1>Control Room</h1>
          </div>
          <span class="deployment-chip"><i aria-hidden="true"></i>VERCEL SECURE</span>
        </header>
        <div id="content"></div>
      </main>
    </div>
    <div id="toast" class="toast" hidden></div>
  `;
}
