"use client";

import { useEffect, useState, useRef, useCallback, useLayoutEffect, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import SettleMark from "@/components/SettleMark";
import { api, CycleStory } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { useCategoryIcons } from "@/components/IconProvider";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCountUp } from "@/lib/useCountUp";
import { bankKey, BANK_META, BankBadge } from "@/components/AccountMiniCard";

// A ref callback a slide hands its focal DOM node to, so the player can
// measure it and steer the spotlight glow toward it. See the
// story-spotlight-* classes in globals.css.
type FocalRef = (el: HTMLElement | null) => void;

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function fmtGBP(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

// ── Whisper label ──────────────────────────────────────────────────────────────
function Whisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-3">
      {children}
    </p>
  );
}

// ── A hero money figure with the Safe-to-Spend count-up brought to the
// story: counts 0 → target every time the slide mounts (slides are keyed
// by index, so a slide change is a fresh mount and the count restarts).
// Reduced motion is handled inside useCountUp itself. Owner feedback
// (2026-08-28): the number-motion trick reads gimmicky repeated on every
// slide, so it is scoped to the SpendingSlide's hero figure only — nowhere
// else in this file counts up any more, they render plain formatted
// numbers instead.
function HeroFigure({
  value,
  fmt,
  focalRef,
  className = "",
}: {
  value: number;
  fmt: (n: number) => string;
  focalRef?: FocalRef;
  className?: string;
}) {
  const counted = useCountUp(value, { startFromZero: true });
  return (
    <p ref={focalRef} className={`story-hero-figure money ${className}`}>
      {fmt(counted)}
    </p>
  );
}

// ── Slide types ────────────────────────────────────────────────────────────────
type Slide =
  | { kind: "title"; story: CycleStory; preview: boolean; persona: string | null }
  | { kind: "spending"; story: CycleStory }
  | { kind: "whereItWent"; story: CycleStory }
  | { kind: "cards"; story: CycleStory }
  | { kind: "win"; story: CycleStory }
  | { kind: "close"; story: CycleStory; preview: boolean; persona: string | null };

// ── Build slide list (skip absent data) ───────────────────────────────────────
function buildSlides(story: CycleStory, preview: boolean, persona: string | null): Slide[] {
  const slides: Slide[] = [];
  const ch = story.chapters;

  // 1. Title — always
  slides.push({ kind: "title", story, preview, persona });

  // 2. Spending — when spending exists and total_spend > 0
  if (ch?.spending && ch.spending.total_spend > 0) {
    slides.push({ kind: "spending", story });
  }

  // 3. Where it went — when top_categories has entries
  if (ch?.spending?.top_categories && ch.spending.top_categories.length > 0) {
    slides.push({ kind: "whereItWent", story });
  }

  // 4. Cards — only when cards.material
  if (ch?.cards?.material) {
    slides.push({ kind: "cards", story });
  }

  // 5. Win — only if there's a true fact
  const hasWin =
    (ch?.close?.streak_weeks != null && ch.close.streak_weeks >= 4) ||
    (ch?.keeping?.kept != null && ch.keeping.kept > 0) ||
    (ch?.moves?.deliberate_saving?.count != null && ch.moves.deliberate_saving.count > 0);
  if (hasWin) {
    slides.push({ kind: "win", story });
  }

  // 6. Close + self — needs chapters.close OR narrative.self
  if (ch?.close || story.narrative?.self) {
    slides.push({ kind: "close", story, preview, persona });
  }

  return slides;
}

// ── Individual slide renderers ────────────────────────────────────────────────

function TitleSlide({
  slide,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "title" }>;
  focalRef: FocalRef;
}) {
  const { story, preview, persona } = slide;
  const period = story.period;
  return (
    <div className="flex flex-col justify-center min-h-0">
      {persona ? (
        <div className="inline-flex items-center self-start gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-xs font-semibold text-violet-300 mb-4">
          DEMO · {persona}
        </div>
      ) : preview && (
        <div className="inline-flex items-center self-start gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-300 mb-4">
          PREVIEW · your month closes tonight
        </div>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">YOUR MONTH</p>
      <h1 ref={focalRef} className="text-3xl font-bold tracking-tight text-slate-100">Your month, closed.</h1>
      {period && (
        <p className="text-sm text-slate-400 mt-2">
          {fmtDate(period.start)} – {fmtDate(period.end)}
        </p>
      )}
    </div>
  );
}

function SpendingSlide({
  slide,
  fmt,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "spending" }>;
  fmt: (n: number) => string;
  focalRef: FocalRef;
}) {
  const s = slide.story.chapters!.spending!;
  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>YOUR SPENDING</Whisper>
      <HeroFigure value={s.total_spend} fmt={fmt} focalRef={focalRef} className="text-5xl font-bold text-slate-100" />
      <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
        That&apos;s what left your accounts this cycle.
      </p>
      {s.income_in > 0 && (
        <p className="text-sm text-slate-400 mt-2"><span className="font-mono tabular-nums">{fmt(s.income_in)}</span> came in.</p>
      )}
    </div>
  );
}

