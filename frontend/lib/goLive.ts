// Parsing helpers for the private /ops/go-live page. The markdown files
// stay the source of truth (other sessions edit TODO.md and the compliance
// doc directly) — this only reads and shapes them for display, no editing.

export type GoLiveStatus = "ready" | "needs-kevin" | "blocked-deploy" | "unknown";

export type GoLiveQuestion = {
  id: string; // "Q1"
  title: string; // "Q1 Start date"
  shortTitle: string; // "Start date"
  status: GoLiveStatus;
  answer: string; // fenced ```text block content, trimmed
  kevinMarkers: string[];
};

/** Parses `docs/compliance/finexer-agent-controls-2026-09.md` into its 13
 *  `## Qn ...` sections. Each section carries a `Status: <status>` line and
 *  a fenced ```text answer block, per the format the compliance doc uses. */
export function parseComplianceMarkdown(markdown: string): GoLiveQuestion[] {
  const questions: GoLiveQuestion[] = [];
  const headingRe = /^## (Q\d+)\s+(.*)$/gm;
  const matches = [...markdown.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const id = match[1];
    const shortTitle = match[2].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    const body = markdown.slice(start, end);

    const statusMatch = body.match(/^Status:\s*(ready|needs-kevin|blocked-deploy)\s*$/m);
    const status: GoLiveStatus = (statusMatch?.[1] as GoLiveStatus) ?? "unknown";

    const fenceMatch = body.match(/```text\n([\s\S]*?)```/);
    const answer = fenceMatch ? fenceMatch[1].trim() : "";

    const kevinMarkers = [...answer.matchAll(/\[KEVIN:[^\]]*\]/g)].map((m) => m[0]);

    questions.push({ id, title: `${id} ${shortTitle}`, shortTitle, status, answer, kevinMarkers });
  }
  return questions;
}

/** Strips `[KEVIN: ...]` markers out of an answer for the "Copy answer"
 *  button — those are notes to Kevin, not part of the submitted text. */
export function stripKevinMarkers(answer: string): string {
  return answer
    .replace(/\[KEVIN:[^\]]*\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type GoLiveTodoItem = { text: string; done: boolean };
export type GoLiveTodoSection = { id: string; title: string; items: GoLiveTodoItem[] };

/** Parses TODO.md into its `## ` sections, each holding `- [ ]` / `- [x]`
 *  checklist items. Ignores the intro paragraphs before the first heading. */
export function parseTodoMarkdown(markdown: string): GoLiveTodoSection[] {
  const sections: GoLiveTodoSection[] = [];
  const headingRe = /^## (.*)$/gm;
  const matches = [...markdown.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const title = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    const body = markdown.slice(start, end);

    const items: GoLiveTodoItem[] = [];
    const itemRe = /^- \[( |x|X)\]\s+(.*)$/gm;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(body)) !== null) {
      items.push({ done: itemMatch[1].toLowerCase() === "x", text: itemMatch[2].trim() });
    }

    const idMatch = title.match(/^([A-Z])\./);
    sections.push({ id: idMatch ? idMatch[1] : title, title, items });
  }
  return sections;
}

export function todoTotals(sections: GoLiveTodoSection[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const section of sections) {
    for (const item of section.items) {
      total += 1;
      if (item.done) done += 1;
    }
  }
  return { done, total };
}
