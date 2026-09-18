import * as api from "./api.js";
import {
  deleteCouponCodes,
  getCouponCodes,
  hasCouponCodes,
  saveCouponCodes,
} from "./coupon-archive.js";
import { createSessionController } from "./session.js";
import { appendLiveServerSample, createStore } from "./state.js";
import {
  couponForm,
  renderRecoveryCodeDialog,
  renderSection,
  renderSectionRefreshNotice,
} from "./sections/render.js";
import { loginView, shellView } from "./ui/layout.js";
import { escapeHtml } from "./ui/escape.js";
import { toast } from "./ui/toast.js";
import {
  showCouponModal,
  showConfirmModal,
  showExtendLicenseModal,
  showCopyModal,
  copyTextToClipboard,
} from "./ui/dialog.js";

const POLL_CADENCE_MS = 5000;
const HISTORY_POLL_CADENCE_MS = 30000;
const THEME_STORAGE_KEY = "neko-control-theme";

function resolveInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // storage unavailable — fall through to system preference
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let activeTheme = resolveInitialTheme();
document.documentElement.dataset.theme = activeTheme;

function toggleTheme() {
  activeTheme = activeTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = activeTheme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
  } catch {
    // non-fatal — next visit just falls back to system preference
  }
}

const root = document.querySelector("#app");
const store = createStore();
let loginError = "";
let recoveryCodeDialog = null;
let recoveryCountdownTimer = null;
let loadRequestId = 0;
let actionInFlight = false;
let pollTimer = null;
let pollInFlight = false;
let historyPollTimer = null;
let historyRequestInFlight = false;
let historyRequestId = 0;

function render() {
  if (!session.authenticated) {
    recoveryCodeDialog = null;
    stopPolling();
    root.innerHTML = loginView(loginError);
    return;
  }
  root.innerHTML = shellView(store.state.active, session.viewer);
  const content = root.querySelector("#content");
  const sectionData = store.state.data[store.state.active];
  if (store.state.loading && sectionData === undefined) {
    content.innerHTML = `<div class="dashboard-skeleton" role="status" aria-label="กำลังโหลดข้อมูล"><div></div><div></div><div></div><div></div><div></div><div></div><section></section></div>`;
  } else if (store.state.error && sectionData === undefined) {
    content.innerHTML = `<div class="panel"><div class="form-error">${escapeHtml(store.state.error)}</div></div>`;
  } else {
    const renderedData =
      store.state.active === "coupons" && Array.isArray(sectionData)
        ? sectionData.map((row) => ({
            ...row,
            has_archived_codes: hasCouponCodes(row.id),
          }))
        : store.state.active === "overview"
          ? {
              ...(sectionData || {}),
              liveServerHistory: store.state.liveServerHistory,
              serverChartRange: store.state.serverChartRange,
              serverHistory: store.state.serverHistory,
              _ui: { refreshing: store.state.refreshing, error: store.state.error },
            }
          : sectionData;
    const refreshNotice = store.state.active === "overview"
      ? ""
      : renderSectionRefreshNotice({
          refreshing: store.state.refreshing,
          error: store.state.error,
        });
    const currentPage = store.state.tablePages?.[store.state.active] || 1;
    content.innerHTML = `${refreshNotice}${renderSection(
      store.state.active,
      renderedData,
      session.viewer,
      store.state.actionBusyId,
      currentPage,
    )}`;
    if (store.state.couponFormOpen) {
      const host = root.querySelector("#coupon-form-host");
      if (host) host.innerHTML = couponForm();
    }
  }
  root.insertAdjacentHTML("beforeend", renderRecoveryCodeDialog(recoveryCodeDialog));
}

async function handleUnauthorized(error) {
  if (error?.status !== 401) return false;
  stopPolling();
  await session.logout({ forceLocal: true });
  return true;
}

