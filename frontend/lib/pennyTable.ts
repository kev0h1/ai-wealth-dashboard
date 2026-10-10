// G251: typed table blocks in Penny's replies, and the small GFM table parser
// used when the model types a pipe table anyway. Pure functions, no React.
//
// The block is built and validated on the server (backend/app/services/
// penny_table.py): max 12 columns, 50 rows, typed cells, no HTML. The client
// still treats it as untrusted: a malformed block renders nothing, and every
// value is drawn as React text, never as markup.
import { currencySymbol } from "./currency";

export type PennyTableKind = "text" | "money" | "date" | "number" | "rate";
export type PennyTableAlign = "left" | "right";
export type PennyTableColumn = { key: string; label: string; kind: PennyTableKind; align: PennyTableAlign };
export type PennyTableMoney = { amount: number; currency: string };
export type PennyTableCell = string | number | PennyTableMoney | null | undefined;
export type PennyTableBlock = {
  title: string;
  columns: PennyTableColumn[];
  rows: Array<Record<string, PennyTableCell>>;
  note?: string;
};

export const TABLE_MAX_COLUMNS = 12;
export const TABLE_MAX_ROWS = 50;
const KINDS = new Set(["text", "money", "date", "number", "rate"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isMoney(v: unknown): v is PennyTableMoney {
  return !!v && typeof v === "object" && typeof (v as PennyTableMoney).amount === "number"
    && Number.isFinite((v as PennyTableMoney).amount) && typeof (v as PennyTableMoney).currency === "string";
}

/** Defensive shape check on a block from the wire or from storage. Returns a
 * clean copy or null. Cells that do not fit their column's kind become null. */
export function normalisePennyTable(raw: unknown): PennyTableBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string" || !Array.isArray(r.columns) || !Array.isArray(r.rows)) return null;
  if (r.columns.length < 1 || r.columns.length > TABLE_MAX_COLUMNS || r.rows.length > TABLE_MAX_ROWS) return null;
  const columns: PennyTableColumn[] = [];
  for (const c of r.columns) {
    if (!c || typeof c !== "object") return null;
    const col = c as Record<string, unknown>;
    if (typeof col.key !== "string" || typeof col.label !== "string" || typeof col.kind !== "string" || !KINDS.has(col.kind)) return null;
    const kind = col.kind as PennyTableKind;
    const align: PennyTableAlign = col.align === "left" || col.align === "right"
      ? col.align : (kind === "text" || kind === "date" ? "left" : "right");
    columns.push({ key: col.key, label: col.label, kind, align });
  }
  const rows = (r.rows as unknown[]).map((row) => {
    const src = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const out: Record<string, PennyTableCell> = {};
    for (const col of columns) {
      const v = src[col.key];
      if (v == null) out[col.key] = null;
      else if (col.kind === "money") out[col.key] = isMoney(v) ? { amount: v.amount, currency: v.currency } : null;
      else if (col.kind === "number" || col.kind === "rate") out[col.key] = typeof v === "number" && Number.isFinite(v) ? v : null;
      else out[col.key] = typeof v === "string" ? v : null;
    }
    return out;
  });
  const block: PennyTableBlock = { title: r.title, columns, rows };
  if (typeof r.note === "string" && r.note.trim()) block.note = r.note;
  return block;
}

/** "−£20.00", "$1,234.50", "£5.00". The currency minus (U+2212) is kept. */
export function formatTableMoney(m: PennyTableMoney): string {
  const abs = Math.abs(m.amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const body = `${currencySymbol(m.currency)}${abs}`;
  return m.amount < 0 ? `−${body}` : body;
}

/** The app's short day, "4 Oct", with the year only when it is not this year. */
export function formatTableDate(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  const day = Number(m[3]);
  return Number(m[1]) === now.getFullYear() ? `${day} ${month}` : `${day} ${month} ${m[1]}`;
}

/** Plain text for a cell, or null when there is no value. */
export function formatTableCell(col: PennyTableColumn, cell: PennyTableCell, now?: Date): string | null {
  if (cell == null || cell === "") return null;
  switch (col.kind) {
    case "money": return isMoney(cell) ? formatTableMoney(cell) : null;
    case "date": return typeof cell === "string" ? formatTableDate(cell, now) : null;
    case "number": return typeof cell === "number" ? cell.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : null;
    case "rate": return typeof cell === "number"
      ? cell.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : null;
    default: return typeof cell === "string" ? cell : null;
  }
}

// ── Markdown fallback: GFM pipe tables typed by the model ──────────────────

export type ReplySegment = { type: "md"; text: string } | { type: "table"; table: PennyTableBlock };

const DELIM_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isDelimiterRow(line: string, width: number): boolean {
  if (!line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length === width && cells.every((c) => DELIM_CELL.test(c));
}

/** Strips inline emphasis markers so a cell reads as plain text. */
function plainCell(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/`([^`]*)`/g, "$1").replace(/\*(.+?)\*/g, "$1");
}

const NUMERICISH = /^[~−+-]?[£$€]?[\d,]+(\.\d+)?[%kKmM]?$/;

/** Splits a reply into prose and GFM tables. A table is a header row, a
 * delimiter row of the same width, then body rows until a line without a
 * pipe. Columns beyond 12 and rows beyond 50 are dropped. Everything stays
 * text: the cells are drawn as React text by PennyTable. */
export function splitReplySegments(text: string): ReplySegment[] {
  const lines = text.split(/\r?\n/);
  const out: ReplySegment[] = [];
  let prose: string[] = [];
  const flush = () => {
    const joined = prose.join("\n").trim();
    if (joined) out.push({ type: "md", text: joined });
    prose = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.includes("|") && next !== undefined) {
      const header = splitRow(line);
      if (header.length >= 2 && isDelimiterRow(next, header.length)) {
        const delims = splitRow(next);
        const body: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
          body.push(splitRow(lines[j]));
          j++;
        }
        flush();
        const width = Math.min(header.length, TABLE_MAX_COLUMNS);
        const rows = body.slice(0, TABLE_MAX_ROWS).map((cells) => {
          const row: Record<string, PennyTableCell> = {};
          for (let c = 0; c < width; c++) row[`c${c}`] = plainCell(cells[c] ?? "") || null;
          return row;
        });
        const columns: PennyTableColumn[] = header.slice(0, width).map((label, c) => {
          const cellsOfCol = rows.map((r) => r[`c${c}`]).filter((v): v is string => typeof v === "string");
          const numeric = cellsOfCol.length > 0 && cellsOfCol.every((v) => NUMERICISH.test(v));
          const marker = delims[c] ?? "";
          const align: PennyTableAlign = marker.endsWith(":") || (numeric && !marker.startsWith(":")) ? "right" : "left";
          return { key: `c${c}`, label: plainCell(label) || " ", kind: "text", align };
        });
        out.push({ type: "table", table: { title: "", columns, rows } });
        i = j;
        continue;
      }
    }
    prose.push(line);
    i++;
  }
  flush();
  return out;
}

/** True when a reply carries block markdown worth the richer renderer. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(\||[-*] |\d+[.)] )/.test(text) || /\*\*[^*]+\*\*/.test(text) || /`[^`]+`/.test(text);
}

/** A link is allowed only when it is an in-app route: one leading slash. */
export function isSafeAppHref(href: string | undefined | null): boolean {
  if (!href) return false;
  return /^\/(?![/\\])[^\s\\<>"']*$/.test(href);
}
