import { escapeHtml, display, formatDate, statusIcon } from "./escape.js";

export function table(headers, rows, empty = "ยังไม่มีข้อมูล") {
  if (!rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

export const cell = (value, className = "") =>
  `<td class="${escapeHtml(className)}">${escapeHtml(display(value))}</td>`;

export const dateCell = (value) => cell(formatDate(value), "date-cell");

export const statusBadge = (value, labelOverride = "") => {
  const status = String(value || "unknown").toLowerCase();
  const icon = statusIcon(status);
  const label = labelOverride || status;
  return `<span class="status status-${escapeHtml(status)}"><span class="status-glyph" aria-hidden="true">${icon}</span> ${escapeHtml(label)}</span>`;
};
