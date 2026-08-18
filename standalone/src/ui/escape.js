export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function display(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

export function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

export function formatTrendBucket(value, range = "14d") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  return new Intl.DateTimeFormat("th-TH", range === "24h"
    ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }
    : { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(date);
}

export function formatHistoryBucket(value, range = "1h") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return display(value);
  if (range === "1h" || range === "24h") {
    return new Intl.DateTimeFormat("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    }).format(date);
  }
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

export function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
  return `${(num / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatBps(bps) {
  const num = Number(bps);
  if (!Number.isFinite(num) || num <= 0) return "0 bps";
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)} Gbps`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)} Mbps`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)} Kbps`;
  return `${num.toFixed(0)} bps`;
}

export function formatUptime(seconds) {
  const num = Number(seconds);
  if (!Number.isFinite(num) || num <= 0) return "—";
  const days = Math.floor(num / 86400);
  const hours = Math.floor((num % 86400) / 3600);
  const minutes = Math.floor((num % 3600) / 60);
  const secs = Math.floor(num % 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatRelativeAge(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const num = Number(seconds);
  if (!Number.isFinite(num) || num < 0) return "—";
  if (num === 0) return "เมื่อสักครู่";
  if (num < 60) return `${num}s ที่แล้ว`;
  const mins = Math.floor(num / 60);
  const secs = num % 60;
  return `${mins}m ${secs}s ที่แล้ว`;
}

export function statusIcon(value) {
  const status = String(value || "unknown").toLowerCase();
  if (["online", "available", "active", "listening", "success"].includes(status)) return "●";
  if (["degraded", "expiring", "suspended", "scheduled"].includes(status)) return "▲";
  if (["stale"].includes(status)) return "◷";
  if (["offline", "revoked", "rejected", "banned", "expired", "closed", "failed", "timeout"].includes(status)) return "■";
  return "○";
}