function WhereItWentSlide({
  slide,
  fmt,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "whereItWent" }>;
  fmt: (n: number) => string;
  focalRef: FocalRef;
}) {
  const { colours } = useColours();
  const { icons } = useCategoryIcons();
  const s = slide.story.chapters!.spending!;
  const cliff = slide.story.chapters?.cliff;
  const top5 = s.top_categories.slice(0, 5);
  const week1Pct = cliff?.week1_pct ?? 0;

  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>WHERE IT WENT</Whisper>
      <div className="space-y-4">
        {top5.map((d, i) => {
          const colour = getCategoryColour(d.category, colours);
          const Icon = getCategoryIcon(d.category, icons);
          // The list is already ranked biggest-first, so the top row is
          // always the slide's focal element — the spotlight settles on it.
          const isFocal = i === 0;
          return (
            <div
              key={d.category}
              ref={isFocal ? focalRef : undefined}
              className="flex items-center gap-3 story-row-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${colour}26` }}
              >
                <Icon size={16} style={{ color: colour }} />
              </div>
              <p className="flex-1 text-sm font-medium text-slate-200">{d.category}</p>
              <p className="text-sm font-semibold money text-slate-100">{fmt(d.total)}</p>
            </div>
          );
        })}
      </div>
      {week1Pct >= 40 && (
        <p className="text-sm text-slate-400 mt-6">
          {week1Pct >= 60
            ? "Most of it went in the first week."
            : "Nearly half of it went in the first week."}
        </p>
      )}
    </div>
  );
}

// Resolve a cards-breakdown row (account_id/name/provider only, not a full
// Account) to a brand chip via the SAME curated map AccountMiniCard uses
// everywhere else (bankKey + BANK_META, both exported from there) — this
// never duplicates the brand data, only the tiny "which logo/domain" pick
// that AccountMiniCard's own accountBrand() does for a full Account. Used
// only to pick the logo for the cards slide's dispersed badge cluster now
// (owner feedback 2026-08-28: the name/amount rows read as "the description
// on numbers", not the icon cluster they expected — rows are gone, only
// the badges remain).
function cardLogoBrand(row: { name: string; provider: string }): {
  logoSrc: string | null;
  initials: string;
  label: string;
  brandBg?: string;
} {
  const key = bankKey({ provider: row.provider });
  const meta = BANK_META[key];
  if (meta) {
    const logoSrc = meta.logoFile
      ? `/banks/${meta.logoFile}`
      : meta.domain
      ? `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`
      : null;
    return { logoSrc, initials: meta.initials, label: meta.label, brandBg: meta.bg };
  }
  // Unknown provider — no curated entry. Leave brandBg undefined so
  // BankBadge falls back to its own neutral Slate Voice fill (the same
  // "no broken image" treatment the map's own OFFLINE entry gets), just
  // with initials drawn from whatever name we do have.
  const fallback = (row.provider || row.name || "?").trim();
  return { logoSrc: null, initials: fallback.slice(0, 2).toUpperCase() || "?", label: fallback || "Card" };
}

