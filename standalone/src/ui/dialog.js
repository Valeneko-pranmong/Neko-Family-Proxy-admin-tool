import { escapeHtml } from "./escape.js";
import { toast } from "./toast.js";

const ICON_TICKET = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>`;
const ICON_CHECK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10 15 7 12"/></svg>`;
const ICON_ALERT_TRIANGLE = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_SHIELD_ALERT = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
const ICON_CLOCK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_COPY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_CHECK_SMALL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_CLOSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

let activeModalEl = null;
let activeModalCleanup = null;

export async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const successful = document.execCommand("copy");
    textarea.remove();
    return Boolean(successful);
  } catch {
    return false;
  }
}

export function closeActiveModal() {
  if (activeModalCleanup) {
    const fn = activeModalCleanup;
    activeModalCleanup = null;
    fn();
  }
  if (activeModalEl) {
    const el = activeModalEl;
    activeModalEl = null;
    el.classList.add("modal-backdrop-exit");
    setTimeout(() => {
      el.remove();
    }, 140);
  }
}

function mountModal(modalHtml, setupFn) {
  closeActiveModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role", "presentation");
  backdrop.innerHTML = modalHtml;
  document.body.appendChild(backdrop);
  activeModalEl = backdrop;

  const card = backdrop.querySelector(".modal-card");

  const onKeydown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeActiveModal();
    }
  };
  window.addEventListener("keydown", onKeydown);

  const onClickBackdrop = (e) => {
    if (e.target === backdrop) {
      closeActiveModal();
    }
  };
  backdrop.addEventListener("click", onClickBackdrop);

  activeModalCleanup = () => {
    window.removeEventListener("keydown", onKeydown);
    backdrop.removeEventListener("click", onClickBackdrop);
  };

  if (setupFn) {
    setupFn(backdrop, card);
  }

  return backdrop;
}

