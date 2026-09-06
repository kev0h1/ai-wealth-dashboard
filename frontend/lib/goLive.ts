// Types and small display helpers for the private /ops/go-live board.
//
// The backend (backend/app/routers/ops.py + app/services/backlog.py) is
// the parser now: TODO.md and the compliance doc are read there and
// returned as ready-to-render `items` and `questions`, so this file no
// longer re-parses checkbox/state/note markdown on the client the way the
// old read-only page did. Section-heading text is still pulled out of the
// raw TODO.md markdown here, purely for grouping labels — no item state is
// derived from it. This file also holds the filter/board model shared by
// the page and its sub-components under app/ops/go-live/.

export type GoLiveStatus = "ready" | "needs-kevin" | "blocked-deploy" | "submitted";
export type GoLiveOwner = "kevin" | "claude";
export type GoLiveItemState = "todo" | "in-progress" | "blocked" | "review" | "done";
export type GoLivePriority = "p1" | "p2" | "p3";

export type GoLiveNote = { date: string; actor: string; text: string };

export type GoLiveItem = {
  id: string;
  section: string;
  title: string;
  text: string;
  owner: GoLiveOwner | null;
  state: GoLiveItemState;
  reason: string | null;
  branch: string | null;
  done_at: string | null;
  commit: string | null;
  notes: GoLiveNote[];
  priority: GoLivePriority;
  unblocks: string[];
};

export type GoLiveQuestion = {
  q: string;
  title: string;
  status: GoLiveStatus;
  chars: number;
  kevin_markers: string[];
  answer: string;
  unblocked_by: string[];
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

export function parseSectionHeadings(markdown: string): Record<string, string> {
  const headings: Record<string, string> = {};
  const headingRe = /^## ([A-H])\. (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(markdown)) !== null) {
    headings[match[1]] = `${match[1]}. ${match[2].trim()}`;
  }
  return headings;
}

/** Groups items by owner, "Unassigned" last, alphabetical otherwise — the
 *  "Lanes: Owner" mode on the board. */
export type GoLiveOwnerGroup = { key: string; label: string; items: GoLiveItem[] };

