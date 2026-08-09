import * as api from "./api.js";
import {
  deleteCouponCodes,
  getCouponCodes,
  hasCouponCodes,
  saveCouponCodes,
} from "./coupon-archive.js";
import { createSessionController } from "./session.js";
import { createStore } from "./state.js";
import {
  couponForm,
  renderRecoveryCodeDialog,
  renderSection,
} from "./sections/render.js";
import { loginView, shellView } from "./ui/layout.js";
import { escapeHtml } from "./ui/escape.js";
import { toast } from "./ui/toast.js";

const root = document.querySelector("#app");
const store = createStore();
let loginError = "";
let recoveryCodeDialog = null;
let recoveryCountdownTimer = null;
let loadRequestId = 0;
let actionInFlight = false;

function render() {
  if (!session.authenticated) {
    recoveryCodeDialog = null;
    root.innerHTML = loginView(loginError);
    return;
  }
  root.innerHTML = shellView(store.state.active, session.viewer);
  const content = root.querySelector("#content");
  if (store.state.loading) {
    content.innerHTML = `<div class="panel"><div class="empty">กำลังโหลดข้อมูล…</div></div>`;
  } else if (store.state.error) {
    content.innerHTML = `<div class="panel"><div class="form-error">${escapeHtml(store.state.error)}</div></div>`;
  } else {
    const sectionData = store.state.data[store.state.active];
    const renderedData =
      store.state.active === "coupons" && Array.isArray(sectionData)
        ? sectionData.map((row) => ({
            ...row,
            has_archived_codes: hasCouponCodes(row.id),
          }))
        : sectionData;
    content.innerHTML = renderSection(store.state.active, renderedData, session.viewer);
    if (store.state.couponFormOpen) {
      const host = root.querySelector("#coupon-form-host");
      if (host) host.innerHTML = couponForm();
    }
  }
  root.insertAdjacentHTML("beforeend", renderRecoveryCodeDialog(recoveryCodeDialog));
}

async function handleUnauthorized(error) {
  if (error?.status !== 401) return false;
  await session.logout({ forceLocal: true });
  return true;
}

async function load(section = store.state.active) {
  const requestId = ++loadRequestId;
  store.patch({ loading: true, error: "" });
  try {
    const result = await api.loadResource(section);
    if (requestId !== loadRequestId || section !== store.state.active) return;
    store.patch({
      data: { ...store.state.data, [section]: result.data },
      loading: false,
    });
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    if (requestId !== loadRequestId || section !== store.state.active) return;
    store.patch({
      loading: false,
      error: error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ",
    });
  }
}

