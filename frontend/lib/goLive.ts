// Types and small display helpers for the private /ops/go-live board.
//
// The backend (backend/app/routers/ops.py + app/services/backlog.py) is
// the parser now: TODO.md and the compliance doc are read there and
// returned as ready-to-render `items` and `questions`, so this file no
// longer re-parses checkbox/state/note markdown on the client the way the
// old read-only page did. The one thing kept here is a presentational-only
// helper that pulls section heading text (e.g. "A. Finexer go-live
// blockers") out of the still-available raw TODO.md markdown, purely for
// grouping labels — no item state is derived from it.

export type GoLiveStatus = "ready" | "needs-kevin" | "blocked-deploy" | "submitted";
export type GoLiveOwner = "kevin" | "claude";
export type GoLiveItemState = "todo" | "in-progress" | "blocked" | "done";

export type GoLiveNote = { date: string; actor: string; text: string };

export type GoLiveItem = {
  id: string;
  section: string;
  title: string;
  text: string;
  owner: GoLiveOwner | null;
  state: GoLiveItemState;
  reason: string | null;
  done_at: string | null;
  commit: string | null;
  notes: GoLiveNote[];
};

export type GoLiveQuestion = {
  q: string;
  title: string;
  status: GoLiveStatus;
  chars: number;
  kevin_markers: string[];
  answer: string;
};

/** Strips `[KEVIN: ...]` markers out of an answer for the "Copy answer"
 *  button — those are notes to Kevin, not part of the submitted text. */
export function stripKevinMarkers(answer: string): string {
  return answer
    .replace(/\[KEVIN:[^\]]*\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function itemTotals(items: GoLiveItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.state === "done").length, total: items.length };
}

export type GoLiveSectionGroup = { section: string; heading: string; items: GoLiveItem[] };

/** Groups items by their section letter, in first-seen order, and labels
 *  each group with the `## A. <heading>` text pulled from the raw TODO.md
 *  markdown when available (falls back to "Section A"). */
export function groupItemsBySection(items: GoLiveItem[], todoMarkdown?: string): GoLiveSectionGroup[] {
  const headings = todoMarkdown ? parseSectionHeadings(todoMarkdown) : {};
  const order: string[] = [];
  const bySection = new Map<string, GoLiveItem[]>();
  for (const item of items) {
    if (!bySection.has(item.section)) {
      bySection.set(item.section, []);
      order.push(item.section);
    }
    bySection.get(item.section)!.push(item);
  }
  return order.map((section) => ({
    section,
    heading: headings[section] ?? `Section ${section}`,
    items: bySection.get(section) ?? [],
  }));
}

function parseSectionHeadings(markdown: string): Record<string, string> {
  const headings: Record<string, string> = {};
  const headingRe = /^## ([A-H])\. (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(markdown)) !== null) {
    headings[match[1]] = `${match[1]}. ${match[2].trim()}`;
  }
  return headings;
}
