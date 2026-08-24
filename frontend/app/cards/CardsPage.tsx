"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api, CardsStory } from "@/lib/api";
import { goBack } from "@/lib/goBack";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import type { Account } from "@/lib/api";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { usePreferences } from "@/components/PreferencesContext";
import BottomNav from "@/components/BottomNav";
import MoneyText from "@/components/MoneyText";

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

// ── Short month name from "YYYY-MM-DD" ────────────────────────────────────────
function monthShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short" });
}

export default function CardsPage() {
  const router = useRouter();
  const { colours } = useColours();
  const { hideNetWorth } = usePreferences();

  const [story, setStory] = useState<CardsStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const mask = (s: string) => (hideNetWorth ? "£••••" : s);

  const load = useCallback(async () => {
    try {
      const data = await api.getCardsStory();
      setStory(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Loading ──────────────────────────────────────────────────────────────────
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

  // ── Error / empty ────────────────────────────────────────────────────────────
  const isEmpty = error || !story || story.status !== "ok";
  if (isEmpty) {
    return (
      <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
        <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto">
          {/* Back button */}
          <button
            onClick={() => goBack(router)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 active:scale-[0.98] transition-[transform,opacity] mb-5"
          >
            <ChevronLeft size={15} />
            Back
          </button>
          <div className="rounded-2xl glass-card p-6">
            <p className="text-base font-bold text-slate-900 dark:text-slate-100 mb-2">
              Nothing to read yet
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Connect a credit card and check back after a few days of spending.
            </p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  const { period, movement, per_card, drivers, pattern_line, trajectory } = story;
  const { delta, new_spend, payments } = movement;
  const { days_elapsed } = period;

  // ── Movement verdict ─────────────────────────────────────────────────────────
  const deltaAbs = Math.abs(delta);
  let verdictNode: React.ReactNode;
  let companionLine: string;

  if (deltaAbs < 20) {
    verdictNode = (
      <span className="text-slate-900 dark:text-slate-100">Held steady</span>
    );
    companionLine = "Cards barely moved this cycle.";
  } else if (delta >= 20) {
    // Balance grew (more owed) — NEUTRAL slate, never red
    verdictNode = (
      <span className="text-slate-900 dark:text-slate-100">
        ↑ <span className="font-mono tabular-nums">{mask(fmtGBP(delta))}</span>
      </span>
    );
    companionLine = `New spend ${mask(fmtGBP(new_spend))} · Payments ${mask(fmtGBP(payments))}`;
  } else {
    // delta <= -20: balance shrank (paid down) — emerald
    verdictNode = (
      <span className="text-emerald-600 dark:text-emerald-400">
        ↓ <span className="font-mono tabular-nums">{mask(fmtGBP(delta))}</span>
      </span>
    );
    companionLine = `New spend ${mask(fmtGBP(new_spend))} · Payments ${mask(fmtGBP(payments))}`;
  }

  // ── Trajectory bar chart ─────────────────────────────────────────────────────
  const trajSlice = trajectory.slice(-6);
  const maxAbsDelta = trajSlice.reduce((m, t) => Math.max(m, Math.abs(t.delta)), 0);

  return (
    <div className="min-h-dvh pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div className="px-4 pt-6 pb-2 max-w-2xl mx-auto space-y-8">

        {/* ── Section 1: Header ─────────────────────────────────────────────── */}
        <div className="rise-in" style={{ "--rise-index": 0 } as React.CSSProperties}>
          {/* Back nav */}
          <button
            onClick={() => goBack(router)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 active:opacity-70 active:scale-[0.98] transition-[transform,opacity] mb-5"
          >
            <ChevronLeft size={15} />
            Back
          </button>

          {/* Whisper label */}
          <Whisper>CARDS · THIS CYCLE</Whisper>

          {/* Muted period range */}
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
            {fmtDate(period.start)} – {fmtDate(period.end)}
          </p>
        </div>

        {/* ── Section 2: Movement headline ──────────────────────────────────── */}
        <div className="rise-in" style={{ "--rise-index": 1 } as React.CSSProperties}>
          <div className="glass-hero rounded-3xl p-5">
            {/* Whisper label */}
            <Whisper>CARD MOVEMENT · {days_elapsed} DAYS</Whisper>

            {/* Verdict figure */}
            <p className="text-3xl font-bold num tracking-tight mt-2 mb-1">
              {verdictNode}
            </p>

            {/* Companion / breakdown line */}
            {deltaAbs < 20 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {companionLine}
              </p>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400 num">
                New spend <span className="font-mono tabular-nums">{mask(fmtGBP(new_spend))}</span> · Payments <span className="font-mono tabular-nums">{mask(fmtGBP(payments))}</span>
              </p>
            )}

            {/* Clarifying sentence — contextualises the headline */}
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 leading-snug">
              <MoneyText text={
                deltaAbs < 20
                  ? `Your balances barely moved, you put on ${mask(fmtGBP(new_spend))} and paid off ${mask(fmtGBP(payments))}.`
                  : delta >= 20
                  ? `Your balances grew by ${mask(fmtGBP(delta))}, you put on ${mask(fmtGBP(new_spend))} and paid off ${mask(fmtGBP(payments))}.`
                  : `Your balances shrank by ${mask(fmtGBP(deltaAbs))}, you put on ${mask(fmtGBP(new_spend))} and paid off ${mask(fmtGBP(payments))}.`
              } />
            </p>
          </div>
        </div>

        {/* ── Section 3: WHERE IT MOVED ─────────────────────────────────────── */}
        {per_card.length > 0 && (
          <div className="rise-in" style={{ "--rise-index": 2 } as React.CSSProperties}>
            <Whisper>WHERE IT MOVED</Whisper>
            <div className="glass-card rounded-2xl mt-3 divide-y divide-slate-100 dark:divide-slate-700/60 overflow-hidden">
              {per_card.map((c) => {
                // Construct a minimal Account-shaped object for accountBrand
                const fakeAccount = {
                  provider: c.provider,
                  name: c.name,
                  type: "credit_card",
                } as unknown as Account;
                const brand = accountBrand(fakeAccount);

                const key = c.account_id;
                const balanceAbs = Math.abs(c.balance);
                // Sign-aware caption — c.balance follows the same flipped
                // TrueLayer convention as everywhere else (negative = owed,
                // positive = in credit; see truelayer_sync.py). A card you
                // have overpaid is never "owed", and a paid-off £0 card gets
                // no caption at all.
                const balanceCaption = c.balance < 0 ? "owed" : c.balance > 0 ? "in credit" : null;

                return (
                  <div key={key} className="px-4 py-3 flex items-center gap-3">
                    {/* Brand chip */}
                    <BankBadge
                      logoSrc={brand.logoSrc}
                      initials={brand.initials}
                      altText={brand.label}
                      brandBg={brand.background}
                    />

                    {/* Middle: name + APR pill */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                        {c.name}
                      </p>
                      {c.apr != null && (
                        <span className="inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 num">
                          {c.apr}% APR
                        </span>
                      )}
                    </div>

                    {/* Right: delta + balance owed */}
                    <div className="text-right flex-shrink-0">
                      {c.delta > 0 ? (
                        <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                          +{mask(fmtGBP(c.delta))}
                        </p>
                      ) : c.delta < 0 ? (
                        <p className="text-sm font-semibold money text-emerald-600 dark:text-emerald-400">
                          {/* Proper minus sign */}
                          −{mask(fmtGBP(c.delta))}
                        </p>
                      ) : (
                        <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                          £0
                        </p>
                      )}
                      {balanceCaption && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 num">
                          {/* Figure carries the colour, caption stays quiet
                              slate — matches AccountLedgerRow.tsx. */}
                          <span
                            className={`font-mono tabular-nums ${c.balance < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
                          >
                            {mask(`£${Math.round(balanceAbs).toLocaleString("en-GB")}`)}
                          </span>{" "}
                          {balanceCaption}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 4: WHAT DROVE IT ──────────────────────────────────────── */}
        {drivers.length > 0 && (
          <div className="rise-in" style={{ "--rise-index": 3 } as React.CSSProperties}>
            <Whisper>WHAT DROVE IT</Whisper>
            <div className="glass-card rounded-2xl mt-3 overflow-hidden">
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {drivers.map((d) => {
                  const colour = getCategoryColour(d.category, colours);
                  return (
                    <div key={d.category} className="px-4 py-3 flex items-center gap-3">
                      {/* Category colour chip */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${colour}26` }}
                      >
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: colour }}
                        />
                      </div>

                      {/* Category name */}
                      <p className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        {d.category}
                      </p>

                      {/* Total spend */}
                      <p className="text-sm font-semibold money text-slate-900 dark:text-slate-100">
                        {mask(fmtGBP(d.total))}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Pattern insight line */}
              {pattern_line && (
                <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/60">
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
                    {pattern_line}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section 5: THE TRAJECTORY ─────────────────────────────────────── */}
        <div className="rise-in" style={{ "--rise-index": 4 } as React.CSSProperties}>
          <Whisper>THE TRAJECTORY</Whisper>
          <div className="glass-card rounded-2xl p-4 mt-3">
            {trajSlice.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No closed cycles yet.
              </p>
            ) : (
              <>
                {/* Bar chart */}
                <div className="flex items-end gap-2 h-12">
                  {trajSlice.map((t, i) => {
                    const barH =
                      maxAbsDelta === 0
                        ? 4
                        : Math.max(4, Math.round((48 * Math.abs(t.delta)) / maxAbsDelta));
                    // delta > 0: balance grew (neutral slate); delta <= 0: shrank (emerald)
                    const barColour =
                      t.delta > 0
                        ? "bg-slate-400 dark:bg-slate-500"
                        : "bg-emerald-500";
                    return (
                      <div key={i} className="flex-1 flex flex-col items-stretch">
                        <div className="flex items-end flex-1">
                          <div
                            className={`flex-1 rounded-t ${barColour}`}
                            style={{ height: `${barH}px` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Labels */}
                <div className="flex gap-2 mt-1">
                  {trajSlice.map((t, i) => (
                    <p
                      key={i}
                      className="flex-1 text-[10px] text-slate-400 dark:text-slate-500 text-center"
                    >
                      {monthShort(t.period_end)}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
      <BottomNav />
    </div>
  );
}
