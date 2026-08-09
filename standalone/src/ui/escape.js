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
