// G251: Penny tables. Renders PennyTable from DATA (alignment, sticky first
// column, money formatting, no raw pipes) and the safe markdown fallback
// (whitelist, HTML stripped, external links neutralised, scripts never
// rendered), plus the hand-rolled GFM table parser (remark-gfm is not a
// dependency) and the wiring in PennyConversation.
// Run: npm run -s check:g251-penny-table
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: PennyTable } = await import("../components/PennyTable.tsx");
const { default: PennyReplyText, PENNY_MARKDOWN_ALLOWED } = await import("../components/PennyMarkdown.tsx");
const lib = await import("../lib/pennyTable.ts");
const h = React.createElement;
const NOW = new Date("2026-10-10T12:00:00Z");

const fixture = {
  title: "OpenRouter transactions",
  columns: [
    { key: "date", label: "Date", kind: "date", align: "left" },
    { key: "description", label: "Description", kind: "text", align: "left" },
    { key: "amount", label: "Amount", kind: "money", align: "right" },
    { key: "gbp", label: "In GBP", kind: "money", align: "right" },
    { key: "rate", label: "FX rate", kind: "rate", align: "right" },
    { key: "fee", label: "Fee", kind: "money", align: "right" },
  ],
  rows: [
    { date: "2026-10-04", description: "OpenRouter", amount: { amount: -20, currency: "USD" }, gbp: { amount: -15.1, currency: "GBP" }, rate: 1.3245, fee: { amount: -0.45, currency: "USD" } },
    { date: "2025-12-28", description: "OpenRouter top-up", amount: { amount: -1234.5, currency: "GBP" }, gbp: { amount: -1234.5, currency: "GBP" }, rate: null, fee: null },
  ],
  note: "Showing the 2 most recent of 14 matches.",
};
const html = (el) => renderToStaticMarkup(el);

// ---- 1. Table from data -----------------------------------------------------
{
  const out = html(h(PennyTable, { table: fixture, now: NOW }));
  assert.ok(out.includes("data-penny-table"));
  assert.ok(out.includes("<caption class=\"sr-only\">OpenRouter transactions</caption>"), "title is the accessible caption");
  assert.ok(out.includes("overflow-x-auto"), "scrolls sideways inside its own container");
  assert.equal((out.match(/<th /g) || []).length, 6 + 2, "6 column headers plus a row header per row");
  // first column sticky: its header and every body row header
  assert.equal((out.match(/sticky left-0/g) || []).length, 3, "header cell and both first cells are sticky");
  assert.ok(!/<td[^>]*sticky/.test(out), "only the row-naming column is sticky");
  assert.ok(/<th[^>]*sticky left-0[^>]*>Description<\/th>/.test(out), "Description is the held column when present");
  assert.ok(!/<th[^>]*sticky[^>]*>Date<\/th>/.test(out), "Date is not held");
  const noDesc = { ...fixture, columns: fixture.columns.filter((c) => c.key !== "description"), rows: fixture.rows.map(({ description, ...r }) => r) };
  assert.ok(/<th[^>]*sticky left-0[^>]*>Date<\/th>/.test(html(h(PennyTable, { table: noDesc, now: NOW }))), "falls back to the first column with no text column");
  // header per DESIGN.md Label: 10px, 600, tracked, uppercase, muted
  assert.ok(/<th[^>]*text-\[10px\][^>]*font-semibold[^>]*uppercase[^>]*tracking-\[0\.05em\]/.test(out));
  // numeric columns right-aligned in tabular figures; money is mono
  const amountCell = /<td[^>]*>(?:(?!<\/td>).)*−\$20\.00/.exec(out)?.[0] ?? "";
  assert.ok(amountCell.includes("text-right") && amountCell.includes("tabular-nums"), "money cell right-aligned in tabular figures");
  assert.ok(out.includes('<span class="money">−$20.00</span>'), "currency minus, the transaction's own currency, mono");
  assert.ok(out.includes('<span class="money">−£15.10</span>'));
  assert.ok(out.includes('<span class="money">−£1,234.50</span>'));
  assert.ok(out.includes('<span class="num">1.3245</span>'), "rate to four places, tabular");
  assert.ok(out.includes("4 Oct<") && out.includes("28 Dec 2025"), "short date, year only when not this year");
  assert.ok(!out.includes("|"), "no raw pipes");
  assert.ok(!/None|undefined|null|NaN/.test(out.replace(/data-penny-table/g, "")), "a missing value never prints a word");
  assert.ok(out.includes('aria-label="No value"'), "a missing value is a quiet dash with a label");
  assert.ok(out.includes("Showing the 2 most recent of 14 matches."));
  assert.ok(!out.includes("—"), "no em dash");
  // light and dark tokens, no new colours
  assert.ok(out.includes("bg-white dark:bg-slate-800") && out.includes("dark:text-slate-100"));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|violet|gradient/.test(out), "no new colours, no Penny gradient");
}

