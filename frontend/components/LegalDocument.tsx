import ReactMarkdown, { type Components } from "react-markdown";

// Server component, no "use client" needed: react-markdown's default
// export (`Markdown`, imported here as `ReactMarkdown`) runs synchronously
// with no hooks (see react-markdown/lib/index.js — only `MarkdownHooks`
// uses useState/useEffect, and that is a different export we don't use).

type TableSegment = { type: "table"; headers: string[]; rows: string[][] };
type MarkdownSegment = { type: "markdown"; content: string };
type Segment = MarkdownSegment | TableSegment;

// react-markdown here runs plain CommonMark only (no remark-gfm plugin —
// deliberately not added, see frontend/app/terms/page.tsx and
// frontend/app/privacy/page.tsx for why). CommonMark has no table syntax,
// so GFM pipe tables (used by privacy.md's sub-processor and retention
// tables) would otherwise render as literal "|"-separated paragraphs. This
// pulls contiguous GFM table blocks out of the markdown before it reaches
// ReactMarkdown and renders them as plain HTML tables instead; everything
// else still goes through ReactMarkdown as normal.
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparatorRow(line: string): boolean {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function parseTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Exported so other markdown-rendering surfaces with no GFM table support
// of their own (e.g. app/ops/go-live) can reuse the same table split/render
// instead of duplicating it — see the doc comment above.
export function splitMarkdownIntoSegments(markdown: string): Segment[] {
  const lines = markdown.split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];

  function flushBuffer() {
    if (buffer.length > 0) {
      segments.push({ type: "markdown", content: buffer.join("\n") });
      buffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (next !== undefined && isTableRow(line) && isTableSeparatorRow(next)) {
      flushBuffer();
      const headers = parseTableCells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(parseTableCells(lines[j]));
        j++;
      }
      segments.push({ type: "table", headers, rows });
      i = j - 1;
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();
  return segments;
}

export const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2 mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-10 mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
      {children}
    </h2>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-7 text-pretty text-slate-600 dark:text-slate-300 mb-4">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-800 dark:text-slate-100">{children}</strong>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-700 dark:hover:text-indigo-300"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 space-y-1.5 text-sm leading-7 text-pretty text-slate-600 dark:text-slate-300 mb-4">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 space-y-1.5 text-sm leading-7 text-pretty text-slate-600 dark:text-slate-300 mb-4">
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  hr: () => <hr className="border-slate-200 dark:border-slate-700 my-8" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-indigo-300 dark:border-indigo-600 pl-4 italic text-slate-500 dark:text-slate-400 mb-4">
      {children}
    </blockquote>
  ),
};

export function LegalTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                className="border-b border-slate-200 dark:border-slate-700 px-3 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalDocument({
  markdown,
  otherDocHref,
  otherDocLabel,
}: {
  markdown: string;
  otherDocHref: string;
  otherDocLabel: string;
}) {
  const segments = splitMarkdownIntoSegments(markdown);

  return (
    <main className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a] px-6 py-10">
      <div className="mx-auto max-w-[65ch]">
        <div className="mb-8">
          <span className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">Sorted</span>
        </div>

        <article>
          {segments.map((segment, index) =>
            segment.type === "table" ? (
              <LegalTable key={index} headers={segment.headers} rows={segment.rows} />
            ) : (
              <ReactMarkdown key={index} components={mdComponents}>
                {segment.content}
              </ReactMarkdown>
            )
          )}
        </article>

        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-slate-700">
          <a
            href={otherDocHref}
            className="text-sm font-medium text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-700 dark:hover:text-indigo-300"
          >
            {otherDocLabel}
          </a>
        </div>
      </div>
    </main>
  );
}
