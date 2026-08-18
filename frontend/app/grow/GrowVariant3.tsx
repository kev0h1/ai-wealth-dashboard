"use client";

// ─────────────────────────────────────────────────────────────────────────
// Grow — Variant 3: "Two-Track Split"
//
// Art direction: Save (cash) and Invest (at-risk) render as two parallel
// tracks either side of a vertical spine; the ladder itself IS the spine —
// each rung sits on the side of the track it feeds, so the whole screen
// reads as "here's the order, and here's which pot your next pound goes
// toward". Foundation/obstruction rungs (essentials, expensive debt) that
// belong to neither track sit centred on the spine itself.
//
// FCA doctrine (inherited from the API, never rewritten here): verdict.sub,
// buffer/debt/invest figures and every rung's `detail` are facts about this
// user. `options` stay the generic, non-instructional strings the backend
// sends verbatim ("some people...") and only ever render under the ONE
// active rung — never phrased as "you should".
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  PiggyBank,
  LineChart,
  ShieldCheck,
  CreditCard,
  Landmark,
  Umbrella,
  CheckCircle2,
  Lock,
  ArrowDown,
} from "lucide-react";
import { api, GrowView } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";

// `frontend/lib/api.ts` re-exports GrowView but not the nested
// GrowLadderStep — derive it locally rather than editing that shared file.
type GrowLadderStep = GrowView["ladder"][number];

