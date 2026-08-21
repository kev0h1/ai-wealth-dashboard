"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import SettleMark from "@/components/SettleMark";
import { api, CycleStory } from "@/lib/api";
import MoneyText from "@/components/MoneyText";
import { usePreferences } from "@/components/PreferencesContext";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";

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

function TitleSlide({ slide, fmt }: { slide: Extract<Slide, { kind: "title" }>; fmt: (n: number) => string }) {
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
      <h1 className="text-3xl font-bold tracking-tight text-slate-100">Your month, closed.</h1>
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
}: {
  slide: Extract<Slide, { kind: "spending" }>;
  fmt: (n: number) => string;
}) {
  const s = slide.story.chapters!.spending!;
  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>YOUR SPENDING</Whisper>
      <p className="text-5xl font-bold money text-slate-100">{fmt(s.total_spend)}</p>
      <p className="text-[15px] leading-relaxed text-slate-300 mt-3">
        You spent <span className="font-mono tabular-nums">{fmt(s.total_spend)}</span> this cycle.
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
}: {
  slide: Extract<Slide, { kind: "whereItWent" }>;
  fmt: (n: number) => string;
}) {
  const { colours } = useColours();
  const s = slide.story.chapters!.spending!;
  const cliff = slide.story.chapters?.cliff;
  const top5 = s.top_categories.slice(0, 5);
  const week1Pct = cliff?.week1_pct ?? 0;

  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>WHERE IT WENT</Whisper>
      <div className="space-y-4">
        {top5.map((d) => {
          const colour = getCategoryColour(d.category, colours);
          return (
            <div key={d.category} className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${colour}26` }}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colour }}
                />
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

function CardsSlide({
  slide,
  fmt,
}: {
  slide: Extract<Slide, { kind: "cards" }>;
  fmt: (n: number) => string;
}) {
  const c = slide.story.chapters!.cards!;
  const switchDay = slide.story.chapters?.switch?.switch_day;

  const deltaPositive = c.delta > 0;
  const deltaZero = c.delta === 0;

  return (
    <div className="flex flex-col justify-center min-h-0">
      <Whisper>YOUR CARDS</Whisper>
      <p className="text-2xl font-bold text-slate-100">
        <span className="font-mono tabular-nums">{fmt(c.new_spend)}</span> of it rode on your cards.
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
          Your cards took over from cash on {fmtDate(switchDay)}.
        </p>
      )}
    </div>
  );
}

function WinSlide({
  slide,
  fmt,
  hideNetWorth,
}: {
  slide: Extract<Slide, { kind: "win" }>;
  fmt: (n: number) => string;
  hideNetWorth: boolean;
}) {
  const ch = slide.story.chapters!;

  // Pick first true fact
  if (ch.close?.streak_weeks != null && ch.close.streak_weeks >= 4) {
    return (
      <div className="flex flex-col justify-center min-h-0">
        <p className="text-2xl font-bold text-slate-100">
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
        <p className="text-2xl font-bold text-slate-100">
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
        <p className="text-2xl font-bold text-slate-100">
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
}: {
  slide: Extract<Slide, { kind: "close" }>;
  fmt: (n: number) => string;
  hideNetWorth: boolean;
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
        <h2 className="text-2xl font-bold text-slate-100">
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
export default function StoryPlayer() {
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
  }, [which, preview, persona]);

  const slides = story ? buildSlides(story, preview, persona) : [];
  const total = slides.length;

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

  const currentSlide = slides[index];

  return (
    <main
      className="fixed inset-0 z-50 h-dvh w-full overflow-hidden bg-[#0f172a] text-slate-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-[4vh] h-[560px] w-[135vw] max-w-[780px]"
        style={{
          background: [
            "radial-gradient(ellipse 50% 44% at 50% 42%, rgba(99,102,241,0.32), rgba(99,102,241,0.16) 45%, transparent 72%)",
            "radial-gradient(ellipse 52% 54% at 50% 58%, rgba(139,92,246,0.13), rgba(139,92,246,0.065) 45%, transparent 70%)",
          ].join(", "),
        }}
      />

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

      {/* Slide content */}
      <div className="relative z-20 pointer-events-none h-full flex items-center">
        <div className="max-w-md mx-auto w-full px-6" key={index}>
          <div className="story-slide-in">
            {currentSlide.kind === "title" && (
              <TitleSlide slide={currentSlide} fmt={fmt} />
            )}
            {currentSlide.kind === "spending" && (
              <SpendingSlide slide={currentSlide} fmt={fmt} />
            )}
            {currentSlide.kind === "whereItWent" && (
              <WhereItWentSlide slide={currentSlide} fmt={fmt} />
            )}
            {currentSlide.kind === "cards" && (
              <CardsSlide slide={currentSlide} fmt={fmt} />
            )}
            {currentSlide.kind === "win" && (
              <WinSlide slide={currentSlide} fmt={fmt} hideNetWorth={hideNetWorth} />
            )}
            {currentSlide.kind === "close" && (
              <CloseSlide
                slide={currentSlide}
                fmt={fmt}
                hideNetWorth={hideNetWorth}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
