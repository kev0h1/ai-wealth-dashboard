import Constants from "expo-constants";
import { getToken } from "@/lib/storage";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CycleStoryPeriod {
  start: string;
  end: string;
  closed: boolean;
  days_elapsed: number;
  days_to_payday: number;
}

interface CycleStoryChapters {
  opening: { income_in: number; count: number };
  cliff: { week1_spend: number; period_spend: number; week1_pct: number; commitments: unknown[] } | null;
  switch?: { week1_card_pct: number; rest_card_pct: number; switch_day: string | null };
  spending?: { total_spend: number; income_in: number; top_categories: { category: string; total: number }[] };
  cards?: { present: boolean; material: boolean; new_spend: number; payments: number; delta: number; share_of_spend: number };
  moves: Record<"ritual_saving" | "deliberate_saving" | "card_feeding" | "buffer_draws" | "other_shuffles", { count: number; total: number }>;
  keeping: { set_aside: number; drawn_back: number; external: number; kept: number };
  close: { month_end_cash: number; card_delta: number; streak_weeks: number | null } | null;
  self_facts: { traits: unknown[]; fired: Record<string, boolean> };
}

interface CycleStoryNarrative {
  opening: string;
  month: string;
  moves: string;
  keeping: string;
  close: string;
  self: string;
  source: string;
}

interface CycleStoryTomorrow {
  push_title: string;
  push_body: string;
  brief_headline: string;
  brief_body: string;
}

export interface CycleStoryFull {
  status: "ok" | "no_data";
  early_days?: boolean;
  period?: CycleStoryPeriod;
  chapters?: CycleStoryChapters;
  narrative?: CycleStoryNarrative;
  cards_link?: boolean;
  tomorrow?: CycleStoryTomorrow;
  is_preview?: boolean;
  persona?: string;
  is_demo?: boolean;
}

export type Slide =
  | { kind: "title"; story: CycleStoryFull; preview: boolean; persona: string | null }
  | { kind: "spending"; story: CycleStoryFull }
  | { kind: "whereItWent"; story: CycleStoryFull }
  | { kind: "cards"; story: CycleStoryFull }
  | { kind: "win"; story: CycleStoryFull }
  | { kind: "close"; story: CycleStoryFull; preview: boolean; persona: string | null };

export function buildSlides(
  story: CycleStoryFull,
  preview: boolean,
  persona: string | null
): Slide[] {
  const slides: Slide[] = [];
  const ch = story.chapters;
  slides.push({ kind: "title", story, preview, persona });
  if (ch?.spending && ch.spending.total_spend > 0)
    slides.push({ kind: "spending", story });
  if (ch?.spending?.top_categories?.length)
    slides.push({ kind: "whereItWent", story });
  if (ch?.cards?.material) slides.push({ kind: "cards", story });
  const hasWin =
    (ch?.close?.streak_weeks != null && ch.close.streak_weeks >= 4) ||
    (ch?.keeping?.kept != null && ch.keeping.kept > 0) ||
    (ch?.moves?.deliberate_saving?.count != null &&
      ch.moves.deliberate_saving.count > 0);
  if (hasWin) slides.push({ kind: "win", story });
  if (ch?.close || story.narrative?.self)
    slides.push({ kind: "close", story, preview, persona });
  return slides;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

const BASE_URL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

export async function getCycleStoryFull(
  which: "current" | "last",
  previewClose?: boolean,
  persona?: string
): Promise<CycleStoryFull> {
  const token = await getToken();
  const qs =
    `?which=${which}` +
    (previewClose ? "&preview_close=1" : "") +
    (persona ? `&persona=${encodeURIComponent(persona)}` : "");
  const res = await fetch(`${BASE_URL}/cycle/story${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CycleStoryFull>;
}
