"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, Sparkles } from "lucide-react";
import { api, MirrorPortrait, MirrorTrait, ActiveAim } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import BottomNav from "@/components/BottomNav";
import AimSheet from "@/components/AimSheet";

// Kind → colour chip accent (Category Voice Rule: ~15% tint bg + full-strength icon)
// chip text uses a dark hue-matched shade (not neutral gray) for contrast on the tinted bg
const KIND_ACCENT: Record<string, { bg: string; darkBg: string; dot: string; text: string; darkText: string }> = {
  structure: { bg: "bg-indigo-50", darkBg: "dark:bg-indigo-900/20", dot: "bg-indigo-500", text: "text-indigo-800", darkText: "dark:text-indigo-200" },
  habit:     { bg: "bg-emerald-50", darkBg: "dark:bg-emerald-900/20", dot: "bg-emerald-500", text: "text-emerald-800", darkText: "dark:text-emerald-200" },
  pleasure:  { bg: "bg-violet-50", darkBg: "dark:bg-violet-900/20", dot: "bg-violet-500", text: "text-violet-800", darkText: "dark:text-violet-200" },
  hygiene:   { bg: "bg-slate-100", darkBg: "dark:bg-slate-700/40", dot: "bg-slate-400", text: "text-slate-700", darkText: "dark:text-slate-200" },
};