async function action(name, id) {
  const row = (store.state.data[store.state.active] || []).find((item) => item.id === id);
  if (name === "generate_recovery_code") {
    if (!row || row.role !== "customer") return;
    recoveryCodeDialog = {
      userId: row.id,
      username: String(row.username || "").trim().toLowerCase(),
      phase: "confirm",
      error: "",
      recoveryCode: "",
      countdown: "05:00",
      expiresAt: "",
    };
    render();
    return;
  }
  if (["suspend_user", "ban_user", "activate_user"].includes(name)) {
    const nextStatus = {
      suspend_user: "suspended",
      ban_user: "banned",
      activate_user: "active",
    }[name];
    const confirmation = {
      suspended:
        "ระงับบัญชีนี้หรือไม่ บัญชีจะใช้ทุกการติดตั้งไม่ได้และ Launcher session ปัจจุบันทั้งหมดจะถูกยกเลิก",
      banned:
        "แบนบัญชีนี้หรือไม่ บัญชีจะใช้ทุกการติดตั้งไม่ได้และ Launcher session ปัจจุบันทั้งหมดจะถูกยกเลิก",
      active: "เปิดใช้บัญชีนี้อีกครั้งหรือไม่",
    }[nextStatus];
    if (!window.confirm(confirmation)) return;
    await run({ action: "set_user_status", userId: id, status: nextStatus });
    return;
  }
  if (name === "extend_license") {
    const days = Number(window.prompt("ต้องการต่ออายุกี่วัน", "30"));
    if (!Number.isInteger(days) || days < 1) return;
    await run({ action: "extend_license", licenseId: id, days });
    return;
  }
  const targetLabel = [
    row?.username,
    row?.display_name || row?.device,
    row?.product || row?.batch,
  ].filter(Boolean).join(" / ");
  const labels = {
    revoke_license: "ยกเลิก License นี้หรือไม่",
    revoke_installation:
      "บล็อกเฉพาะการติดตั้งนี้และยกเลิกเซสชันปัจจุบันของการติดตั้งนี้หรือไม่ หากต้องการระงับการใช้งานทุกเครื่อง ให้ระงับบัญชีแทน การระงับบัญชีจะทำให้ทุกการติดตั้งของบัญชีไม่สามารถเปิด Launcher session ใหม่ได้ และจะยกเลิก Launcher session ปัจจุบันทั้งหมด",
    revoke_session: "ยกเลิก session นี้หรือไม่",
    revoke_batch: "ยกเลิกคูปองทั้งชุดนี้หรือไม่",
    delete_batch: "ลบชุดคูปองนี้ถาวรหรือไม่ การดำเนินการนี้ย้อนกลับไม่ได้",
  };
  const confirmation = `${labels[name] || "ยืนยันคำสั่งนี้หรือไม่"}${targetLabel ? `
เป้าหมาย: ${targetLabel}` : ""}`;
  if (!window.confirm(confirmation)) return;
  const payload = {
    revoke_license: { action: name, licenseId: id },
    revoke_installation: { action: name, installationId: id },
    revoke_session: { action: name, sessionId: id },
    revoke_batch: { action: name, batchId: id },
    delete_batch: { action: name, batchId: id },
  }[name];
  if (payload) {
    const succeeded = await run(payload);
    if (succeeded && name === "delete_batch") deleteCouponCodes(id);
  }
}

function closeRecoveryCodeDialog() {
  clearInterval(recoveryCountdownTimer);
  recoveryCountdownTimer = null;
  if (recoveryCodeDialog) {
    recoveryCodeDialog.recoveryCode = "";
    recoveryCodeDialog.error = "";
  }
  recoveryCodeDialog = null;
  render();
}