export function showCouponModal({
  title = "สร้างคูปองสำเร็จ",
  codes = [],
  archived = false,
  durationDays = null,
  quantity = null,
  productCode = "",
}) {
  const codesList = Array.isArray(codes) ? codes : [codes].filter(Boolean);
  const totalCount = codesList.length;
  const isSingle = totalCount === 1;
  const singleCode = isSingle ? codesList[0] : "";
  const allCodesText = codesList.join("\n");

  const subtitleParts = [];
  if (totalCount > 0) subtitleParts.push(`${totalCount} รายการ`);
  if (durationDays) subtitleParts.push(`อายุการใช้งาน ${durationDays} วัน`);
  if (productCode) subtitleParts.push(`สินค้า ${productCode}`);
  const subtitle = subtitleParts.join(" · ");

  const noticeHtml = archived
    ? `
      <div class="modal-notice modal-notice-success">
        <span class="modal-notice-icon" aria-hidden="true">${ICON_CHECK}</span>
        <div class="modal-notice-content">
          <strong>บันทึกไว้ในเบราว์เซอร์นี้แล้ว</strong>
          <p>รหัสถูกจัดเก็บลงในคลังของเบราว์เซอร์เครื่องนี้แล้ว สามารถดูหรือคัดลอกซ้ำได้ที่ตารางคูปอง</p>
        </div>
      </div>
    `
    : `
      <div class="modal-notice modal-notice-warn">
        <span class="modal-notice-icon" aria-hidden="true">${ICON_ALERT_TRIANGLE}</span>
        <div class="modal-notice-content">
          <strong>รหัสไม่สามารถเรียกย้อนหลังได้</strong>
          <p>กรุณาคัดลอกและบันทึกรหัสไว้ทันที ระบบจะไม่สามารถแสดงรหัสชุดนี้ซ้ำได้อีกหลังจากปิดหน้าต่างนี้</p>
        </div>
      </div>
    `;

  const codeDisplayHtml = isSingle
    ? `
      <div class="coupon-code-single">
        <div class="code-header">
          <span>รหัสคูปอง</span>
          <span class="code-badge">คลิกเพื่อคัดลอก</span>
        </div>
        <div class="code-pill-row">
          <code class="code-text" id="coupon-single-code" tabindex="0" role="button" title="คลิกเพื่อคัดลอก">${escapeHtml(singleCode)}</code>
          <button type="button" class="button button-ghost button-small copy-single-btn" id="btn-copy-single" aria-label="คัดลอกรหัส" title="คัดลอกรหัส">
            ${ICON_COPY}
          </button>
        </div>
      </div>
    `
    : `
      <div class="coupon-code-multi">
        <div class="code-header">
          <span>รหัสคูปองทั้งหมด (${totalCount} รายการ)</span>
          <span class="code-badge">1 บรรทัดต่อ 1 รหัส</span>
        </div>
        <textarea class="code-textarea" id="coupon-multi-textarea" readonly rows="${Math.min(8, Math.max(3, totalCount + 1))}">${escapeHtml(allCodesText)}</textarea>
      </div>
    `;

  const html = `
    <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="coupon-modal-title">
      <div class="modal-header">
        <div class="modal-icon modal-icon-brand" aria-hidden="true">${ICON_TICKET}</div>
        <div class="modal-title-group">
          <h2 class="modal-title" id="coupon-modal-title">${escapeHtml(title)}</h2>
          ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <button type="button" class="modal-close-btn" id="btn-modal-x" aria-label="ปิด">${ICON_CLOSE}</button>
      </div>
      ${noticeHtml}
      ${codeDisplayHtml}
      <div class="modal-actions">
        <button type="button" class="button button-primary" id="btn-copy-all">
          <span class="btn-icon" aria-hidden="true">${ICON_COPY}</span>
          <span class="btn-label">${isSingle ? "คัดลอกรหัส" : `คัดลอกทั้งหมด (${totalCount} รายการ)`}</span>
        </button>
        <button type="button" class="button" id="btn-modal-close">ปิดหน้าต่าง</button>
      </div>
    </section>
  `;

  mountModal(html, (backdrop, card) => {
    const copyAllBtn = card.querySelector("#btn-copy-all");
    const closeBtn = card.querySelector("#btn-modal-close");
    const xBtn = card.querySelector("#btn-modal-x");
    const singleCodeEl = card.querySelector("#coupon-single-code");
    const copySingleBtn = card.querySelector("#btn-copy-single");
    const textareaEl = card.querySelector("#coupon-multi-textarea");

    const handleCopy = async () => {
      const ok = await copyTextToClipboard(allCodesText);
      if (ok) {
        toast(`คัดลอกรหัสคูปอง ${totalCount} รายการแล้ว`, "success");
        if (copyAllBtn) {
          copyAllBtn.classList.add("button-success-solid");
          copyAllBtn.innerHTML = `<span class="btn-icon" aria-hidden="true">${ICON_CHECK_SMALL}</span> <span class="btn-label">คัดลอกเรียบร้อยแล้ว</span>`;
          setTimeout(() => {
            if (copyAllBtn && document.body.contains(copyAllBtn)) {
              copyAllBtn.classList.remove("button-success-solid");
              copyAllBtn.innerHTML = `<span class="btn-icon" aria-hidden="true">${ICON_COPY}</span> <span class="btn-label">${isSingle ? "คัดลอกรหัส" : `คัดลอกทั้งหมด (${totalCount} รายการ)`}</span>`;
            }
          }, 2000);
        }
      } else {
        toast("คัดลอกอัตโนมัติไม่สำเร็จ กรุณากดเลือกและคัดลอกด้วยตนเอง", "error");
        if (textareaEl) textareaEl.select();
      }
    };

    if (copyAllBtn) copyAllBtn.addEventListener("click", handleCopy);
    if (copySingleBtn) copySingleBtn.addEventListener("click", handleCopy);
    if (closeBtn) closeBtn.addEventListener("click", closeActiveModal);
    if (xBtn) xBtn.addEventListener("click", closeActiveModal);

    if (singleCodeEl) {
      singleCodeEl.addEventListener("click", () => {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(singleCodeEl);
        sel.removeAllRanges();
        sel.addRange(range);
        void handleCopy();
      });
    }

    if (textareaEl) {
      textareaEl.addEventListener("click", () => {
        textareaEl.select();
      });
    }

    if (copyAllBtn) copyAllBtn.focus();
  });
}

