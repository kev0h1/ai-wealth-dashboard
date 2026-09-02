"use client";
import { useEffect, useState } from "react";
import { RadioDot } from "@/components/PlanOneOffSheet";
import { AccountRadioPicker as SharedAccountRadioPicker } from "@/components/AccountRadioPicker";
import { api, Account, FillCandidate } from "@/lib/api";

// Shared field components for an envelope (Allocation) — used by both
// SetAsideSheet.tsx (create, step 2 of the "An envelope" path) and
// AllocationSheet.tsx (edit). Extracted so the two never carry divergent
// copies of the same fields (owner instruction, 2026-08-29 consolidation).
//
// Rule fields (match_type/match_value) mirror the offline-account rule
// sheet's own convention exactly (AccountsPage.tsx's manual-account rule
// modal): "Exactly this" / "Contains this" wording, same grid-cols-2 pill
// toggle, same idea of a curated pick-list with a manual fallback — see
// AccountsPage.tsx's `ruleMatchType`/"Strictness picker" section, which
// this deliberately echoes rather than inventing new copy.

export type AllocationMatchType = "description_equals" | "description_contains";
export type AllocationRhythm = "every_period" | "once";

// ── Rhythm — "How often?" ─────────────────────────────────────────────────
// Byte-identical markup to the shipped AllocationSheet.tsx control (and to
// shared.tsx's design-review RhythmToggle) — extracted here so both create
// and edit read the exact same component rather than two copies drifting.
export function RhythmToggle({
  value,
  onChange,
}: {
  value: AllocationRhythm;
  onChange: (v: AllocationRhythm) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        How often?
      </label>
      <div role="radiogroup" aria-label="How often?" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === "every_period"}
          onClick={() => onChange("every_period")}
          className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            value === "every_period"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          Every pay period
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "once"}
          onClick={() => onChange("once")}
          className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            value === "once"
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          Just this period
        </button>
      </div>
      {value === "once" && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
          Applies to this pay period only, then it&apos;s done.
        </p>
      )}
    </div>
  );
}

// ── Account picker — "Which account?" ──────────────────────────────────────
// Own accounts, savings-kind first (matches CommitmentSheet's connected-then-
// offline ordering); single-select, every own account offerable.
export function AccountRadioPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
}) {
  return (
    <SharedAccountRadioPicker
      accounts={accounts}
      value={value}
      onChange={onChange}
      helperText="Only one active allocation can fill from the same payment."
    />
  );
}

export type FillRuleValue = {
  match_type: AllocationMatchType;
  match_value: string;
  fill_display_name: string;
};

