"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Bell, Play } from "lucide-react";
import {
  api,
  CycleStory,
  CycleStoryChapters,
} from "@/lib/api";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import { usePreferences } from "@/components/PreferencesContext";
import SegmentedControl from "@/components/SegmentedControl";
import BottomNav from "@/components/BottomNav";
import { goBack } from "@/lib/goBack";

// ── Whisper label ─────────────────────────────────────────────────────────────
function Whisper({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-2xl glass-card p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-6 w-40 bg-slate-100 dark:bg-slate-700/60 rounded-lg" />
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
    </div>
  );
}

// ── Format a date string "YYYY-MM-DD" → "1 Jul" ───────────────────────────────
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Format a whole-£ number ────────────────────────────────────────────────────
function fmtGBP(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

// ── Mask £amounts in narrative text ───────────────────────────────────────────
function maskAmounts(text: string): string {
  return text.replace(/£[\d,]+(\.\d+)?/g, "£••••");
}

// ── Moves display order and labels ────────────────────────────────────────────
const MOVE_META: { key: keyof CycleStoryChapters["moves"]; label: string }[] = [
  { key: "ritual_saving", label: "Ritual saving" },
  { key: "deliberate_saving", label: "Deliberate saving" },
  { key: "card_feeding", label: "Fed to credit cards" },
  { key: "buffer_draws", label: "Buffer draws" },
  { key: "other_shuffles", label: "Other shuffles" },
];

export default function MonthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hideNetWorth } = usePreferences();

  const [cache, setCache] = useState<{ current?: CycleStory; last?: CycleStory }>({});
  const [which, setWhich] = useState<"current" | "last">("current");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track whether the initial load has run
  const didInit = useRef(false);

  // ── Money formatter with mask support ─────────────────────────────────────
  const fmt = (n: number) => (hideNetWorth ? "£••••" : fmtGBP(n));

  const persona = searchParams.get("persona");
  const isPreview = !persona && searchParams.get("preview") === "1" && which === "current";

  // ── Fetch a given cycle and cache it ──────────────────────────────────────
  const fetchAndCache = async (w: "current" | "last") => {
    setLoading(true);
    setError(null);
    try {
      const usePreview = !persona && searchParams.get("preview") === "1" && w === "current";
      const data = await api.getCycleStory(w, usePreview, persona ?? undefined);
      setCache((prev) => ({ ...prev, [w]: data }));
      return data;
    } catch {
      setError("Failed to load");
      return null;
    } finally {
      setLoading(false);
    }
  };

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // Persona mode: always fetch current with the persona param
    if (persona) {
      setWhich("current");
      fetchAndCache("current");
      return;
    }

    const paramWhich = searchParams.get("which") as "current" | "last" | null;

    if (paramWhich === "current" || paramWhich === "last") {
      setWhich(paramWhich);
      fetchAndCache(paramWhich);
    } else {
      // Smart default: fire both "last" and "current" in parallel, then land
      // on whichever the outcome calls for. Avoids the worst case of a serial
      // last -> current wait (last, then a cold-LLM current on top).
      (async () => {
        const currentP = api.getCycleStory("current", !persona && searchParams.get("preview") === "1", persona ?? undefined)
          .then(d => { setCache((prev) => ({ ...prev, current: d })); return d; })
          .catch(() => null);
        const lastData = await fetchAndCache("last");
        if (lastData && lastData.status === "ok") {
          setWhich("last");
        } else {
          setWhich("current");
          setLoading(true);
          setError(null);
          const d = await currentP;
          if (d) {
            setLoading(false);
            setError(null);
          } else {
            await fetchAndCache("current");
          }
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle change (skip initial mount) ────────────────────────────────────
  const isFirstToggle = useRef(true);
  useEffect(() => {
    if (isFirstToggle.current) {
      isFirstToggle.current = false;
      return;
    }
    if (!cache[which]) {
      fetchAndCache(which);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [which]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
        <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto space-y-4">
          <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <BottomNav />
      </div>
    );
  }

  const story = cache[which];

  // ── Error / no_data state ─────────────────────────────────────────────────
  const isEmpty = error || !story || story.status !== "ok";

  // ── Back button (shared) ──────────────────────────────────────────────────
  const backButton = (
    <button
      onClick={() => goBack(router)}
      className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 active:scale-[0.98] transition-[transform,opacity] mb-5"
    >
      <ChevronLeft size={15} />
      Back
    </button>
  );

  if (isEmpty) {
    return (
      <main className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
        <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto space-y-8">
          <div className="rise-in" style={{ animationDelay: "0ms" }}>
            {backButton}
            <Whisper>YOUR MONTH</Whisper>
            <SegmentedControl
              options={[
                { value: "current", label: "This cycle" },
                { value: "last", label: "Last cycle" },
              ]}
              value={which}
              onChange={(v) => setWhich(v as "current" | "last")}
              className="mt-3 max-w-[240px]"
              ariaLabel="Choose cycle"
            />
          </div>
          <div className="glass-card rounded-2xl p-6 text-center">
            <p className="text-slate-500 dark:text-slate-400 text-sm">Nothing to tell yet</p>
            <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
              Come back once a few days of the cycle have passed.
            </p>
          </div>
        </div>
        <BottomNav />
      </main>
    );
  }

  const { period, chapters, narrative } = story as Required<CycleStory>;

  const activeMoves = MOVE_META.filter(
    (m) => ((chapters.moves as CycleStoryChapters["moves"] | undefined)?.[m.key]?.count ?? 0) > 0
  );

  // ── Card delta movement logic ──────────────────────────────────────────────
  const closeDelta = chapters.close?.card_delta ?? 0;
  const cardMovement =
    Math.abs(closeDelta) < 20
      ? "Held steady"
      : closeDelta <= -20
      ? `↓ ${fmt(Math.abs(closeDelta))}`
      : `↑ ${fmt(Math.abs(closeDelta))}`;
  const cardDeltaClass =
    closeDelta <= -20 && Math.abs(closeDelta) >= 20
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-slate-900 dark:text-slate-100";

  return (
    <main className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto space-y-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "0ms" }}>
          {backButton}
          {persona ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 text-xs font-semibold text-violet-700 dark:text-violet-300 mb-3">
              DEMO · {persona}
            </div>
          ) : isPreview && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs font-semibold text-amber-700 dark:text-amber-300 mb-3">
              PREVIEW · your month closes tonight
            </div>
          )}
          {isPreview && (
            <div className="mt-1 mb-2">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Demo:{" "}
                <a href="/month/story?persona=comfortable" className="hover:opacity-70 active:opacity-50 transition-opacity">comfortable</a>
                {" · "}
                <a href="/month/story?persona=breakeven" className="hover:opacity-70 active:opacity-50 transition-opacity">breakeven</a>
                {" · "}
                <a href="/month/story?persona=partial" className="hover:opacity-70 active:opacity-50 transition-opacity">partial</a>
              </span>
            </div>
          )}
          <Whisper>YOUR MONTH</Whisper>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
            {fmtDate(period.start)} – {fmtDate(period.end)}
          </p>
          {!persona && (
            <SegmentedControl
              options={[
                { value: "current", label: "This cycle" },
                { value: "last", label: "Last cycle" },
              ]}
              value={which}
              onChange={(v) => setWhich(v as "current" | "last")}
              className="mt-3 max-w-[240px]"
              ariaLabel="Choose cycle"
            />
          )}
          {story?.status === "ok" && (persona || isPreview || (which === "last" && story.period?.closed)) && (
            <button
              className="mt-4 inline-flex items-center gap-2 glass-card rounded-full px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 active:scale-95 transition-transform"
              onClick={() => router.push(
                persona
                  ? `/month/story?persona=${encodeURIComponent(persona)}`
                  : isPreview
                  ? "/month/story?preview=1"
                  : "/month/story?which=last"
              )}
            >
              <Play size={14} fill="currentColor" />
              Play your month
            </button>
          )}
        </div>

        {/* ── Preview: HOW TOMORROW ARRIVES ──────────────────────────────── */}
        {!persona && isPreview && story.tomorrow && (
          <div className="rise-in" style={{ animationDelay: "50ms" }}>
            <Whisper>HOW TOMORROW ARRIVES</Whisper>
            <div className="glass-card rounded-2xl p-4 mt-3 space-y-4">
              {/* Push notification mock */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  <Bell size={16} className="text-slate-400 dark:text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {story.tomorrow.push_title}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {story.tomorrow.push_body}
                  </p>
                </div>
              </div>
              {/* Brief/companion mock */}
              <div className="flex items-start gap-3 border-t border-slate-100 dark:border-slate-700/60 pt-4">
                <div className="mt-0.5 flex-shrink-0">
                  <PennyMark size={16} className="text-slate-400 dark:text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {story.tomorrow.brief_headline}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {story.tomorrow.brief_body}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
              Purely illustrative, based on today&apos;s figures.
            </p>
          </div>
        )}

        {/* ── Chapter 1: THE OPENING ──────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "100ms" }}>
          <Whisper>THE OPENING</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.opening) : narrative.opening} />
          </p>
          <div className="glass-card rounded-2xl p-4 mt-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Income in
                </p>
                <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                  {fmt(chapters.opening.income_in)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Deposits
                </p>
                <p className="text-base font-semibold num text-slate-900 dark:text-slate-100">
                  {chapters.opening.count}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Early-days gate / Chapters 2-6 ─────────────────────────────── */}
        {story.early_days ? (
          <div className="rise-in" style={{ animationDelay: "150ms" }}>
            <div className="glass-card rounded-2xl p-6 space-y-3">
              <Whisper>EARLY DAYS</Whisper>
              <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                The story builds as the month happens,{" "}
                {period.days_to_payday} day{period.days_to_payday !== 1 ? "s" : ""} to go.
              </p>
              <button
                onClick={() => setWhich("last")}
                className="text-sm font-medium text-indigo-600 dark:text-indigo-400 active:opacity-70 block mt-2"
              >
                Read last month ›
              </button>
            </div>
          </div>
        ) : (
          <>
        {/* ── Chapter 2: THE CLIFF & THE SWITCH ──────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "150ms" }}>
          <Whisper>THE SPENDING</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.month) : narrative.month} />
          </p>
          <div className="glass-card rounded-2xl p-4 mt-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Total spend
                </p>
                <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                  {fmt(chapters.spending?.total_spend ?? chapters.cliff?.period_spend ?? 0)}
                </p>
              </div>
              {chapters.spending && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Income in
                  </p>
                  <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                    {fmt(chapters.spending.income_in)}
                  </p>
                </div>
              )}
              {chapters.cliff && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Week 1 share
                  </p>
                  <p className="text-base font-semibold num text-slate-900 dark:text-slate-100">
                    {chapters.cliff.week1_pct}%
                  </p>
                </div>
              )}
            </div>
            {chapters.spending?.top_categories && chapters.spending.top_categories.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-700/60 mt-3 pt-3">
                <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                  {chapters.spending.top_categories.slice(0, 5).map((cat) => (
                    <div key={cat.category} className="flex items-center justify-between py-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {cat.category}
                      </span>
                      <span className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                        {fmt(cat.total)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {chapters.cards?.material && (
              <div className="border-t border-slate-100 dark:border-slate-700/60 mt-3 pt-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-mono tabular-nums">{fmt(chapters.cards.new_spend)}</span> of it rode on your credit cards.
                </p>
                {chapters.cards.delta === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    Balances held steady.
                  </p>
                ) : chapters.cards.delta > 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    Balances closed <span className="font-mono tabular-nums">{fmt(Math.abs(chapters.cards.delta))}</span> higher.
                  </p>
                ) : (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                    Balances closed <span className="font-mono tabular-nums">{fmt(Math.abs(chapters.cards.delta))}</span> lower.
                  </p>
                )}
                {chapters.switch?.switch_day && (
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                    Your credit cards took over from cash on {fmtDate(chapters.switch.switch_day)}.
                  </p>
                )}
                <button
                  onClick={() => router.push("/cards")}
                  className="text-sm font-medium text-indigo-600 dark:text-indigo-400 active:opacity-70 mt-2 block"
                >
                  The credit cards chapter ›
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Chapter 3: THE MOVES ────────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "200ms" }}>
          <Whisper>THE MOVES</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.moves) : narrative.moves} />
          </p>
          <div className="glass-card rounded-2xl p-4 mt-3">
            {activeMoves.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No transfers this cycle.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {activeMoves.map(({ key, label }) => {
                  const bucket = chapters.moves[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between py-2"
                    >
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {label}
                      </span>
                      <span className="text-sm font-semibold num text-slate-900 dark:text-slate-100">
                        {bucket.count}× · <span className="font-mono tabular-nums">{fmt(bucket.total)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Chapter 4: THE KEEPING ──────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "250ms" }}>
          <Whisper>THE KEEPING</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.keeping) : narrative.keeping} />
          </p>
          <div className="glass-card rounded-2xl p-4 mt-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Set aside
                </p>
                <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                  {fmt(chapters.keeping.set_aside)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Drawn back
                </p>
                <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                  {fmt(chapters.keeping.drawn_back)}
                </p>
              </div>
              {chapters.keeping.external > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    To investments
                  </p>
                  <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                    {fmt(chapters.keeping.external)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Chapter 5: THE CLOSE ────────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "300ms" }}>
          <Whisper>THE CLOSE</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.close) : narrative.close} />
          </p>
          {chapters.close != null && (
            <div className="glass-card rounded-2xl p-4 mt-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Month-end cash
                  </p>
                  <p className="text-base font-semibold money text-slate-900 dark:text-slate-100">
                    {fmt(chapters.close.month_end_cash)}
                  </p>
                </div>
                {chapters.cards?.material && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Card movement
                    </p>
                    <p className={`text-base font-semibold num ${cardDeltaClass}`}>
                      <MoneyText text={cardMovement} />
                    </p>
                  </div>
                )}
                {chapters.close.streak_weeks != null && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Streak
                    </p>
                    <p className="text-base font-semibold num text-slate-900 dark:text-slate-100">
                      {chapters.close.streak_weeks}w
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Chapter 6: THE SELF ─────────────────────────────────────────── */}
        <div className="rise-in" style={{ animationDelay: "350ms" }}>
          <Whisper>THE SELF</Whisper>
          <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 mt-2">
            <MoneyText text={hideNetWorth ? maskAmounts(narrative.self) : narrative.self} />
          </p>
        </div>
          </>
        )}

      </div>
      <BottomNav />
    </main>
  );
}