export function showConfirmModal({
  title = "ยืนยันการดำเนินการ",
  message = "ต้องการดำเนินการตามคำสั่งนี้หรือไม่",
  target = "",
  tone = "danger",
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        closeActiveModal();
        resolve(result);
      }
    };

    const isDanger = tone === "danger";
    const isSuccess = tone === "success";
    const icon = isDanger ? ICON_SHIELD_ALERT : isSuccess ? ICON_CHECK : ICON_ALERT_TRIANGLE;
    const iconClass = isDanger ? "modal-icon-danger" : isSuccess ? "modal-icon-success" : "modal-icon-warning";
    const confirmBtnClass = isDanger ? "button-danger-solid" : isSuccess ? "button-success-solid" : "button-primary";

    const targetHtml = target
      ? `
        <div class="modal-target-card">
          <span class="target-label">เป้าหมาย:</span>
          <code class="target-value">${escapeHtml(target)}</code>
        </div>
      `
      : "";

    const html = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <div class="modal-header">
          <div class="modal-icon ${iconClass}" aria-hidden="true">${icon}</div>
          <div class="modal-title-group">
            <h2 class="modal-title" id="confirm-modal-title">${escapeHtml(title)}</h2>
            <p class="modal-subtitle">${escapeHtml(message)}</p>
          </div>
          <button type="button" class="modal-close-btn" id="btn-modal-x" aria-label="ปิด">${ICON_CLOSE}</button>
        </div>
        ${targetHtml}
        <div class="modal-actions">
          <button type="button" class="button ${confirmBtnClass}" id="btn-confirm">${escapeHtml(confirmText)}</button>
          <button type="button" class="button" id="btn-cancel">${escapeHtml(cancelText)}</button>
        </div>
      </section>
    `;

    mountModal(html, (backdrop, card) => {
      const confirmBtn = card.querySelector("#btn-confirm");
      const cancelBtn = card.querySelector("#btn-cancel");
      const xBtn = card.querySelector("#btn-modal-x");

      if (confirmBtn) confirmBtn.addEventListener("click", () => finish(true));
      if (cancelBtn) cancelBtn.addEventListener("click", () => finish(false));
      if (xBtn) xBtn.addEventListener("click", () => finish(false));

      if (confirmBtn) confirmBtn.focus();
    });

    const originalCleanup = activeModalCleanup;
    activeModalCleanup = () => {
      if (originalCleanup) originalCleanup();
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    };
  });
}

export function showExtendLicenseModal({
  target = "",
  defaultDays = 30,
}) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        closeActiveModal();
        resolve(result);
      }
    };

    const targetHtml = target
      ? `
        <div class="modal-target-card">
          <span class="target-label">เป้าหมาย:</span>
          <code class="target-value">${escapeHtml(target)}</code>
        </div>
      `
      : "";

    const html = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="extend-modal-title">
        <div class="modal-header">
          <div class="modal-icon modal-icon-brand" aria-hidden="true">${ICON_CLOCK}</div>
          <div class="modal-title-group">
            <h2 class="modal-title" id="extend-modal-title">ต่ออายุ License</h2>
            <p class="modal-subtitle">ระบุจำนวนวันที่ต้องการขยายระยะเวลาใช้งาน</p>
          </div>
          <button type="button" class="modal-close-btn" id="btn-modal-x" aria-label="ปิด">${ICON_CLOSE}</button>
        </div>
        ${targetHtml}
        <form id="extend-license-form" class="stack">
          <label for="extend-days-input" class="field-label">จำนวนวันที่ต้องการต่ออายุ</label>
          <div class="field-with-unit">
            <input id="extend-days-input" name="days" type="number" min="1" max="3650" value="${defaultDays}" required class="modal-input" />
            <span class="input-unit">วัน</span>
          </div>
          <div class="preset-chips" aria-label="เลือกจำนวนวันด่วน">
            <button type="button" class="chip-button ${defaultDays === 7 ? 'is-active' : ''}" data-days="7">+7 วัน</button>
            <button type="button" class="chip-button ${defaultDays === 15 ? 'is-active' : ''}" data-days="15">+15 วัน</button>
            <button type="button" class="chip-button ${defaultDays === 30 ? 'is-active' : ''}" data-days="30">+30 วัน</button>
            <button type="button" class="chip-button ${defaultDays === 90 ? 'is-active' : ''}" data-days="90">+90 วัน</button>
            <button type="button" class="chip-button ${defaultDays === 365 ? 'is-active' : ''}" data-days="365">+1 ปี (365)</button>
          </div>
          <div class="modal-actions">
            <button type="submit" class="button button-primary" id="btn-submit-extend">ยืนยันต่ออายุ</button>
            <button type="button" class="button" id="btn-cancel-extend">ยกเลิก</button>
          </div>
        </form>
      </section>
    `;

    mountModal(html, (backdrop, card) => {
      const form = card.querySelector("#extend-license-form");
      const input = card.querySelector("#extend-days-input");
      const cancelBtn = card.querySelector("#btn-cancel-extend");
      const xBtn = card.querySelector("#btn-modal-x");
      const chips = card.querySelectorAll(".chip-button");

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          const daysVal = Number(chip.dataset.days);
          if (input) {
            input.value = String(daysVal);
            chips.forEach((c) => c.classList.toggle("is-active", c === chip));
            input.focus();
          }
        });
      });

      if (input) {
        input.addEventListener("input", () => {
          const curVal = Number(input.value);
          chips.forEach((c) => c.classList.toggle("is-active", Number(c.dataset.days) === curVal));
        });
        setTimeout(() => {
          input.focus();
          input.select();
        }, 50);
      }

      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const days = Number(input.value);
          if (Number.isInteger(days) && days >= 1) {
            finish(days);
          }
        });
      }

      if (cancelBtn) cancelBtn.addEventListener("click", () => finish(null));
      if (xBtn) xBtn.addEventListener("click", () => finish(null));
    });

    const originalCleanup = activeModalCleanup;
    activeModalCleanup = () => {
      if (originalCleanup) originalCleanup();
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    };
  });
}

