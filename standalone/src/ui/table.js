import { escapeHtml, display, formatDate, statusIcon } from "./escape.js";

export function generatePaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
    pages.add(i);
  }
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 2);
    pages.add(totalPages - 1);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) {
      result.push("...");
    }
    result.push(p);
    prev = p;
  }
  return result;
}

export function table(headers, rows = [], empty = "ยังไม่มีข้อมูล", options = {}) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;

  const opts = typeof options === "number" ? { page: options } : (options || {});
  const paginate = opts.paginate !== false;
  const pageSize = Math.max(1, Number(opts.pageSize) || 10);
  const total = rows.length;
  const totalPages = Math.ceil(total / pageSize);
  const requestedPage = Math.max(1, Number(opts.page) || 1);
  const currentPage = Math.min(requestedPage, Math.max(1, totalPages));

  const start = paginate ? (currentPage - 1) * pageSize : 0;
  const end = paginate ? Math.min(start + pageSize, total) : total;
  const pagedRows = paginate ? rows.slice(start, end) : rows;

  let paginationHtml = "";
  if (paginate && total > 0) {
    if (totalPages > 1) {
      const pageItems = generatePaginationItems(currentPage, totalPages);
      const pagesHtml = pageItems
        .map((item) => {
          if (item === "...") {
            return `<span class="pagination-ellipsis" aria-hidden="true">…</span>`;
          }
          const isActive = item === currentPage;
          return `<button type="button" class="button button-small ${isActive ? "button-primary pagination-active" : "button-ghost"}" data-action="table_goto_page" data-page="${item}" aria-label="หน้า ${item}" ${isActive ? 'aria-current="page"' : ""}>${item}</button>`;
        })
        .join("");

      paginationHtml = `
        <nav class="table-pagination" aria-label="การแบ่งหน้าตาราง">
          <div class="table-pagination-info">
            แสดง <span class="pagination-range">${start + 1}–${end}</span> จากทั้งหมด <span class="pagination-total">${total}</span> รายการ
          </div>
          <div class="table-pagination-controls">
            <button
              type="button"
              class="button button-small button-ghost pagination-btn pagination-prev"
              data-action="table_prev_page"
              ${currentPage <= 1 ? "disabled" : ""}
              aria-label="หน้าก่อนหน้า"
            >
              ‹ ก่อนหน้า
            </button>
            <div class="table-pagination-pages">${pagesHtml}</div>
            <button
              type="button"
              class="button button-small button-ghost pagination-btn pagination-next"
              data-action="table_next_page"
              ${currentPage >= totalPages ? "disabled" : ""}
              aria-label="หน้าถัดไป"
            >
              ถัดไป ›
            </button>
          </div>
        </nav>
      `;
    } else {
      paginationHtml = `
        <div class="table-pagination">
          <div class="table-pagination-info">
            ทั้งหมด <span class="pagination-total">${total}</span> รายการ
          </div>
        </div>
      `;
    }
  }

  const cardClass = paginate ? "table-card has-pagination" : "table-card";
  return `
    <div class="${cardClass}">
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${pagedRows.join("")}</tbody>
        </table>
      </div>
      ${paginationHtml}
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
