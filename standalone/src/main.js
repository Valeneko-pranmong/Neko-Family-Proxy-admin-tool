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
  renderPasswordResetDialog,
  renderSection,
} from "./sections/render.js";
import { loginView, shellView } from "./ui/layout.js";
import { toast } from "./ui/toast.js";

const root = document.querySelector("#app");
const store = createStore();
let loginError = "";
let passwordResetDialog = null;

function render() {
  if (!session.authenticated) {
    passwordResetDialog = null;
    root.innerHTML = loginView(loginError);
    return;
  }
  root.innerHTML = shellView(store.state.active, session.viewer);
  const content = root.querySelector("#content");
  if (store.state.loading) {
    content.innerHTML = `<div class="panel"><div class="empty">กำลังโหลดข้อมูล…</div></div>`;
  } else if (store.state.error) {
    content.innerHTML = `<div class="panel"><div class="form-error">${store.state.error}</div></div>`;
  } else {
    const sectionData = store.state.data[store.state.active];
    const renderedData =
      store.state.active === "coupons" && Array.isArray(sectionData)
        ? sectionData.map((row) => ({
            ...row,
            has_archived_codes: hasCouponCodes(row.id),
          }))
        : sectionData;
    content.innerHTML = renderSection(store.state.active, renderedData);
    if (store.state.couponFormOpen) {
      const host = root.querySelector("#coupon-form-host");
      if (host) host.innerHTML = couponForm();
    }
  }
  root.insertAdjacentHTML("beforeend", renderPasswordResetDialog(passwordResetDialog));
}

async function load(section = store.state.active) {
  store.patch({ loading: true, error: "" });
  try {
    const result = await api.loadResource(section);
    store.patch({
      data: { ...store.state.data, [section]: result.data },
      loading: false,
    });
  } catch (error) {
    if (error?.status === 401) {
      await session.logout().catch(() => {});
      return;
    }
    store.patch({
      loading: false,
      error: error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ",
    });
  }
}

async function action(name, id) {
  const row = (store.state.data[store.state.active] || []).find((item) => item.id === id);
  if (name === "reset_user_password") {
    if (!row || row.role !== "customer") return;
    passwordResetDialog = {
      userId: row.id,
      username: String(row.username || "").trim().toLowerCase(),
      phase: "confirm",
      error: "",
      temporaryPassword: "",
    };
    render();
    return;
  }
  if (name === "toggle_user_status") {
    const nextStatus = row?.status === "active" ? "suspended" : "active";
    if (!window.confirm(`ยืนยันเปลี่ยนสถานะสมาชิกเป็น ${nextStatus} หรือไม่`)) return;
    await run({ action: "set_user_status", userId: id, status: nextStatus });
    return;
  }
  if (name === "extend_license") {
    const days = Number(window.prompt("ต้องการต่ออายุกี่วัน", "30"));
    if (!Number.isInteger(days) || days < 1) return;
    await run({ action: "extend_license", licenseId: id, days });
    return;
  }
  const labels = {
    revoke_license: "ยกเลิก License นี้หรือไม่",
    revoke_installation: "เพิกถอนอุปกรณ์และเซสชันที่ยังใช้งานอยู่ทั้งหมดหรือไม่",
    revoke_session: "ยกเลิก session นี้หรือไม่",
    revoke_batch: "ยกเลิกคูปองทั้งชุดนี้หรือไม่",
    delete_batch: "ลบชุดคูปองนี้ถาวรหรือไม่ การดำเนินการนี้ย้อนกลับไม่ได้",
  };
  if (!window.confirm(labels[name] || "ยืนยันคำสั่งนี้หรือไม่")) return;
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

function closePasswordResetDialog() {
  if (passwordResetDialog) {
    passwordResetDialog.temporaryPassword = "";
    passwordResetDialog.error = "";
  }
  passwordResetDialog = null;
  render();
}

async function submitPasswordReset(form) {
  if (!passwordResetDialog || passwordResetDialog.phase === "submitting") return;
  const formData = new FormData(form);
  const confirmUsername = String(formData.get("confirmUsername") || "")
    .trim()
    .toLowerCase();
  if (confirmUsername !== passwordResetDialog.username) {
    passwordResetDialog.error = "Username ที่ยืนยันไม่ตรงกับบัญชี";
    render();
    return;
  }
  passwordResetDialog.phase = "submitting";
  passwordResetDialog.error = "";
  render();
  try {
    const result = await api.runAction({
      action: "reset_user_password",
      userId: passwordResetDialog.userId,
      confirmUsername,
    });
    passwordResetDialog.phase = "success";
    passwordResetDialog.temporaryPassword = String(result.temporaryPassword || "");
    if (!passwordResetDialog.temporaryPassword) {
      throw new Error("เซิร์ฟเวอร์ไม่ส่งรหัสผ่านชั่วคราวกลับมา");
    }
    render();
    await load("users");
  } catch (error) {
    passwordResetDialog.phase = "confirm";
    passwordResetDialog.temporaryPassword = "";
    passwordResetDialog.error =
      error instanceof Error ? error.message : "ตั้งรหัสผ่านใหม่ไม่สำเร็จ";
    render();
  }
}

async function run(payload) {
  try {
    await api.runAction(payload);
    toast("ดำเนินการสำเร็จ", "success");
    await load();
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ", "error");
    return false;
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
    toast(error instanceof Error ? error.message : "สร้างคูปองไม่สำเร็จ", "error");
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
  } else if (event.target.id === "password-reset-form") {
    await submitPasswordReset(event.target);
  }
});

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-section], [data-action]");
  if (!target) return;
  if (target.dataset.section) {
    closePasswordResetDialog();
    store.patch({ active: target.dataset.section, couponFormOpen: false });
    await load(target.dataset.section);
    return;
  }
  const name = target.dataset.action;
  if (name === "logout") {
    passwordResetDialog = null;
    await session.logout().catch(() => {});
    return;
  }
  if (name === "close_password_reset") {
    closePasswordResetDialog();
    return;
  }
  if (name === "copy_temporary_password") {
    const password = passwordResetDialog?.temporaryPassword || "";
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast("คัดลอกรหัสผ่านชั่วคราวแล้ว", "success");
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