export function showCopyModal({
  title = "คัดลอกรหัส",
  text = "",
  note = "",
}) {
  const html = `
    <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="copy-modal-title">
      <div class="modal-header">
        <div class="modal-icon modal-icon-brand" aria-hidden="true">${ICON_COPY}</div>
        <div class="modal-title-group">
          <h2 class="modal-title" id="copy-modal-title">${escapeHtml(title)}</h2>
          <p class="modal-subtitle">${escapeHtml(note || "เลือกหรือกดปุ่มเพื่อคัดลอกข้อความ")}</p>
        </div>
        <button type="button" class="modal-close-btn" id="btn-modal-x" aria-label="ปิด">${ICON_CLOSE}</button>
      </div>
      <div class="coupon-code-multi">
        <textarea class="code-textarea" id="copy-modal-textarea" readonly rows="4">${escapeHtml(text)}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="button button-primary" id="btn-modal-copy">คัดลอก</button>
        <button type="button" class="button" id="btn-modal-close">ปิด</button>
      </div>
    </section>
  `;

  mountModal(html, (backdrop, card) => {
    const textarea = card.querySelector("#copy-modal-textarea");
    const copyBtn = card.querySelector("#btn-modal-copy");
    const closeBtn = card.querySelector("#btn-modal-close");
    const xBtn = card.querySelector("#btn-modal-x");

    if (textarea) {
      setTimeout(() => textarea.select(), 50);
      textarea.addEventListener("click", () => textarea.select());
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast("คัดลอกแล้ว", "success");
          closeActiveModal();
        } catch {
          if (textarea) textarea.select();
        }
      });
    }

    if (closeBtn) closeBtn.addEventListener("click", closeActiveModal);
    if (xBtn) xBtn.addEventListener("click", closeActiveModal);
  });
}