async function fetchServerMetricsHistory(range = store.state.serverChartRange, isInterval = false) {
  if (range === "live") return;
  if (historyRequestInFlight) return;
  const requestId = ++historyRequestId;
  historyRequestInFlight = true;

  if (!isInterval) {
    store.patch({
      serverHistory: {
        ...store.state.serverHistory,
        loading: true,
        error: "",
      },
    });
  }

  try {
    const result = await api.loadServerMetricsHistory(range);
    // RACE PROTECTION 1 & 2: Range switch & Live switch check
    if (requestId !== historyRequestId || store.state.serverChartRange !== range) {
      return;
    }
    store.patch({
      serverHistory: {
        range: result.range || range,
        bucket_seconds: result.bucket_seconds || (range === "1h" ? 60 : range === "24h" ? 300 : 1800),
        available_since: result.available_since || null,
        points: Array.isArray(result.points) ? result.points : [],
        points_count: result.points_count || (result.points ? result.points.length : 0),
        loading: false,
        error: "",
        lastSuccessAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (requestId !== historyRequestId || store.state.serverChartRange !== range) {
      return;
    }
    if (await handleUnauthorized(error)) return;
    store.patch({
      serverHistory: {
        ...store.state.serverHistory,
        loading: false,
        error: error instanceof Error ? error.message : "โหลดข้อมูลประวัติย้อนหลังไม่สำเร็จ",
      },
    });
  } finally {
    if (requestId === historyRequestId) {
      historyRequestInFlight = false;
    }
  }
}

async function pollHistory() {
  if (
    !session.authenticated ||
    store.state.active !== "overview" ||
    document.visibilityState !== "visible" ||
    store.state.serverChartRange === "live" ||
    historyRequestInFlight
  ) {
    return;
  }
  await fetchServerMetricsHistory(store.state.serverChartRange, true);
}

async function pollOverview() {
  if (
    !session.authenticated ||
    store.state.active !== "overview" ||
    document.visibilityState !== "visible" ||
    pollInFlight
  ) {
    return;
  }
  pollInFlight = true;
  try {
    const result = await api.loadResource("overview", {
      range: store.state.overviewRange,
    });
    if (store.state.active !== "overview") return;
    const nextHistory = appendLiveServerSample(
      store.state.liveServerHistory,
      result.data?.server,
    );
    store.patch({
      data: { ...store.state.data, overview: result.data },
      liveServerHistory: nextHistory,
      refreshing: false,
      error: "",
    });
  } catch (error) {
    if (await handleUnauthorized(error)) return;
    store.patch({
      refreshing: false,
      error: error instanceof Error ? error.message : "อัปเดตข้อมูล Real-time ไม่สำเร็จ",
    });
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollOverview, POLL_CADENCE_MS);
  historyPollTimer = setInterval(pollHistory, HISTORY_POLL_CADENCE_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (historyPollTimer) {
    clearInterval(historyPollTimer);
    historyPollTimer = null;
  }
}

async function load(section = store.state.active) {
  const requestId = ++loadRequestId;
  const staleData = store.state.data[section];
  const hasStaleData = staleData !== undefined;
  store.patch({ loading: !hasStaleData, refreshing: hasStaleData, error: "" });
  try {
    const result = await api.loadResource(section, {
      range: section === "overview" ? store.state.overviewRange : undefined,
    });
    if (requestId !== loadRequestId || section !== store.state.active) return;
    const nextHistory =
      section === "overview"
        ? appendLiveServerSample(store.state.liveServerHistory, result.data?.server)
        : store.state.liveServerHistory;
    store.patch({
      data: { ...store.state.data, [section]: result.data },
      liveServerHistory: nextHistory,
      loading: false,
      refreshing: false,
    });
    if (section === "overview") {
      startPolling();
    }
  } catch (error) {
    if (requestId !== loadRequestId || section !== store.state.active) return;
    if (await handleUnauthorized(error)) return;
    store.patch({
      loading: false,
      refreshing: false,
      ...(section === "overview" && staleData?.range
        ? { overviewRange: staleData.range }
        : {}),
      error: error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ",
    });
  }
}

async function action(name, id) {
  if (actionInFlight || store.state.actionBusyId) return;
  const row = (store.state.data[store.state.active] || []).find(
    (item) =>
      item.id === id
      || (name === "revoke_session" && item.active_session_id === id),
  );
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
    const configs = {
      suspended: {
        title: "ระงับบัญชีผู้ใช้",
        message: "บัญชีจะไม่สามารถใช้งานทุกการติดตั้งได้ และ Launcher session ปัจจุบันทั้งหมดจะถูกยกเลิกทันที",
        confirmText: "ระงับบัญชี",
        tone: "danger",
      },
      banned: {
        title: "แบนบัญชีผู้ใช้",
        message: "บัญชีจะถูกแบน ไม่สามารถใช้งานทุกการติดตั้งได้ และ Launcher session ปัจจุบันทั้งหมดจะถูกยกเลิก",
        confirmText: "แบนบัญชี",
        tone: "danger",
      },
      active: {
        title: "เปิดใช้งานบัญชี",
        message: "เปิดให้บัญชีนี้กลับมาใช้งานตามปกติอีกครั้ง",
        confirmText: "เปิดใช้งาน",
        tone: "success",
      },
    };
    const cfg = configs[nextStatus];
    const targetIdentity = row?.username || id;
    const confirmed = await showConfirmModal({
      title: cfg.title,
      message: cfg.message,
      target: targetIdentity,
      tone: cfg.tone,
      confirmText: cfg.confirmText,
    });
    if (!confirmed) return;
    await run({ action: "set_user_status", userId: id, status: nextStatus }, id);
    return;
  }
  if (name === "extend_license") {
    const targetLabel = [row?.username, row?.product].filter(Boolean).join(" · ") || id;
    const days = await showExtendLicenseModal({
      target: targetLabel,
      defaultDays: 30,
    });
    if (!days || !Number.isInteger(days) || days < 1) return;
    await run({ action: "extend_license", licenseId: id, days }, id);
    return;
  }
  const targetLabel = [
    row?.username,
    row?.display_name || row?.device,
    row?.product || row?.batch,
  ].filter(Boolean).join(" / ");
  const actionConfigs = {
    revoke_license: {
      title: "ยกเลิก License",
      message: "ต้องการยกเลิก License นี้หรือไม่ ผู้ใช้จะไม่สามารถเชื่อมต่อด้วยสิทธิ์นี้ได้อีก",
      confirmText: "ยกเลิก License",
      tone: "danger",
    },
    revoke_session: {
      title: "ยุติ Launcher Session",
      message: "ยุติ Launcher session ปัจจุบันนี้หรือไม่ อุปกรณ์จะยังคงถูกจดจำและสามารถเข้าสู่ระบบใหม่ได้",
      confirmText: "ยุติ Session",
      tone: "danger",
    },
    revoke_batch: {
      title: "ยกเลิกคูปองทั้งชุด",
      message: "ต้องการยกเลิกคูปองทั้งหมดในชุดนี้หรือไม่ คูปองที่ยังไม่ถูกใช้จะไม่สามารถนำไปเปิดสิทธิ์ได้อีก",
      confirmText: "ยกเลิกทั้งชุด",
      tone: "danger",
    },
    delete_batch: {
      title: "ลบชุดคูปองถาวร",
      message: "ลบชุดคูปองนี้ออกจากระบบถาวรหรือไม่ การดำเนินการนี้ย้อนกลับไม่ได้และรหัสคูปองที่เก็บไว้จะถูกลบ",
      confirmText: "ลบถาวร",
      tone: "danger",
    },
  };
  const cfg = actionConfigs[name] || {
    title: "ยืนยันคำสั่ง",
    message: "ต้องการดำเนินการคำสั่งนี้หรือไม่",
    confirmText: "ยืนยัน",
    tone: "danger",
  };
  const confirmed = await showConfirmModal({
    title: cfg.title,
    message: cfg.message,
    target: targetLabel,
    tone: cfg.tone,
    confirmText: cfg.confirmText,
  });
  if (!confirmed) return;
  const payload = {
    revoke_license: { action: name, licenseId: id },
    revoke_session: { action: name, sessionId: id },
    revoke_batch: { action: name, batchId: id },
    delete_batch: { action: name, batchId: id },
  }[name];
  if (payload) {
    const succeeded = await run(payload, id);
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

async function run(payload, busyId = null) {
  if (actionInFlight) return false;
  actionInFlight = true;
  if (busyId) store.patch({ actionBusyId: busyId });
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
    if (busyId) store.patch({ actionBusyId: null });
  }
}

async function copyArchivedCoupons(batchId) {
  const codes = getCouponCodes(batchId);
  if (!codes.length) {
    toast("ไม่มีรหัสคูปองของชุดนี้ในเบราว์เซอร์เครื่องนี้", "error");
    return;
  }
  const text = codes.join("\n");
  const ok = await copyTextToClipboard(text);
  if (ok) {
    toast(`คัดลอกรหัสคูปอง ${codes.length} รายการแล้ว`, "success");
  } else {
    showCouponModal({
      title: "รหัสคูปอง",
      codes,
      archived: true,
      quantity: codes.length,
    });
  }
}

async function submitCoupon(form) {
  if (actionInFlight) return;
  actionInFlight = true;
  const formData = new FormData(form);
  const durationDays = Number(formData.get("durationDays"));
  const quantity = Number(formData.get("quantity"));
  const productCode = String(formData.get("productCode") || "");
  try {
    const result = await api.runAction({
      action: "generate_coupons",
      productCode,
      durationDays,
      quantity,
      note: formData.get("note") || null,
    });
    store.patch({ couponFormOpen: false });
    const batchId = result.batch?.id;
    const archived = saveCouponCodes(batchId, result.codes);
    toast(`สร้างคูปอง ${result.codes?.length || 0} รายการแล้ว`, "success");
    if (result.codes?.length) {
      showCouponModal({
        title: "สร้างคูปองสำเร็จ",
        codes: result.codes,
        archived,
        durationDays,
        quantity: result.codes.length,
        productCode,
      });
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

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    session.authenticated &&
    store.state.active === "overview"
  ) {
    void pollOverview();
    if (store.state.serverChartRange !== "live") {
      void fetchServerMetricsHistory(store.state.serverChartRange, true);
    }
  }
});

root.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "login-form") {
    const form = event.target;
    const formData = new FormData(form);
    const username = String(formData.get("username") || "");
    const password = String(formData.get("password") || "");
    const submitButton = form.querySelector('button[type="submit"]');
    const errorBox = root.querySelector("#login-error");
    const inputs = form.querySelectorAll("input");
    const setBusy = (busy) => {
      for (const input of inputs) input.disabled = busy;
      if (submitButton) {
        submitButton.disabled = busy;
        submitButton.textContent = busy ? "กำลังเข้าสู่ระบบ…" : (submitButton.dataset.labelIdle || "เข้าสู่ระบบ");
      }
    };
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
    setBusy(true);
    try {
      await session.login(username, password);
      await load("overview");
    } catch (error) {
      loginError = error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ";
      if (errorBox) {
        errorBox.textContent = loginError;
        errorBox.hidden = false;
      } else {
        render();
      }
    } finally {
      if (!session.authenticated) {
        setBusy(false);
        root.querySelector("#admin-password")?.focus();
      }
    }
  } else if (event.target.id === "coupon-form") {
    await submitCoupon(event.target);
  } else if (event.target.id === "recovery-code-form") {
    await submitRecoveryCode(event.target);
  }
});

root.addEventListener("click", async (event) => {
  const passwordToggle = event.target.closest("[data-toggle-password]");
  if (passwordToggle) {
    const input = document.querySelector(passwordToggle.dataset.togglePassword);
    if (input) {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      passwordToggle.classList.toggle("is-visible", show);
      passwordToggle.setAttribute("aria-label", show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน");
      input.focus({ preventScroll: true });
      const caret = String(input.value).length;
      input.setSelectionRange(caret, caret);
    }
    return;
  }

  const copyTarget = event.target.closest("[data-copy]");
  if (copyTarget) {
    const textToCopy = copyTarget.dataset.copy;
    if (textToCopy) {
      const ok = await copyTextToClipboard(textToCopy);
      if (ok) {
        toast("คัดลอกรหัสแล้ว", "success");
      } else {
        showCopyModal({
          title: "คัดลอกรหัส",
          text: textToCopy,
        });
      }
      return;
    }
  }

  const target = event.target.closest("[data-section], [data-action]");
  if (!target) return;
  if (target.dataset.section) {
    closeRecoveryCodeDialog();
    store.patch({
      active: target.dataset.section,
      couponFormOpen: false,
      tablePages: { ...store.state.tablePages, [target.dataset.section]: 1 },
    });
    await load(target.dataset.section);
    return;
  }
  const name = target.dataset.action;
  if (name === "table_prev_page") {
    const activeSection = store.state.active;
    const current = store.state.tablePages?.[activeSection] || 1;
    if (current > 1) {
      store.patch({
        tablePages: {
          ...store.state.tablePages,
          [activeSection]: current - 1,
        },
      });
      const tableWrap = root.querySelector(".table-wrap");
      if (tableWrap) tableWrap.scrollTop = 0;
    }
    return;
  }
  if (name === "table_next_page") {
    const activeSection = store.state.active;
    const current = store.state.tablePages?.[activeSection] || 1;
    store.patch({
      tablePages: {
        ...store.state.tablePages,
        [activeSection]: current + 1,
      },
    });
    const tableWrap = root.querySelector(".table-wrap");
    if (tableWrap) tableWrap.scrollTop = 0;
    return;
  }
  if (name === "table_goto_page") {
    const activeSection = store.state.active;
    const targetPage = Number(target.dataset.page);
    if (Number.isInteger(targetPage) && targetPage >= 1) {
      store.patch({
        tablePages: {
          ...store.state.tablePages,
          [activeSection]: targetPage,
        },
      });
      const tableWrap = root.querySelector(".table-wrap");
      if (tableWrap) tableWrap.scrollTop = 0;
    }
    return;
  }
  if (name === "toggle_theme") {
    toggleTheme();
    return;
  }
  if (name === "refresh_overview") {
    await load("overview");
    if (store.state.serverChartRange !== "live") {
      void fetchServerMetricsHistory(store.state.serverChartRange, true);
    }
    return;
  }
  if (name === "set_server_chart_range") {
    const range = target.dataset.range;
    if (!["live", "1h", "24h", "7d"].includes(range)) return;
    store.patch({ serverChartRange: range });
    if (range !== "live") {
      void fetchServerMetricsHistory(range, false);
    }
    return;
  }
  if (name === "set_range") {
    const range = target.dataset.range;
    if (!["24h", "7d", "14d", "30d"].includes(range)) return;
    store.patch({ overviewRange: range });
    await load("overview");
    return;
  }
  if (name === "logout") {
    closeRecoveryCodeDialog();
    stopPolling();
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
    const ok = await copyTextToClipboard(code);
    if (ok) {
      toast("คัดลอก Recovery Code แล้ว", "success");
    } else {
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