// Category a trait is anchored to: prefer the machine-readable ref_category the
// backend now sends; fall back to parsing "Your Signature: {X}" titles for
// portraits computed before the field existed.
function traitCategory(trait: MirrorTrait): string | null {
  if (trait.ref_category) return trait.ref_category;
  const m = trait.title.match(/^Your Signature:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

function TraitCard({ trait, activeAim, onChoice, onSetAim }: {
  trait: MirrorTrait;
  activeAim: ActiveAim | null;
  onChoice: (id: string, choice: "keep" | "change") => void;
  onSetAim: (category: string) => void;
}) {
  const accent = KIND_ACCENT[trait.kind] ?? KIND_ACCENT.structure;
  const [saving, setSaving] = useState(false);
  const category = traitCategory(trait);

  async function handleChoice(choice: "keep" | "change") {
    if (saving || trait.choice === choice) return;
    setSaving(true);
    try {
      await api.setMirrorChoice(trait.id, choice);
      onChoice(trait.id, choice);
      // Change on a category-backed trait → open the aim sheet so the choice
      // becomes something Penny can actually track (skip if an aim exists).
      if (choice === "change" && category && !activeAim) {
        onSetAim(category);
      }
    } catch {
      // silently ignore — UI already reflects optimistic state via parent
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl glass-card overflow-hidden">
      {/* Header band */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">{trait.title}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{trait.narrative}</p>
      </div>

      {/* Evidence: clean muted lines */}
      {trait.evidence.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          {trait.evidence.map((e, i) => (
            <p key={i} className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">{e}</p>
          ))}
        </div>
      )}

      {/* Choice buttons */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={() => handleChoice("keep")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-[transform,opacity,background-color,color,border-color] duration-150 active:scale-[0.98] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            trait.choice === "keep"
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          This is me — keep it
        </button>
        <button
          onClick={() => handleChoice("change")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-[transform,opacity,background-color,color,border-color] duration-150 active:scale-[0.98] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            trait.choice === "change"
              ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          I&apos;d like to change this
        </button>
      </div>

      {/* Confirmation line */}
      {trait.choice && (
        <div className="px-4 pb-4 -mt-1">
          {trait.choice === "keep" ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Noted — we&apos;ll never nag you about this.
            </p>
          ) : category && activeAim ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Aim set — Penny is tracking it with you.
            </p>
          ) : category ? (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Noted — an aim gives Penny something to track.{" "}
              <button
                onClick={() => onSetAim(category)}
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                Set an aim
              </button>
            </p>
          ) : (
            <p className="text-[13px] text-slate-500 dark:text-slate-400">
              Noted — Penny will factor this in.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl glass-card p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
        <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
        <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-6 w-28 bg-slate-100 dark:bg-slate-700/60 rounded-full" />
        <div className="h-6 w-36 bg-slate-100 dark:bg-slate-700/60 rounded-full" />
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex-1 h-9 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
        <div className="flex-1 h-9 bg-slate-100 dark:bg-slate-700/60 rounded-xl" />
      </div>
    </div>
  );
}

export default function MirrorPage() {
  const router = useRouter();
  const [portrait, setPortrait] = useState<MirrorPortrait | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aims, setAims] = useState<ActiveAim[]>([]);
  const [aimCategory, setAimCategory] = useState<string | null>(null);

  const refreshAims = useCallback(() => {
    api.listCheckpoints()
      .then(d => setAims(d.checkpoints))
      .catch(() => {});
  }, []);

  const load = useCallback(async (refresh = false) => {
    try {
      const data = await api.getMirror(refresh);
      setPortrait(data);
    } catch {
      setPortrait(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { refreshAims(); }, [refreshAims]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
  }

  function handleChoice(traitId: string, choice: "keep" | "change") {
    setPortrait(prev => {
      if (!prev || prev.status !== "ok") return prev;
      return {
        ...prev,
        traits: prev.traits.map(t =>
          t.id === traitId ? { ...t, choice } : t
        ),
      };
    });
  }

  const monthsLabel = portrait?.status === "ok"
    ? `${Math.round(portrait.window_days / 30)} months`
    : null;

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto">
        {/* Header block with rise-in */}
        <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
          {/* Back nav */}
          <button
            onClick={() => goBack(router)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 transition-[transform,opacity] mb-5"
          >
            <ChevronLeft size={15} />
            Back
          </button>

          {/* Header */}
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                THE MIRROR
              </p>
              <h1 className="text-[28px] font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
                How your money behaves
              </h1>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-indigo-500" />
              </div>
            </div>
          </div>

          {/* Intro paragraph */}
          <p className="text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed mt-3 mb-6">
            Computed from your last {monthsLabel ?? "6 months"} of transactions. No judgement — just what the data says.
          </p>

          {/* Refresh button */}
          {!loading && portrait?.status === "ok" && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-500 dark:text-indigo-400 mb-5 active:opacity-70 transition-[transform,opacity]"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Recomputing…" : "Recompute"}
            </button>
          )}
        </div>

        {/* Active aims — what the user has chosen to work on this period */}
        {aims.length > 0 && (
          <div className="rise-in mb-6" style={{ "--rise-index": 0 } as React.CSSProperties}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
              WHAT YOU&apos;RE WORKING ON
            </p>
            <div className="space-y-2">
              {aims.map(aim => (
                <div key={aim.id} className="glass-card rounded-2xl px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{aim.ref}</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                    £{Math.round(aim.spent_so_far).toLocaleString("en-GB")} of your £{Math.round(aim.aim_amount).toLocaleString("en-GB")} aim
                    {" · "}
                    {aim.days_left <= 0 ? "last day" : aim.days_left === 1 ? "1 day left" : `${aim.days_left} days left`}
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        await api.cancelCheckpoint(aim.id);
                        setAims(prev => prev.filter(a => a.id !== aim.id));
                      } catch {
                        // silent — the row stays, user can try again
                      }
                    }}
                    className="mt-1.5 text-[12px] text-slate-500 dark:text-slate-400 active:opacity-60 transition-opacity"
                  >
                    Cancel this aim
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : !portrait || portrait.status === "insufficient_data" ? (
          <div className="rounded-2xl glass-card p-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-4">
              <Sparkles size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-bold text-slate-900 dark:text-slate-100 mb-2">
              Not enough data yet
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              The Mirror needs at least 60 days of transactions to compute your behavioural portrait. Check back after a couple of months of connected banking.
            </p>
          </div>
        ) : portrait.traits.length === 0 ? (
          <div className="rounded-2xl glass-card p-6 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No distinct patterns detected yet — check back after more transactions have been synced.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {portrait.traits.map((trait, i) => {
              const cat = traitCategory(trait);
              const activeAim = cat ? aims.find(a => a.ref === cat) ?? null : null;
              return (
                <div key={trait.id} className="rise-in" style={{ "--rise-index": i + 1 } as React.CSSProperties}>
                  <TraitCard
                    trait={trait}
                    activeAim={activeAim}
                    onChoice={handleChoice}
                    onSetAim={setAimCategory}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {aimCategory && (
        <AimSheet
          category={aimCategory}
          onClose={() => setAimCategory(null)}
          onSaved={refreshAims}
        />
      )}

      <BottomNav />
    </div>
  );
}