// Deterministic dispersal slots for the cards slide's logo cluster — one
// entry per rank (index 0 = the card with the most new_spend, dormant £0
// cards sort last per compute_cycle_story so they land in the smallest,
// furthest-out slots automatically). No Math.random anywhere: SSR and
// repeat views land byte-identical.
//
// Owner feedback (2026-08-28) on the first shipped version: "it should be
// all the cards a user has and it shouldn't be too symmetrical its
// explosive and random above and below" — a neat arc of 3 logos sitting
// only above the headline read as a tidy row, not a burst. This version
// scatters logos on BOTH sides of the text block instead of trying to
// orbit one shared centre point:
//   `zone`  — "above" places the badge in a strip that sits directly above
//     the Whisper/headline block; "below" places it in a strip directly
//     after the delta/switch-day lines. Each strip is its own flex sibling
//     of the text block (see CardsSlide below), so a slot's `edge` offset
//     is always measured FROM the text block's own top or bottom edge —
//     never from a fixed viewport coordinate — so the badge clears the
//     text by a guaranteed minimum gap no matter whether the headline
//     wraps to 2 or 3 lines.
//   `edge`  — px gap between the text block's near edge and the badge's
//     near edge (i.e. the badge sits ENTIRELY beyond this offset, it can
//     never encroach closer to the text than `edge` px).
//   `left`  — the badge's horizontal centre, as a % across the strip.
//   `rotateDeg` — the badge's RESTING tilt (part of its final, static
//     appearance, not just an animation flourish) — this is what makes the
//     cluster read as thrown rather than placed.
//   `overshoot` — extra px of travel (signed: negative drifts further
//     up/away for an "above" badge, positive further down/away for a
//     "below" badge) baked into the pop keyframe's mid-point before the
//     badge settles at its static resting spot; see .story-logo-pop.
// Deliberately irregular: no two `edge` values repeat (so no two logos
// ever land at the same height), the gaps between sorted edges within a
// zone are unequal, and no `left` value mirrors another around the 50%
// axis — so even the common 2-3 card case reads as scattered rather than
// a shrunk copy of a tidy layout. Sizes still fall with rank, largest
// first, so the badge that matters most is also the most prominent one.
// Supports up to 8 (compute_cycle_story now returns every card the user
// has, not just the active ones) — CardsSlide slices to the 8 largest.
const CARD_LOGO_SLOTS: Array<{
  zone: "above" | "below";
  edge: number;
  left: number;
  size: number;
  rotateDeg: number;
  overshoot: number;
}> = [
  { zone: "above", edge: 18, left: 62, size: 46, rotateDeg: -7, overshoot: -8 },
  { zone: "below", edge: 14, left: 26, size: 34, rotateDeg: 9, overshoot: 9 },
  { zone: "above", edge: 96, left: 18, size: 34, rotateDeg: 6, overshoot: -10 },
  { zone: "below", edge: 90, left: 71, size: 30, rotateDeg: -11, overshoot: 9 },
  { zone: "above", edge: 48, left: 87, size: 30, rotateDeg: 12, overshoot: -7 },
  { zone: "below", edge: 46, left: 47, size: 27, rotateDeg: -8, overshoot: 8 },
  { zone: "above", edge: 128, left: 51, size: 25, rotateDeg: 5, overshoot: -9 },
  { zone: "below", edge: 118, left: 9, size: 24, rotateDeg: -10, overshoot: 10 },
];