export function groupItemsByOwner(items: GoLiveItem[]): GoLiveOwnerGroup[] {
  const map = new Map<string, GoLiveItem[]>();
  for (const item of items) {
    const key = item.owner ?? "unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  const label = (key: string) => (key === "kevin" ? "Kevin" : key === "claude" ? "Claude" : "Unassigned");
  const order = [...map.keys()].sort((a, b) => {
    if (a === "unassigned") return 1;
    if (b === "unassigned") return -1;
    return a.localeCompare(b);
  });
  return order.map((key) => ({ key, label: label(key), items: map.get(key)! }));
}

// ---------------------------------------------------------------------
// Priority display
// ---------------------------------------------------------------------

export const PRIORITY_LABEL: Record<GoLivePriority, string> = { p1: "P1", p2: "P2", p3: "P3" };
export const PRIORITY_ORDER: GoLivePriority[] = ["p1", "p2", "p3"];

/** P1 amber text on amber tint, P2 indigo tint, P3 slate — per DESIGN.md
 *  amber-for-attention, no colour outside that vocabulary. */
export const PRIORITY_PILL_CLASS: Record<GoLivePriority, string> = {
  p1: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  p2: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  p3: "bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400",
};

// ---------------------------------------------------------------------
// Board columns
// ---------------------------------------------------------------------

export const BOARD_COLUMNS: { key: GoLiveItemState; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in-progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];

// ---------------------------------------------------------------------
// Filters — owner, priority (multi-select), state (multi-select), search,
// view and lane mode, persisted together under one localStorage key.
// ---------------------------------------------------------------------

/** The state-chip vocabulary shown in the filter bar. "Open" collapses
 *  everything that isn't done and isn't in-progress/blocked/review into one
 *  chip (i.e. plain to-do items), matching the spec's "Open = not done". */
export type GoLiveFilterState = "open" | "in-progress" | "blocked" | "review" | "done";

export const FILTER_STATE_LABEL: Record<GoLiveFilterState, string> = {
  open: "Open",
  "in-progress": "In progress",
  blocked: "Blocked",
  review: "In review",
  done: "Done",
};
export const FILTER_STATE_ORDER: GoLiveFilterState[] = ["open", "in-progress", "blocked", "review", "done"];

export function itemFilterState(item: GoLiveItem): GoLiveFilterState {
  return item.state === "todo" ? "open" : item.state;
}

/** Questions don't carry an item-shaped state, so their four statuses map
 *  onto the same five-way bucket for filtering purposes: `submitted` is
 *  the finished state (Done), `blocked-deploy` is Blocked, and the two
 *  still-active statuses (`ready`, `needs-kevin`) are Open. */
export function questionFilterState(question: GoLiveQuestion): GoLiveFilterState {
  if (question.status === "submitted") return "done";
  if (question.status === "blocked-deploy") return "blocked";
  return "open";
}

export type GoLiveView = "list" | "board";
export type GoLiveLaneMode = "section" | "owner";

export type GoLiveFilters = {
  owner: "all" | GoLiveOwner;
  priorities: GoLivePriority[];
  states: GoLiveFilterState[];
  search: string;
  view: GoLiveView;
  lanes: GoLiveLaneMode;
};

export const DEFAULT_GO_LIVE_FILTERS: GoLiveFilters = {
  owner: "all",
  priorities: [],
  states: [],
  search: "",
  view: "list",
  lanes: "section",
};

export const GO_LIVE_FILTERS_STORAGE_KEY = "wd_go_live_filters";

/** Reads persisted filters from localStorage, tolerating a missing key,
 *  corrupt JSON, or a shape from an older version of this page. */
export function loadGoLiveFilters(): GoLiveFilters {
  if (typeof window === "undefined") return DEFAULT_GO_LIVE_FILTERS;
  try {
    const raw = window.localStorage.getItem(GO_LIVE_FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_GO_LIVE_FILTERS;
    const parsed = JSON.parse(raw) as Partial<GoLiveFilters>;
    return {
      owner: parsed.owner === "kevin" || parsed.owner === "claude" ? parsed.owner : "all",
      priorities: Array.isArray(parsed.priorities) ? parsed.priorities.filter((p): p is GoLivePriority => PRIORITY_ORDER.includes(p as GoLivePriority)) : [],
      states: Array.isArray(parsed.states) ? parsed.states.filter((s): s is GoLiveFilterState => FILTER_STATE_ORDER.includes(s as GoLiveFilterState)) : [],
      search: typeof parsed.search === "string" ? parsed.search : "",
      view: parsed.view === "board" ? "board" : "list",
      lanes: parsed.lanes === "owner" ? "owner" : "section",
    };
  } catch {
    return DEFAULT_GO_LIVE_FILTERS;
  }
}

export function saveGoLiveFilters(filters: GoLiveFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GO_LIVE_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Private browsing / storage full — filters just won't persist this session.
  }
}

// ---------------------------------------------------------------------
// Section collapse state — Questionnaire / Backlog / Reference headers on
// the page, persisted separately from the filters under a sibling key so
// clearing one doesn't clear the other.
// ---------------------------------------------------------------------

export type GoLiveUiState = {
  questionnaireOpen: boolean;
  backlogOpen: boolean;
  referenceOpen: boolean;
};

export const DEFAULT_GO_LIVE_UI: GoLiveUiState = {
  questionnaireOpen: true,
  backlogOpen: true,
  referenceOpen: false, // matches today's default: the Reference/"Pricing" details starts closed
};

export const GO_LIVE_UI_STORAGE_KEY = "wd_go_live_ui";

/** Reads persisted section-collapse state from localStorage, tolerating a
 *  missing key, corrupt JSON, or a shape from an older version of this
 *  page — same approach as `loadGoLiveFilters` above. */
export function loadGoLiveUi(): GoLiveUiState {
  if (typeof window === "undefined") return DEFAULT_GO_LIVE_UI;
  try {
    const raw = window.localStorage.getItem(GO_LIVE_UI_STORAGE_KEY);
    if (!raw) return DEFAULT_GO_LIVE_UI;
    const parsed = JSON.parse(raw) as Partial<GoLiveUiState>;
    return {
      questionnaireOpen: typeof parsed.questionnaireOpen === "boolean" ? parsed.questionnaireOpen : DEFAULT_GO_LIVE_UI.questionnaireOpen,
      backlogOpen: typeof parsed.backlogOpen === "boolean" ? parsed.backlogOpen : DEFAULT_GO_LIVE_UI.backlogOpen,
      referenceOpen: typeof parsed.referenceOpen === "boolean" ? parsed.referenceOpen : DEFAULT_GO_LIVE_UI.referenceOpen,
    };
  } catch {
    return DEFAULT_GO_LIVE_UI;
  }
}

export function saveGoLiveUi(ui: GoLiveUiState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GO_LIVE_UI_STORAGE_KEY, JSON.stringify(ui));
  } catch {
    // Private browsing / storage full — collapse state just won't persist this session.
  }
}

function matchesSearch(haystack: string, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

export function itemMatchesFilters(item: GoLiveItem, filters: GoLiveFilters): boolean {
  if (filters.owner !== "all" && item.owner !== filters.owner) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(item.priority)) return false;
  if (filters.states.length > 0 && !filters.states.includes(itemFilterState(item))) return false;
  return matchesSearch(`${item.id} ${item.title} ${item.text}`, filters.search);
}

export function filterItems(items: GoLiveItem[], filters: GoLiveFilters): GoLiveItem[] {
  return items.filter((item) => itemMatchesFilters(item, filters));
}

/** A question is shown when its own status falls in the selected state
 *  chips, or (once an owner is selected) when one of the items that
 *  unblocks it has that owner — so narrowing to "Claude" surfaces the
 *  questions his open work is gating even if the question itself is still
 *  "needs-kevin". */
export function questionMatchesFilters(question: GoLiveQuestion, items: GoLiveItem[], filters: GoLiveFilters): boolean {
  if (!matchesSearch(`${question.q} ${question.title} ${question.answer}`, filters.search)) return false;
  const statusMatches = filters.states.length === 0 || filters.states.includes(questionFilterState(question));
  if (filters.owner === "all") return statusMatches;
  const unblockingOwnerMatches = question.unblocked_by.some(
    (id) => items.find((item) => item.id === id)?.owner === filters.owner
  );
  return statusMatches || unblockingOwnerMatches;
}

export function filterQuestions(questions: GoLiveQuestion[], items: GoLiveItem[], filters: GoLiveFilters): GoLiveQuestion[] {
  return questions.filter((q) => questionMatchesFilters(q, items, filters));
}

// ---------------------------------------------------------------------
// Header hero figures
// ---------------------------------------------------------------------

export function headerFigures(items: GoLiveItem[]): { p1Open: number; blocked: number; inReview: number } {
  return {
    p1Open: items.filter((i) => i.priority === "p1" && i.state !== "done").length,
    blocked: items.filter((i) => i.state === "blocked").length,
    inReview: items.filter((i) => i.state === "review").length,
  };
}