// ── Fill rule — "Which payment fills it?" ──────────────────────────────────
// Same rule the offline account uses: exact match or contains (owner,
// 2026-08-29: "the same rule we have for the offline account is what we
// should reuse here, can be exact match or contains"). Two modes: a curated
// prefill list from GET /allocations/fill-candidates (tapping one sets
// match_type=contains, match_value/fill_display_name=its display name), or
// manual entry (free text + the "Exactly this"/"Contains this" toggle,
// wording matched to AccountsPage.tsx's manual-account rule sheet so the
// two rule-building surfaces read as one convention, not two).
export function FillRulePicker({
  accountId,
  value,
  onChange,
}: {
  accountId: string;
  value: FillRuleValue;
  onChange: (v: FillRuleValue) => void;
}) {
  const [candidates, setCandidates] = useState<FillCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Manual mode is entered explicitly ("Type it in myself"), or implied on
  // load when the current value doesn't match any candidate (edit mode with
  // a hand-typed rule, or an account with nothing to prefill from).
  const [manual, setManual] = useState(() => value.match_value.trim().length > 0);

  useEffect(() => {
    if (!accountId) { setCandidates(null); return; }
    let cancelled = false;
    setCandidates(null);
    setError(false);
    setLoading(true);
    api.allocationFillCandidates(accountId)
      .then((items) => { if (!cancelled) setCandidates(items); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  // Once candidates load, a value that cleanly matches one of them reads
  // best in prefill mode (its row shows selected); anything else (hand-
  // typed text, or no candidates at all) stays/becomes manual.
  useEffect(() => {
    if (!candidates) return;
    const matchesCandidate = candidates.some((c) => c.display_name === value.match_value);
    if (matchesCandidate && value.match_type === "description_contains") {
      setManual(false);
    } else if (value.match_value.trim().length > 0) {
      setManual(true);
    } else if (candidates.length === 0) {
      setManual(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        Which payment fills it?
      </label>

      {!manual && (
        <>
          {loading && (
            <p className="text-[13px] text-slate-400 dark:text-slate-500 px-1 py-2">Loading recent payments…</p>
          )}
          {!loading && error && (
            <p className="text-[13px] text-rose-600 dark:text-rose-400 px-1 py-2">
              Couldn&apos;t load recent payments for this account.
            </p>
          )}
          {!loading && !error && candidates && candidates.length > 0 && (
            <div
              role="radiogroup"
              aria-label="Which payment fills it?"
              className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
            >
              {candidates.map((c) => (
                <button
                  key={c.series_key}
                  type="button"
                  role="radio"
                  aria-checked={value.match_value === c.display_name && value.match_type === "description_contains"}
                  onClick={() => onChange({ match_type: "description_contains", match_value: c.display_name, fill_display_name: c.display_name })}
                  className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{c.display_name}</span>
                    <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">
                      £{c.last_amount.toFixed(2)} · {c.occurrences_90d} {c.occurrences_90d === 1 ? "time" : "times"} in 90 days
                    </span>
                  </span>
                  <RadioDot selected={value.match_value === c.display_name && value.match_type === "description_contains"} />
                </button>
              ))}
            </div>
          )}
          {!loading && !error && candidates && candidates.length === 0 && (
            <p className="text-[13px] text-slate-400 dark:text-slate-500 px-1 py-2">
              No money has come into this account in the last 90 days.
            </p>
          )}
          <button
            type="button"
            onClick={() => setManual(true)}
            className="mt-1.5 min-h-[44px] flex items-center px-1 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
          >
            Type it in myself
          </button>
        </>
      )}

      {manual && (
        <div className="space-y-2">
          <input
            type="text"
            value={value.match_value}
            onChange={(e) => onChange({ ...value, match_value: e.target.value, fill_display_name: e.target.value })}
            placeholder="e.g. Saving Challenge"
            maxLength={80}
            className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
          />
          <div role="radiogroup" aria-label="How strictly should this rule match?" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={value.match_type === "description_equals"}
              onClick={() => onChange({ ...value, match_type: "description_equals" })}
              className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                value.match_type === "description_equals"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              }`}
            >
              Exactly this
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.match_type === "description_contains"}
              onClick={() => onChange({ ...value, match_type: "description_contains" })}
              className={`min-h-[44px] px-3 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                value.match_type === "description_contains"
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
              }`}
            >
              Contains this
            </button>
          </div>
          {candidates && candidates.length > 0 && (
            <button
              type="button"
              onClick={() => setManual(false)}
              className="min-h-[44px] flex items-center px-1 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
            >
              Pick from recent payments instead
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
        Only payments matching this count toward the envelope, not everything landing in the account.
      </p>
    </div>
  );
}

// ── Effective date — "When does this start?" ────────────────────────────────
// Defaults to the start of the current pay period (sends nothing — the
// backend's own default). Owner, 2026-08-29: "the effective date can be
// selected or choose the start of the payment period." `value` is the ISO
// override date, or null for the default chip.
export function EffectiveDateField({
  value,
  periodStartLabel,
  todayIso,
  onChange,
}: {
  value: string | null;
  periodStartLabel: string;
  todayIso: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
        When does this start?
      </label>
      <div role="radiogroup" aria-label="When does this start?" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          className={`min-h-[44px] px-3 py-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            value === null
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          Start of this pay period
          <span className="block text-[10px] font-normal opacity-80">{periodStartLabel}</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value !== null}
          onClick={() => onChange(value ?? todayIso)}
          className={`min-h-[44px] px-3 py-1.5 rounded-xl border text-sm font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            value !== null
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
              : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
          }`}
        >
          From a date I choose
        </button>
      </div>
      {value !== null && (
        <input
          type="date"
          value={value}
          min={todayIso}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
        />
      )}
    </div>
  );
}