// ---- 2. A hostile or malformed block renders nothing ------------------------
{
  assert.equal(html(h(PennyTable, { table: { title: "x", columns: [], rows: [] } })), "");
  assert.equal(html(h(PennyTable, { table: null })), "");
  const evil = structuredClone(fixture);
  evil.rows[0].description = "<script>alert(1)</script><img src=x onerror=alert(2)>";
  const out = html(h(PennyTable, { table: evil, now: NOW }));
  assert.ok(!out.includes("<script") && !out.includes("<img"), "cell text is escaped, never markup");
  assert.ok(out.includes("&lt;script&gt;"));
  const wide = { ...fixture, columns: Array.from({ length: 13 }, (_, i) => ({ key: `c${i}`, label: "x", kind: "text", align: "left" })), rows: [] };
  assert.equal(lib.normalisePennyTable(wide), null, "13 columns refused");
  assert.equal(lib.normalisePennyTable({ ...fixture, rows: Array.from({ length: 51 }, () => ({})) }), null, "51 rows refused");
  const mistyped = structuredClone(fixture);
  mistyped.rows[0].amount = "20";
  mistyped.rows[0].rate = "1.3";
  const n = lib.normalisePennyTable(mistyped);
  assert.equal(n.rows[0].amount, null);
  assert.equal(n.rows[0].rate, null);
}

// ---- 3. 390px with five or more columns: wide content scrolls, nothing wraps the page
{
  const out = html(h(PennyTable, { table: fixture, now: NOW }));
  assert.ok(/<table[^>]*min-w-full/.test(out), "the table is at least as wide as its container and grows past it");
  assert.ok(/whitespace-nowrap/.test(out), "figure columns never wrap");
  assert.ok(!/ w-\[\d{3,}px\]|min-w-\[\d{3,}px\]/.test(out), "no fixed pixel width that could break the 390px frame");
}

