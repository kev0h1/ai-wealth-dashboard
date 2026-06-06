"use client";

import { Zap, Flame, Star } from "lucide-react";
import type { ChallengesData, Challenge } from "@/lib/api";

export const TIER_CONFIG = {
  easy:    { label: "Easy",    cadenceLabel: "Daily",  color: "#10b981", bg: "bg-emerald-50 dark:bg-emerald-900/20",  badge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300" },
  medium:  { label: "Medium",  cadenceLabel: "Weekly", color: "#f59e0b", bg: "bg-amber-50 dark:bg-amber-900/20",      badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" },
  stretch: { label: "Stretch", cadenceLabel: "Weekly", color: "#e11d48", bg: "bg-rose-50 dark:bg-rose-900/20",        badge: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300" },
} as const;

function fmtAmt(n: number, currency: string) {
  const s = currency === "KES" ? "KES " : "£";
  return `${s}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function TierCard({ challenge, hideNetWorth, onTips }: {
  challenge: Challenge;
  hideNetWorth: boolean;
  onTips: () => void;
}) {
  const cfg = TIER_CONFIG[challenge.tier as keyof typeof TIER_CONFIG];
  const p = challenge.progress;
  const sym = challenge.currency === "KES" ? "KES " : "£";
  const fmtA = (n: number) => `${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <div className={`rounded-xl p-3 ${cfg.bg}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
            {cfg.label}
          </span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">{cfg.cadenceLabel}</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">+{challenge.xp_reward} XP</span>
      </div>

      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2 leading-snug">{challenge.title}</p>

      {p && (
        <>
          <div className="flex justify-between text-[9px] text-slate-500 dark:text-slate-400 mb-1">
            <span>{hideNetWorth ? "••••" : fmtA(p.actual_so_far)} spent</span>
            <span>target {hideNetWorth ? "••••" : fmtA(p.target)}</span>
          </div>
          <div className="h-1.5 bg-white/60 dark:bg-slate-700/60 rounded-full overflow-hidden mb-1.5">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${p.pct_used}%`, backgroundColor: p.on_track ? cfg.color : "#ef4444" }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold" style={{ color: p.on_track ? cfg.color : "#ef4444" }}>
              {p.on_track ? "✓ On track" : "⚠ Over target"}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500">{p.time_left}</span>
          </div>
        </>
      )}

      <button
        onClick={onTips}
        className="mt-2 w-full py-1.5 rounded-lg text-[10px] font-semibold text-white active:scale-95 transition-transform"
        style={{ backgroundColor: cfg.color }}
      >
        Get tips ⚡
      </button>
    </div>
  );
}


export default function ChallengesPanel({ data, hideNetWorth, onOpenChat }: {
  data: ChallengesData;
  hideNetWorth: boolean;
  onOpenChat: (prompt?: string) => void;
}) {
  const { stats, challenges, history } = data;
  const xpPct = (stats.xp_in_level / stats.xp_per_level) * 100;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-3" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-white opacity-90" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-white opacity-90">Spending Goals</p>
          </div>
          {stats.streak > 0 && (
            <div className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-0.5">
              <Flame className="w-3 h-3 text-white" />
              <span className="text-xs font-bold text-white">{stats.streak}wk streak</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/25 flex items-center justify-center flex-shrink-0">
            <Star className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between mb-0.5">
              <span className="text-xs font-bold text-white">Level {stats.level}</span>
              <span className="text-[10px] text-white/70">{stats.xp_in_level} / {stats.xp_per_level} XP</span>
            </div>
            <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${xpPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 space-y-2">
        {challenges.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-3">
            Sync your accounts to generate goals
          </p>
        ) : (
          challenges.map((ch) => (
            <TierCard
              key={ch.id}
              challenge={ch}
              hideNetWorth={hideNetWorth}
              onTips={() => onOpenChat(
                `Help me with this goal: "${ch.title}". My target is ${fmtAmt(ch.target, ch.currency)} (down ${Math.round(ch.reduction_pct * 100)}% from my usual ${fmtAmt(ch.baseline, ch.currency)}). Give me 3 specific, actionable tips.`
              )}
            />
          ))
        )}
      </div>

      {history.length > 0 && (
        <div className="px-4 pb-3 border-t border-slate-50 dark:border-slate-700 pt-2">
          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">Recent</p>
          <div className="space-y-1.5">
            {history.slice(0, 8).map((ch) => {
              const cfg = TIER_CONFIG[ch.tier as keyof typeof TIER_CONFIG];
              return (
                <div key={ch.id} className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${ch.status === "completed" ? "text-emerald-500" : "text-red-400"}`}>
                    {ch.status === "completed" ? "✓" : "✗"}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 w-10 flex-shrink-0">{dateLabel(ch.period_start)}</span>
                  <span className="text-[10px] text-slate-600 dark:text-slate-300 flex-1 truncate">{ch.category} ↓{Math.round(ch.reduction_pct * 100)}%</span>
                  <span className={`text-[9px] font-semibold flex-shrink-0 ${ch.status === "completed" ? "text-amber-600" : "text-slate-400"}`}>
                    {ch.status === "completed" ? `+${ch.xp_reward} XP` : hideNetWorth ? "••" : ch.actual !== null ? fmtAmt(ch.actual, ch.currency) : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