// ── Money formatting — matches the site's £-rounded convention ─────────────
function money(n: number): string {
  return `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;
}

// ── Track model ──────────────────────────────────────────────────────────
// Which side of the spine each rung's surplus feeds. `neutral` rungs are
// foundation/obstruction steps that belong to neither pot — they sit on
// the spine itself, not in a column.
type Track = "save" | "invest" | "neutral";

const TRACK_BY_KEY: Record<string, Track> = {
  essentials: "neutral",
  pension_match: "invest",
  starter_buffer: "save",
  expensive_debt: "neutral",
  full_fund: "save",
  pension_topup: "invest",
  isa_invest: "invest",
};

const ICON_BY_KEY: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  essentials: ShieldCheck,
  pension_match: Landmark,
  starter_buffer: PiggyBank,
  expensive_debt: CreditCard,
  full_fund: Umbrella,
  pension_topup: Landmark,
  isa_invest: LineChart,
};

const TRACK_META: Record<
  Track,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; text: string; dot: string; tint: string; border: string }
> = {
  save: {
    label: "Save",
    icon: PiggyBank,
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    tint: "bg-emerald-500/10",
    border: "border-emerald-200/70 dark:border-emerald-900/50",
  },
  invest: {
    label: "Invest",
    icon: LineChart,
    text: "text-indigo-600 dark:text-indigo-400",
    dot: "bg-indigo-500",
    tint: "bg-indigo-500/10",
    border: "border-indigo-200/70 dark:border-indigo-900/50",
  },
  neutral: {
    label: "Foundation",
    icon: ShieldCheck,
    text: "text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400 dark:bg-slate-500",
    tint: "bg-slate-400/10",
    border: "border-slate-200/70 dark:border-slate-700",
  },
};

// ── Whisper label (shared uppercase caption style) ──────────────────────────
function WhisperLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────
function GrowSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="rounded-3xl p-5 glass-hero space-y-3">
        <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-6 w-3/4 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-1/2 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
      <div className="rounded-2xl p-4 glass-card space-y-2">
        <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-8 w-28 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-white dark:bg-slate-800 rounded-2xl shadow-sm" />
        ))}
      </div>
    </div>
  );
}

// ── Rung state visuals ───────────────────────────────────────────────────
function RungStateIcon({ rung, track }: { rung: GrowLadderStep; track: Track }) {
  if (rung.state === "done") {
    return <CheckCircle2 size={15} className="text-emerald-500 dark:text-emerald-400 flex-shrink-0" aria-hidden />;
  }
  if (rung.state === "locked") {
    return <Lock size={13} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />;
  }
  const Icon = ICON_BY_KEY[rung.key] ?? TRACK_META[track].icon;
  return <Icon size={15} className={`${TRACK_META[track].text} flex-shrink-0`} aria-hidden />;
}

// ── A compact card for a "done" or "locked" rung sitting in a track column ──
function TrackRungCard({ rung, track }: { rung: GrowLadderStep; track: Track }) {
  const quiet = rung.state === "locked";
  return (
    <div
      className={[
        "rounded-2xl p-3 border transition-opacity",
        quiet
          ? "bg-slate-50/70 dark:bg-slate-800/30 border-dashed border-slate-200 dark:border-slate-700 opacity-60"
          : `bg-white dark:bg-slate-800 shadow-sm ${TRACK_META[track].border}`,
      ].join(" ")}
    >
      <div className="flex items-start gap-1.5">
        <RungStateIcon rung={rung} track={track} />
        <div className="min-w-0">
          <p
            className={[
              "text-xs font-semibold leading-snug",
              quiet ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200",
            ].join(" ")}
          >
            {rung.title}
          </p>
          <p
            className={[
              "text-[11px] leading-snug mt-0.5",
              quiet ? "text-slate-300 dark:text-slate-600" : "text-slate-500 dark:text-slate-400",
            ].join(" ")}
          >
            {rung.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── The single emphasised "active" rung — full width, detail + options ─────
function ActiveRungCard({ rung, track }: { rung: GrowLadderStep; track: Track }) {
  const meta = TRACK_META[track];
  return (
    <div
      className={`rounded-2xl p-4 border-2 ${meta.border} ${meta.tint} shadow-sm`}
      style={{ gridColumn: "1 / -1" }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${meta.tint} border ${meta.border}`}>
          <RungStateIcon rung={rung} track={track} />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Up next{track !== "neutral" ? ` · feeds ${meta.label}` : ""}
          </p>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">{rung.title}</p>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-200 mb-2">{rung.detail}</p>
      {rung.options.length > 0 && (
        <ul className="space-y-1.5">
          {rung.options.map((opt, i) => (
            <li key={i} className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400 flex gap-1.5">
              <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">·</span>
              <span>{opt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── A neutral (foundation/obstruction) rung — centred on the spine itself ──
function NeutralRungCard({ rung }: { rung: GrowLadderStep }) {
  if (rung.state === "active") return <ActiveRungCard rung={rung} track="neutral" />;
  const quiet = rung.state === "locked";
  return (
    <div style={{ gridColumn: "1 / -1" }} className="flex justify-center">
      <div
        className={[
          "rounded-2xl px-4 py-2.5 border flex items-center gap-2 max-w-md w-full",
          quiet
            ? "bg-slate-50/70 dark:bg-slate-800/30 border-dashed border-slate-200 dark:border-slate-700 opacity-60"
            : "bg-white dark:bg-slate-800 shadow-sm border-slate-200/70 dark:border-slate-700",
        ].join(" ")}
      >
        <RungStateIcon rung={rung} track="neutral" />
        <div className="min-w-0">
          <p
            className={[
              "text-xs font-semibold leading-snug",
              quiet ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200",
            ].join(" ")}
          >
            {rung.title}
          </p>
          <p
            className={[
              "text-[11px] leading-snug",
              quiet ? "text-slate-300 dark:text-slate-600" : "text-slate-500 dark:text-slate-400",
            ].join(" ")}
          >
            {rung.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Column header (Save / Invest) with its own live stat ───────────────────
function TrackColumnHeader({
  track,
  stat,
  align,
}: {
  track: "save" | "invest";
  stat: React.ReactNode;
  align: "left" | "right";
}) {
  const meta = TRACK_META[track];
  const Icon = meta.icon;
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className={`flex items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
        {align === "left" && (
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${meta.tint}`}>
            <Icon size={13} className={meta.text} />
          </span>
        )}
        <p className={`text-[11px] font-semibold uppercase tracking-widest ${meta.text}`}>{meta.label}</p>
        {align === "right" && (
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${meta.tint}`}>
            <Icon size={13} className={meta.text} />
          </span>
        )}
      </div>
      <div className="mt-1">{stat}</div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────
export default function GrowVariant3() {
  const router = useRouter();
  const { hideNetWorth: hide } = usePreferences();

  const [grow, setGrow] = useState<GrowView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const data = await api.getGrow();
      setGrow(data);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ladder = grow?.ladder ?? [];
  const activeRung = ladder.find((r) => r.state === "active") ?? null;
  const activeTrack: Track = activeRung ? TRACK_BY_KEY[activeRung.key] ?? "neutral" : "neutral";
  const allDone = ladder.length > 0 && ladder.every((r) => r.state === "done");
  const noData = !loading && !fetchError && grow != null && ladder.length === 0;

  const bufferPct = grow ? Math.max(0, Math.min(100, grow.buffer.pct)) : 0;

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto">
        {/* Back nav */}
        <button
          onClick={() => goBack(router)}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 active:opacity-70 transition-[transform,opacity] mb-5"
        >
          <ChevronLeft size={15} />
          Back
        </button>

        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Grow</h1>
        </div>

        {loading ? (
          <GrowSkeleton />
        ) : fetchError || !grow ? (
          <div className="glass-card rounded-2xl p-5 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
              Couldn&apos;t load your priority ladder, check your connection.
            </p>
            <button
              onClick={load}
              className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70"
            >
              Try again
            </button>
          </div>
        ) : noData ? (
          <div className="glass-card rounded-2xl p-5 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Nothing to show yet, connect an account to see your priority ladder.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── 1. Verdict ── */}
            <div className="rounded-3xl p-5 glass-hero">
              <WhisperLabel>Your next move</WhisperLabel>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug mt-1">
                {grow.verdict.headline}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{grow.verdict.sub}</p>
            </div>

            {/* ── 2. Surplus → which track it feeds (the spine's source) ── */}
            <div className="rounded-2xl p-4 glass-card">
              <WhisperLabel>{grow.surplus_monthly >= 0 ? "Monthly surplus" : "Monthly shortfall"}</WhisperLabel>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums mt-1">
                {hide ? "£••••" : money(grow.surplus_monthly)}
              </p>
              {activeRung ? (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                  <ArrowDown size={13} className="text-slate-300 dark:text-slate-600 flex-shrink-0" aria-hidden />
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    Feeds{" "}
                    <span className={`font-semibold ${TRACK_META[activeTrack].text}`}>
                      {activeTrack === "neutral" ? activeRung.title : TRACK_META[activeTrack].label}
                    </span>
                    {activeTrack !== "neutral" && (
                      <span className="text-slate-400 dark:text-slate-500"> · {activeRung.title}</span>
                    )}{" "}
                    next
                  </p>
                </div>
              ) : allDone ? (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                  Every rung on your ladder is covered right now.
                </p>
              ) : null}
            </div>

            {/* ── 3+4. The ladder as a two-track spine ── */}
            <div>
              <WhisperLabel>The ladder</WhisperLabel>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 mt-3 relative">
                {/* Spine line, centred behind the two columns */}
                <div
                  aria-hidden
                  className="absolute top-1 bottom-1 left-1/2 -translate-x-1/2 w-px bg-slate-200 dark:bg-slate-700"
                />

                <TrackColumnHeader
                  track="save"
                  align="left"
                  stat={
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                        {hide ? "£••••" : money(grow.buffer.current)}
                        <span className="text-slate-400 dark:text-slate-500 font-normal">
                          {" "}
                          / {hide ? "£••••" : money(grow.buffer.target)}
                        </span>
                      </p>
                      <div className="h-1.5 w-full max-w-[120px] bg-slate-100 dark:bg-slate-700 rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${bufferPct}%` }}
                        />
                      </div>
                    </div>
                  }
                />
                <TrackColumnHeader
                  track="invest"
                  align="right"
                  stat={
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                      {grow.invest.has_investments
                        ? (hide ? "£••••" : money(grow.invest.portfolio_value))
                        : <span className="text-slate-400 dark:text-slate-500 font-normal text-xs">No investments yet</span>}
                    </p>
                  }
                />

                {ladder.map((rung) => {
                  const track = TRACK_BY_KEY[rung.key] ?? "neutral";

                  if (track === "neutral") {
                    return <NeutralRungCard key={rung.key} rung={rung} />;
                  }

                  if (rung.state === "active") {
                    return <ActiveRungCard key={rung.key} rung={rung} track={track} />;
                  }

                  // Track rung: place the card in its own column, an empty
                  // spacer in the other — keeps both columns aligned as two
                  // true parallel tracks either side of the spine.
                  if (track === "save") {
                    return (
                      <div key={rung.key} className="contents">
                        <TrackRungCard rung={rung} track={track} />
                        <div aria-hidden />
                      </div>
                    );
                  }
                  return (
                    <div key={rung.key} className="contents">
                      <div aria-hidden />
                      <TrackRungCard rung={rung} track={track} />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── 6. Notes — quiet footnotes ── */}
            {grow.notes.length > 0 && (
              <div className="space-y-1 pt-1">
                {grow.notes.map((note, i) => (
                  <p key={i} className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500 italic">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