function CardsSlide({
  slide,
  fmt,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "cards" }>;
  fmt: (n: number) => string;
  focalRef: FocalRef;
}) {
  const c = slide.story.chapters!.cards!;
  const switchDay = slide.story.chapters?.switch?.switch_day;
  const breakdown = c.breakdown ?? [];
  // All the user's cards (compute_cycle_story now includes dormant ones,
  // sorted new_spend descending), capped to the 8 largest — the most this
  // slot table is hand-tuned for.
  const topCards = [...breakdown].sort((a, b) => b.new_spend - a.new_spend).slice(0, 8);

  const deltaPositive = c.delta > 0;
  const deltaZero = c.delta === 0;

  // Pair each card with its slot by rank, then split into the two strips.
  // A strip's reserved height is only as tall as the furthest badge it
  // actually has to hold this render (a 2-card story doesn't pay for the
  // full 8-slot spread) — `edge + size` is the badge's far edge measured
  // from the text block, so the strip always fully contains every badge
  // assigned to it.
  const slotted = topCards.map((row, i) => ({ row, slot: CARD_LOGO_SLOTS[i], i }));
  const aboveSlotted = slotted.filter((s) => s.slot.zone === "above");
  const belowSlotted = slotted.filter((s) => s.slot.zone === "below");
  const aboveHeight = aboveSlotted.length
    ? Math.max(...aboveSlotted.map((s) => s.slot.edge + s.slot.size)) + 10
    : 0;
  const belowHeight = belowSlotted.length
    ? Math.max(...belowSlotted.map((s) => s.slot.edge + s.slot.size)) + 10
    : 0;

  function renderBadge({ row, slot, i }: (typeof slotted)[number]) {
    const brand = cardLogoBrand(row);
    return (
      <div
        key={row.account_id}
        className="story-logo-pop"
        style={{
          position: "absolute",
          left: `${slot.left}%`,
          top: slot.zone === "below" ? `${slot.edge}px` : undefined,
          bottom: slot.zone === "above" ? `${slot.edge}px` : undefined,
          "--logo-rot": `${slot.rotateDeg}deg`,
          "--logo-overshoot-y": `${slot.overshoot}px`,
          animationDelay: `${i * 90}ms`,
        } as CSSProperties}
      >
        <BankBadge logoSrc={brand.logoSrc} initials={brand.initials} altText={brand.label} brandBg={brand.brandBg} size={slot.size} />
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-center min-h-0">
      {aboveHeight > 0 && (
        <div className="relative" style={{ height: aboveHeight }} aria-hidden="true">
          {aboveSlotted.map(renderBadge)}
        </div>
      )}
      <div>
        <Whisper>YOUR CREDIT CARDS</Whisper>
        <p ref={focalRef} className="text-2xl font-bold text-slate-100 story-hero-figure">
          <span className="font-mono tabular-nums">{fmt(c.new_spend)}</span> of it rode on your credit cards.
        </p>
        {deltaZero ? (
          <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
            Balances held steady.
          </p>
        ) : deltaPositive ? (
          <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
            Balances closed <span className="font-mono tabular-nums">{fmt(Math.abs(c.delta))}</span> higher.
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed text-emerald-400 mt-3">
            Balances closed <span className="font-mono tabular-nums">{fmt(Math.abs(c.delta))}</span> lower.
          </p>
        )}
        {switchDay && (
          <p className="text-sm text-slate-400 mt-2">
            Your credit cards took over from cash on {fmtDate(switchDay)}.
          </p>
        )}
      </div>
      {belowHeight > 0 && (
        <div className="relative" style={{ height: belowHeight }} aria-hidden="true">
          {belowSlotted.map(renderBadge)}
        </div>
      )}
    </div>
  );
}

function WinSlide({
  slide,
  fmt,
  hideNetWorth,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "win" }>;
  fmt: (n: number) => string;
  hideNetWorth: boolean;
  focalRef: FocalRef;
}) {
  const ch = slide.story.chapters!;

  // Pick first true fact
  if (ch.close?.streak_weeks != null && ch.close.streak_weeks >= 4) {
    return (
      <div className="flex flex-col justify-center min-h-0">
        <p ref={focalRef} className="text-2xl font-bold text-slate-100">
          <SettleMark size={20} className="inline-block align-[-3px] text-amber-300" /> {ch.close.streak_weeks} weeks of saving, unbroken.
        </p>
        <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
          Still going. That habit is yours.
        </p>
      </div>
    );
  }

  if (ch.keeping?.kept > 0) {
    return (
      <div className="flex flex-col justify-center min-h-0">
        <p ref={focalRef} className="text-2xl font-bold text-slate-100">
          <SettleMark size={20} className="inline-block align-[-3px] text-amber-300" /> You kept <span className="font-mono tabular-nums">{fmt(ch.keeping.kept)}</span> of what you set aside.
        </p>
        <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
          Set aside <span className="font-mono tabular-nums">{fmt(ch.keeping.set_aside)}</span>, drew back <span className="font-mono tabular-nums">{fmt(ch.keeping.drawn_back)}</span>. The rest stayed put.
        </p>
      </div>
    );
  }

  if (ch.moves?.deliberate_saving?.count > 0) {
    return (
      <div className="flex flex-col justify-center min-h-0">
        <p ref={focalRef} className="text-2xl font-bold text-slate-100">
          <SettleMark size={20} className="inline-block align-[-3px] text-amber-300" /> {ch.moves.deliberate_saving.count} deliberate transfers to savings.
        </p>
        <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
          You moved <span className="font-mono tabular-nums">{fmt(ch.moves.deliberate_saving.total)}</span> on purpose.
        </p>
      </div>
    );
  }

  return null;
}