function updateRecoveryCountdown() {
  if (!recoveryCodeDialog?.expiresAt) return;
  const remaining = Math.max(0, Date.parse(recoveryCodeDialog.expiresAt) - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  recoveryCodeDialog.countdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  render();
}

async function submitRecoveryCode(form) {
  if (!recoveryCodeDialog || recoveryCodeDialog.phase === "submitting") return;
  const formData = new FormData(form);
  const confirmUsername = String(formData.get("confirmUsername") || "")
    .trim()
    .toLowerCase();
  if (confirmUsername !== recoveryCodeDialog.username) {
    recoveryCodeDialog.error = "Username ที่ยืนยันไม่ตรงกับบัญชี";
    render();
    return;
  }
  recoveryCodeDialog.phase = "submitting";
  recoveryCodeDialog.error = "";
  render();
  try {
    const result = await api.runAction({
      action: "generate_recovery_code",
      userId: recoveryCodeDialog.userId,
      confirmUsername,
    });
    recoveryCodeDialog.phase = "success";
    recoveryCodeDialog.recoveryCode = String(result.recovery_code || "");
    recoveryCodeDialog.expiresAt = String(result.expires_at || "");
    if (!recoveryCodeDialog.recoveryCode || !Number.isFinite(Date.parse(recoveryCodeDialog.expiresAt))) {
      throw new Error("เซิร์ฟเวอร์ไม่ส่ง Recovery Code ที่ถูกต้องกลับมา");
    }
    updateRecoveryCountdown();
    recoveryCountdownTimer = setInterval(updateRecoveryCountdown, 1000);
    await load("users");
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    recoveryCodeDialog.phase = "confirm";
    recoveryCodeDialog.recoveryCode = "";
    recoveryCodeDialog.error =
      error instanceof Error ? error.message : "สร้าง Recovery Code ไม่สำเร็จ";
    render();
  }
}

async function run(payload) {
  if (actionInFlight) return false;
  actionInFlight = true;
  try {
    await api.runAction(payload);
    toast("ดำเนินการสำเร็จ", "success");
    await load();
    return true;
  } catch (error) {
    if (await handleUnauthorized(error)) return false;
    toast(error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ", "error");
    return false;
  } finally {
    actionInFlight = false;
  }
}

async function copyArchivedCoupons(batchId) {
  const codes = getCouponCodes(batchId);
  if (!codes.length) {
    toast("ไม่มีรหัสคูปองของชุดนี้ในเบราว์เซอร์เครื่องนี้", "error");
    return;
  }
  const text = codes.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast(`คัดลอกรหัสคูปอง ${codes.length} รายการแล้ว`, "success");
  } catch {
    window.prompt("คัดลอกรหัสคูปอง", text);
  }
}

async function submitCoupon(form) {
  if (actionInFlight) return;
  actionInFlight = true;
  const formData = new FormData(form);
  try {
    const result = await api.runAction({
      action: "generate_coupons",
      productCode: formData.get("productCode"),
      durationDays: Number(formData.get("durationDays")),
      quantity: Number(formData.get("quantity")),
      note: formData.get("note") || null,
    });
    store.patch({ couponFormOpen: false });
    const batchId = result.batch?.id;
    const archived = saveCouponCodes(batchId, result.codes);
    toast(`สร้างคูปอง ${result.codes?.length || 0} รายการแล้ว`, "success");
    if (result.codes?.length) {
      window.prompt(
        archived
          ? "คัดลอกคูปองชุดนี้ (บันทึกไว้ในเบราว์เซอร์นี้แล้ว)"
          : "คัดลอกคูปองชุดนี้และเก็บไว้ รหัสไม่สามารถเรียกย้อนหลังได้",
        result.codes.join("\n"),
      );
    }
    await load("coupons");
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    toast(error instanceof Error ? error.message : "สร้างคูปองไม่สำเร็จ", "error");
  } finally {
    actionInFlight = false;
  }
}

const session = createSessionController(() => {
  loginError = "";
  render();
});

store.subscribe(render);

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "login-form") {
    const form = new FormData(event.target);
    const username = form.get("username");
    const password = form.get("password");
    try {
      await session.login(String(username || ""), String(password || ""));
      await load("overview");
    } catch (error) {
      loginError = error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ";
      render();
    }
  } else if (event.target.id === "coupon-form") {
    await submitCoupon(event.target);
  } else if (event.target.id === "recovery-code-form") {
    await submitRecoveryCode(event.target);
  }
});

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-section], [data-action]");
  if (!target) return;
  if (target.dataset.section) {
    closeRecoveryCodeDialog();
    store.patch({ active: target.dataset.section, couponFormOpen: false });
    await load(target.dataset.section);
    return;
  }
  const name = target.dataset.action;
  if (name === "logout") {
    closeRecoveryCodeDialog();
    try {
      await session.logout();
    } catch {
      toast("ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง", "error");
    }
    return;
  }
  if (name === "close_recovery_code") {
    closeRecoveryCodeDialog();
    return;
  }
  if (name === "copy_recovery_code") {
    const code = recoveryCodeDialog?.recoveryCode || "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("คัดลอก Recovery Code แล้ว", "success");
    } catch {
      toast("คัดลอกอัตโนมัติไม่สำเร็จ กรุณาเลือกและคัดลอกรหัสด้วยตนเอง", "error");
    }
    return;
  }
  if (name === "show-coupon-form") {
    store.patch({ couponFormOpen: true });
    return;
  }
  if (name === "hide-coupon-form") {
    store.patch({ couponFormOpen: false });
    return;
  }
  if (name === "copy_coupon_codes") {
    await copyArchivedCoupons(target.dataset.id);
    return;
  }
  await action(name, target.dataset.id);
});

render();
void session.restore().then((restored) => {
  if (restored) void load("overview");
});