// ---- 4. Markdown fallback -----------------------------------------------------
{
  const kevin = [
    "Here are your OpenRouter payments.",
    "| Date | GBP | USD | FX Rate | Fee |",
    "|------|-----|-----|---------|-----|",
    "| 4 Oct | £15.10 | $20.00 | 1.3245 | $0.45 |",
    "| 28 Sep | £7.48 | $10.00 | 1.3369 | None shown |",
  ].join("\n");
  const out = html(h(PennyReplyText, { text: kevin }));
  assert.ok(out.includes("data-penny-table") && out.includes("<table"), "the typed table becomes a real table");
  assert.ok(!out.includes("|"), "no raw pipes survive");
  assert.ok(out.includes("Here are your OpenRouter payments."), "the sentence above stays above");
  assert.ok(out.indexOf("Here are your") < out.indexOf("<table"));
  assert.ok(out.includes('<span class="money">£15.10</span>'), "amounts in cells keep MoneyText conventions");
  assert.equal((out.match(/<th /g) || []).length, 5 + 2);
  // numeric columns right-aligned
  assert.ok(/<th[^>]*text-right[^>]*>GBP<\/th>/.test(out) || /<th[^>]*>GBP<\/th>/.test(out));
  assert.ok(/<td[^>]*text-right[^>]*>(?:(?!<\/td>).)*1\.3245/.test(out));

  // whitelist: only the allowed elements, nothing executable
  assert.deepEqual([...PENNY_MARKDOWN_ALLOWED].sort(), ["a", "br", "code", "em", "li", "ol", "p", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul"]);
  const hostile = [
    "# Big heading",
    "<script>alert('x')</script>",
    "<img src=x onerror=alert(1)>",
    "<iframe src=\"https://evil.test\"></iframe>",
    "**bold** and *em* and `code` and [out](https://evil.test/a) and [js](javascript:alert(1)) and [ok](/spend?view=period) and [proto](//evil.test)",
    "![pixel](https://evil.test/p.png)",
    "- one",
    "- two",
  ].join("\n\n");
  const h2 = html(h(PennyReplyText, { text: hostile }));
  assert.ok(!/<script|<iframe|<img|onerror|<h1|javascript:/i.test(h2), `unsafe markup rendered: ${h2}`);
  assert.ok(!h2.includes("evil.test"), "external links and images are gone, text only");
  assert.ok(h2.includes(">out<") && h2.includes(">js<"), "a refused link keeps its words as plain text");
  assert.ok(h2.includes('href="/spend?view=period"'), "an in-app route stays a link");
  assert.ok(h2.includes("<strong") && h2.includes("<em") && h2.includes("<code") && h2.includes("<li"));
  assert.ok(!/<a [^>]*target=/.test(h2), "no new tabs");

  // plain prose stays on the old path, byte for byte what MoneyText gives
  const { default: MoneyText } = await import("../components/MoneyText.tsx");
  const plain = "You have £61 left until Friday.";
  assert.equal(html(h(PennyReplyText, { text: plain })), html(h(MoneyText, { text: plain })));
}

// ---- 5. Parser edges ------------------------------------------------------------
{
  const segs = lib.splitReplySegments("Intro\n\n| A | B |\n|:--|--:|\n| x | 1 |\n| y | 22 |\n\nAfter");
  assert.deepEqual(segs.map((s) => s.type), ["md", "table", "md"]);
  const t = segs[1].table;
  assert.deepEqual(t.columns.map((c) => c.align), ["left", "right"], "delimiter alignment is honoured");
  assert.equal(t.rows.length, 2);
  // a pipe in prose is not a table
  assert.deepEqual(lib.splitReplySegments("a | b without a delimiter row").map((s) => s.type), ["md"]);
  // caps
  const wideRow = (n, ch) => "|" + Array.from({ length: n }, () => ch).join("|") + "|";
  const big = [wideRow(14, " h "), wideRow(14, "---"), ...Array.from({ length: 60 }, () => wideRow(14, " 1 "))].join("\n");
  const bt = lib.splitReplySegments(big).find((s) => s.type === "table").table;
  assert.equal(bt.columns.length, 12);
  assert.equal(bt.rows.length, 50);
  // numeric-looking column right-aligns without an explicit marker
  const auto = lib.splitReplySegments("| M | Spent |\n|---|---|\n| Oct | £12.00 |\n| Sep | −£3.00 |").find((s) => s.type === "table").table;
  assert.deepEqual(auto.columns.map((c) => c.align), ["left", "right"]);
}

// ---- 6. Link rule -----------------------------------------------------------------
{
  for (const ok of ["/spend", "/spend?view=period", "/penny#top"]) assert.ok(lib.isSafeAppHref(ok), ok);
  for (const bad of ["https://x.test", "//x.test", "/\\x.test", "javascript:alert(1)", "mailto:a@b.c", "", null, undefined, "spend", "/a b", "/<x>"]) assert.ok(!lib.isSafeAppHref(bad), String(bad));
}

// ---- 7. Wiring ----------------------------------------------------------------------
{
  const conv = readFileSync(new URL("../components/PennyConversation.tsx", import.meta.url), "utf8");
  assert.ok(conv.includes("normalisePennyTable(res.table)"), "the answer's table reaches the bubble");
  assert.ok(conv.includes("normalisePennyTable(t.table)"), "a stored table is restored");
  assert.ok(conv.includes("<PennyTable table={msg.table} />"));
  assert.ok(conv.includes("<PennyReplyText text={msg.reply} />"));
  const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");
  assert.ok(api.includes("table?: import(\"./pennyTable\").PennyTableBlock | null"));
  const md = readFileSync(new URL("../components/PennyMarkdown.tsx", import.meta.url), "utf8");
  assert.ok(md.includes("skipHtml") && md.includes("unwrapDisallowed") && !md.includes("rehype-raw") && !md.includes("dangerouslySetInnerHTML"));
}

console.log("g251-penny-table: all checks passed");