function CloseSlide({
  slide,
  fmt,
  hideNetWorth,
  focalRef,
}: {
  slide: Extract<Slide, { kind: "close" }>;
  fmt: (n: number) => string;
  hideNetWorth: boolean;
  focalRef: FocalRef;
}) {
  const router = useRouter();
  const { story, preview, persona } = slide;
  const close = story.chapters?.close;
  const selfText = story.narrative?.self;

  const fullStoryHref = persona
    ? `/month?persona=${encodeURIComponent(persona)}`
    : preview
    ? "/month?preview=1"
    : "/month?which=last";

  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>THE CLOSE</Whisper>
      {close && (
        <h2 ref={focalRef} className="text-2xl font-bold text-slate-100 story-hero-figure">
          You reached payday with <span className="font-mono tabular-nums">{fmt(close.month_end_cash)}</span> in your current accounts.
        </h2>
      )}
      {selfText && (
        <p className="text-[15px] leading-relaxed text-slate-300 mt-4">
          <MoneyText text={hideNetWorth ? maskAmounts(selfText) : selfText} />
        </p>
      )}
      <button
        className="mt-8 bg-white/10 border border-white/15 rounded-xl px-5 py-3 text-sm font-semibold text-white active:scale-95 transition-transform pointer-events-auto self-start"
        onClick={() => router.push(fullStoryHref)}
      >
        Read the full story ›
      </button>
    </div>
  );
}

