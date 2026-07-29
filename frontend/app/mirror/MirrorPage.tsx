"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import { api, MirrorPortrait, MirrorTrait } from "@/lib/api";
import BottomNav from "@/components/BottomNav";

// Kind → colour chip accent (Category Voice Rule: ~15% tint bg + full-strength icon)
// chip text uses a dark hue-matched shade (not neutral gray) for contrast on the tinted bg
const KIND_ACCENT: Record<string, { bg: string; darkBg: string; dot: string; text: string; darkText: string }> = {
  structure: { bg: "bg-indigo-50", darkBg: "dark:bg-indigo-900/20", dot: "bg-indigo-500", text: "text-indigo-800", darkText: "dark:text-indigo-200" },
  habit:     { bg: "bg-emerald-50", darkBg: "dark:bg-emerald-900/20", dot: "bg-emerald-500", text: "text-emerald-800", darkText: "dark:text-emerald-200" },
  pleasure:  { bg: "bg-violet-50", darkBg: "dark:bg-violet-900/20", dot: "bg-violet-500", text: "text-violet-800", darkText: "dark:text-violet-200" },
  hygiene:   { bg: "bg-slate-100", darkBg: "dark:bg-slate-700/40", dot: "bg-slate-400", text: "text-slate-700", darkText: "dark:text-slate-200" },
};

function TraitCard({ trait, onChoice }: { trait: MirrorTrait; onChoice: (id: string, choice: "keep" | "change") => void }) {
  const accent = KIND_ACCENT[trait.kind] ?? KIND_ACCENT.structure;
  const [saving, setSaving] = useState(false);

  async function handleChoice(choice: "keep" | "change") {
    if (saving || trait.choice === choice) return;
    setSaving(true);
    try {
      await api.setMirrorChoice(trait.id, choice);
      onChoice(trait.id, choice);
    } catch {
      // silently ignore — UI already reflects optimistic state via parent
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
      {/* Header band */}
      <div className={`px-4 pt-4 pb-3 flex items-start gap-3`}>
        <span className={`mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${accent.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">{trait.title}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{trait.narrative}</p>
        </div>
      </div>

      {/* Evidence chips */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        {trait.evidence.map((e, i) => (
          <span
            key={i}
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${accent.bg} ${accent.darkBg} ${accent.text} ${accent.darkText}`}
          >
            {e}
          </span>
        ))}
      </div>

      {/* Choice buttons */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={() => handleChoice("keep")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-all active:scale-95 ${
            trait.choice === "keep"
              ? "bg-indigo-600 border-indigo-600 text-white"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
          }`}
        >
          This is me — keep it
        </button>
        <button
          onClick={() => handleChoice("change")}
          disabled={saving}
          className={`flex-1 text-xs font-semibold py-2 px-3 rounded-xl border transition-all active:scale-95 ${
            trait.choice === "change"
              ? "bg-amber-500 border-amber-500 text-white"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          }`}
        >
          I&apos;d like to change this
        </button>
      </div>

      {/* Confirmation line */}
      {trait.choice && (
        <div className="px-4 pb-4 -mt-1">
          <p className={`text-[11px] font-medium ${
            trait.choice === "keep"
              ? "text-indigo-500 dark:text-indigo-400"
              : "text-amber-600 dark:text-amber-400"
          }`}>
            {trait.choice === "keep"
              ? "Noted — we'll never nag you about this."
              : "Noted — Penny will start working on this with you."}
          </p>
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-4 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="mt-1 w-2.5 h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-3 w-full bg-slate-100 dark:bg-slate-700/60 rounded" />
          <div className="h-3 w-3/4 bg-slate-100 dark:bg-slate-700/60 rounded" />
        </div>
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
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-36 lg:pb-8">
      <div className="px-4 pt-6 pb-2 lg:px-0 lg:pt-0 lg:max-w-2xl lg:mx-auto lg:pt-6">
        {/* Back nav */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity mb-5"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
              THE MIRROR
            </p>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
              How your money behaves
            </h1>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} className="text-indigo-500" />
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
          Computed from your last {monthsLabel ?? "6 months"} of transactions.
          No judgement — just what the data says.
        </p>

        {/* Refresh button */}
        {!loading && portrait?.status === "ok" && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-500 dark:text-indigo-400 mb-5 active:opacity-70 transition-opacity"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Recomputing…" : "Recompute"}
          </button>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : !portrait || portrait.status === "insufficient_data" ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 text-center">
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
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No distinct patterns detected yet — check back after more transactions have been synced.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {portrait.traits.map(trait => (
              <TraitCard key={trait.id} trait={trait} onChoice={handleChoice} />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