// ── Main StoryPlayer ──────────────────────────────────────────────────────────
// `fixtureStory`: bypasses the network fetch entirely and plays this story
// directly — used only by the /design/month-story preview route so design
// review doesn't need an authenticated session.
//
// `spotlight`/`align`: a design-review seam only (owner undecided on the
// glow, /design/month-story?variant=a|b|c), NOT a real feature toggle.
// Both default to today's production behaviour, so the real /month/story
// route (which passes neither) renders byte-for-byte unchanged. When the
// owner picks a winner, flip these defaults and delete the props rather
// than leaving the branch live.
//   spotlight: "anchored" (today) | "none" (no glow) | "tight" (small glow
//     hugging the focal element instead of washing the screen)
//   align: "default" (today's layout) | "center" (slide content forced to
//     the true centre of the viewport, for the no-glow/tight-glow variants)
export default function StoryPlayer({
  fixtureStory,
  spotlight = "anchored",
  align = "default",
}: {
  fixtureStory?: CycleStory;
  spotlight?: "anchored" | "none" | "tight";
  align?: "default" | "center";
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hideNetWorth } = usePreferences();

  const persona = searchParams.get("persona");
  const preview = !persona && searchParams.get("preview") === "1";
  const whichParam = searchParams.get("which");
  const which: "current" | "last" = persona || preview
    ? "current"
    : whichParam === "current"
    ? "current"
    : "last";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [story, setStory] = useState<CycleStory | null>(null);
  const [index, setIndex] = useState(0);

  // Touch swipe tracking
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const fmt = useCallback(
    (n: number) => (hideNetWorth ? "£••••" : fmtGBP(n)),
    [hideNetWorth]
  );

  useEffect(() => {
    if (fixtureStory) {
      setStory(fixtureStory);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    api.getCycleStory(which, preview && !persona, persona ?? undefined).then((storyData) => {
      if (cancelled) return;
      if (!storyData || storyData.status !== "ok") {
        setError(true);
      } else if (storyData.early_days && which === "current") {
        // Nothing to play for an early-days cycle — redirect to the month page
        router.replace("/month");
        return;
      } else {
        setStory(storyData);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setError(true);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [which, preview, persona, fixtureStory]);

  const slides = story ? buildSlides(story, preview, persona) : [];
  const total = slides.length;
  const currentSlide = slides[index];

  // ── Spotlight glow — measures the current slide's focal element (set via
  // each slide's `focalRef`) and steers the glow toward it. See the
  // .story-spotlight-* classes in globals.css for the two-layer split.
  const glowContainerRef = useRef<HTMLDivElement | null>(null);
  const focalElRef = useRef<HTMLElement | null>(null);
  const setFocalEl = useCallback<FocalRef>((el) => {
    focalElRef.current = el;
  }, []);
  const [spot, setSpot] = useState<{ dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      const container = glowContainerRef.current;
      const focal = focalElRef.current;
      if (!container || !focal) {
        setSpot(null);
        return;
      }
      const cRect = container.getBoundingClientRect();
      const fRect = focal.getBoundingClientRect();
      const focalX = fRect.left + fRect.width / 2 - cRect.left;
      const focalY = fRect.top + fRect.height / 2 - cRect.top;
      const baseX = cRect.width * 0.5;
      const baseY = cRect.height * 0.32;
      setSpot({ dx: focalX - baseX, dy: focalY - baseY });
    });
    return () => cancelAnimationFrame(raf);
  }, [index, currentSlide?.kind]);

  const advance = useCallback(() => {
    setIndex((i) => (i < total - 1 ? i + 1 : i));
  }, [total]);

  const rewind = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) advance();
      else rewind();
    }
  }, [advance, rewind]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="fixed inset-0 z-50 h-dvh w-full overflow-hidden bg-[#0f172a] text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-400 animate-pulse">Reading your month…</p>
      </main>
    );
  }

  // ── Error / no data ──────────────────────────────────────────────────────────
  if (error || !story || slides.length === 0) {
    return (
      <main className="fixed inset-0 z-50 h-dvh w-full overflow-hidden bg-[#0f172a] text-slate-100 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-300 text-lg">Nothing to tell yet</p>
        <button
          onClick={() => router.push("/month")}
          className="p-2 text-slate-400 active:scale-95 transition-transform"
          aria-label="Back"
        >
          <X size={20} />
        </button>
      </main>
    );
  }

  return (
    <main
      className="fixed inset-0 z-50 h-dvh w-full overflow-hidden bg-[#0f172a] text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Spotlight glow — anchored to the current slide's focal element.
          Suppressed entirely for spotlight="none" (design-review variant
          B); a real /month/story visit never passes that prop, so this
          renders exactly as before by default. */}
      {spotlight !== "none" && (
        <div ref={glowContainerRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className={spotlight === "tight" ? "story-spotlight-anchor story-spotlight-anchor--tight" : "story-spotlight-anchor"}
            style={{
              "--spot-dx": `${spot?.dx ?? 0}px`,
              "--spot-dy": `${spot?.dy ?? 0}px`,
            } as CSSProperties}
          >
            <div key={index} className="story-spotlight-core" />
          </div>
        </div>
      )}

      {/* Top bar: progress segments + close button */}
      <div
        className="absolute top-0 left-0 right-0 z-30 pointer-events-auto"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        {/* Progress bars */}
        <div className="flex gap-1.5 px-4 mb-3">
          {slides.map((_, i) => (
            <div
              key={i}
              className="h-[3px] flex-1 rounded-full"
              style={{ backgroundColor: i <= index ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.25)" }}
            />
          ))}
        </div>
        {/* Close button */}
        <div className="flex justify-end px-2">
          <button
            onClick={() => router.push(
              persona
                ? `/month?persona=${encodeURIComponent(persona)}`
                : preview
                ? "/month?preview=1"
                : "/month"
            )}
            className="p-2 text-slate-400 active:scale-95 transition-transform"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Tap zones */}
      <button
        className="absolute left-0 top-0 bottom-0 w-1/2 z-10"
        aria-label="Previous"
        onClick={rewind}
        tabIndex={-1}
      />
      <button
        className="absolute right-0 top-0 bottom-0 w-1/2 z-10"
        aria-label="Next"
        onClick={advance}
        tabIndex={-1}
      />

      {/* Slide content — align="default" keeps today's exact markup (the
          real /month/story route). align="center" (design-review variants
          B/C only) forces true viewport-centre positioning via fixed
          inset-0, sidestepping the low-anchored composition the owner
          flagged rather than relying on the same flex chain default uses. */}
      <div
        className={
          align === "center"
            ? "fixed inset-0 z-20 flex items-center justify-center px-6 pointer-events-none"
            : "relative z-20 pointer-events-none h-full flex items-center"
        }
      >
        <div className={align === "center" ? "max-w-md w-full" : "max-w-md mx-auto w-full px-6"} key={index}>
          <div className="story-slide-in">
            {currentSlide.kind === "title" && (
              <TitleSlide slide={currentSlide} focalRef={setFocalEl} />
            )}
            {currentSlide.kind === "spending" && (
              <SpendingSlide slide={currentSlide} fmt={fmt} focalRef={setFocalEl} />
            )}
            {currentSlide.kind === "whereItWent" && (
              <WhereItWentSlide slide={currentSlide} fmt={fmt} focalRef={setFocalEl} />
            )}
            {currentSlide.kind === "cards" && (
              <CardsSlide slide={currentSlide} fmt={fmt} focalRef={setFocalEl} />
            )}
            {currentSlide.kind === "win" && (
              <WinSlide slide={currentSlide} fmt={fmt} hideNetWorth={hideNetWorth} focalRef={setFocalEl} />
            )}
            {currentSlide.kind === "close" && (
              <CloseSlide
                slide={currentSlide}
                fmt={fmt}
                hideNetWorth={hideNetWorth}
                focalRef={setFocalEl}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
