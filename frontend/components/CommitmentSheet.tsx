"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Check, CircleDashed } from "lucide-react";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { api, Account, Commitment, CommitmentPreview } from "@/lib/api";
import { usePreferences } from "@/components/PreferencesContext";
import { getPayPeriodWithConfig, nextPeriodWithConfig, periodRhythmLabel, PayPeriodConfig } from "@/lib/payPeriod";
import { useLockBodyScroll } from "@/lib/useLockBodyScroll";
import { useSheetA11y } from "@/lib/useSheetA11y";
import { useSheetOpen } from "@/lib/useSheetOpen";
import MoneyText from "@/components/MoneyText";

// Create/edit sheet for a commitment — a named future big expense (holiday,
// car, fees) the app reserves a per-period slice for. Mirrors the
// PlanOneOffSheet portal glass-sheet idiom; the pot selector is a MULTI-select
// over connected savings pots and offline (manually-updated) accounts, with a
// per-pot "count what's already here" choice made at link time. The
// "≈ £X/period" line is a live client-side estimate (hedged) — the backend
// derives the authoritative slice on save.

/** Multi-select check — the checkbox sibling of PlanOneOffSheet's RadioDot. */
function CheckDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex-shrink-0 w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center transition-colors ${
        selected ? "border-indigo-600 bg-indigo-600" : "border-slate-300 dark:border-slate-600"
      }`}
    >
      {selected && <Check size={12} strokeWidth={3} className="text-white" />}
    </span>
  );
}

/** The pot choice the sheet edits and PATCH/POST send. */
type PotSelection = { account_id: string; count_existing: boolean };

/** Selection currently stored on a commitment — funding_pots, or the legacy
 * single funding_account_id read as one growth-only pot. */
function potsFromCommitment(c: Commitment | null | undefined): PotSelection[] {
  if (!c) return [];
  if (c.funding_pots && c.funding_pots.length > 0) {
    return c.funding_pots.map((p) => ({
      account_id: p.account_id,
      count_existing: p.count_existing,
    }));
  }
  if (c.funding_account_id) {
    return [{ account_id: c.funding_account_id, count_existing: false }];
  }
  return [];
}

interface CommitmentSheetProps {
  /** Pass when the parent already has accounts; otherwise the sheet fetches its own. */
  accounts?: Account[];
  /** Edit mode when set. */
  commitment?: Commitment | null;
  /** Prefill for the Can-I hand-off (create mode only). */
  prefill?: { name: string; amount: number; target_date: string } | null;
  source?: "manual" | "can_i";
  onClose: () => void;
  onSaved?: (item: Commitment) => void;
  onCancelled?: () => void;
}

/** "YYYY-MM" for next calendar month — the earliest pickable target. */
function nextMonthYm(): string {
  const d = new Date();
  const m1 = d.getMonth() + 2; // 1-based next month, may be 13
  const y = d.getFullYear() + (m1 > 12 ? 1 : 0);
  const m = m1 > 12 ? 1 : m1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function ceil5(n: number): number {
  return Math.ceil(n / 5) * 5;
}

/**
 * Pay-period START days in [today, target month's first day] inclusive, min 1.
 * Mirrors the backend's _period_starts_between: the current period only counts
 * when its start date is today — on any mid-period day it is excluded.
 */
function periodsLeftFor(targetYm: string, config: PayPeriodConfig): number {
  if (!/^\d{4}-\d{2}$/.test(targetYm)) return 1;
  const [y, m] = targetYm.split("-").map(Number);
  const target = Date.UTC(y, m - 1, 1);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let [start, end] = getPayPeriodWithConfig(now, config);
  let count = 0;
  for (let i = 0; i < 60; i++) {
    if (start.getTime() > target) break;
    if (start.getTime() >= today) count++;
    [start, end] = nextPeriodWithConfig(end, config);
  }
  return Math.max(1, count);
}

export default function CommitmentSheet({
  accounts,
  commitment,
  prefill,
  source = "manual",
  onClose,
  onSaved,
  onCancelled,
}: CommitmentSheetProps) {
  useLockBodyScroll();
  useSheetOpen();
  const panelRef = useSheetA11y<HTMLDivElement>(onClose);
  const { payPeriodConfig } = usePreferences();
  const router = useRouter();
  const monthInputRef = useRef<HTMLInputElement>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [consentSnapshot, setConsentSnapshot] = useState<CommitmentPreview["consent"]>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Edit mode: a plan whose target month has arrived must stay editable —
  // floor at its stored month rather than next month.
  const existingMonth = commitment?.target_date ? commitment.target_date.slice(0, 7) : null;
  const nextMonth = nextMonthYm();
  const minMonth = existingMonth && existingMonth < nextMonth ? existingMonth : nextMonth;

  const [name, setName] = useState(commitment?.name ?? prefill?.name ?? "");
  const [amount, setAmount] = useState(() => {
    const a = commitment?.amount ?? prefill?.amount;
    return a != null ? String(Math.round(a * 100) / 100) : "";
  });
  const [month, setMonth] = useState(() => {
    const t = commitment?.target_date ?? prefill?.target_date;
    return t ? t.slice(0, 7) : minMonth;
  });
  const [pots, setPots] = useState<PotSelection[]>(() => potsFromCommitment(commitment));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Accounts — use the parent's list when given, otherwise self-fetch
  const [fetchedAccounts, setFetchedAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    if (accounts && accounts.length > 0) return;
    let cancelled = false;
    api.accounts()
      .then((a) => { if (!cancelled) setFetchedAccounts(a); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accounts]);
  const accountList = accounts && accounts.length > 0 ? accounts : (fetchedAccounts ?? []);

  // Pot options — connected savings pots (live balances, payday-plan legs)
  // plus offline manually-updated accounts (badged; never automated).
  // Credit cards are not pots.
  const connectedPots = accountList.filter(
    (acc) => !acc.manual && (acc.subtype || "").toLowerCase().includes("saving")
  );
  const offlinePots = accountList.filter(
    (acc) => acc.manual && (acc.subtype || "").toUpperCase() !== "CREDIT_CARD"
  );
  const potOptions = [...connectedPots, ...offlinePots];

  function togglePot(accountId: string) {
    setPots((prev) =>
      prev.some((p) => p.account_id === accountId)
        ? prev.filter((p) => p.account_id !== accountId)
        : [...prev, { account_id: accountId, count_existing: false }]
    );
  }
  function toggleCountExisting(accountId: string) {
    setPots((prev) =>
      prev.map((p) =>
        p.account_id === accountId ? { ...p, count_existing: !p.count_existing } : p
      )
    );
  }

  // Order-sensitive on purpose: the first connected pot receives the whole
  // payday-plan slice, so reordering is a real change.
  const potsChanged =
    JSON.stringify(pots) !== JSON.stringify(potsFromCommitment(commitment));

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""));
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const monthValid = /^\d{4}-\d{2}$/.test(month) && month >= minMonth;

  // Live feasibility verdict — debounced POST /commitments/preview as the
  // amount/month change. Failure-tolerant: any error just hides the line.
  const [preview, setPreview] = useState<CommitmentPreview | null>(null);
  useEffect(() => {
    if (!amountValid || !monthValid) {
      setPreview(null);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api.previewCommitment(parsedAmount, `${month}-01`, pots, commitment?.id)
        .then((p) => { if (!stale) setPreview(p); })
        .catch(() => { if (!stale) setPreview(null); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [amountValid, monthValid, parsedAmount, month, pots, commitment?.id]);

  // Live pot-ledger conflicts, keyed by account — an older goal may already
  // be drawing from a pot this draft also selects (see pots_detail).
  const potsDetailByAccount = new Map(
    (preview?.pots_detail ?? []).map((pd) => [pd.account_id, pd])
  );

  // Estimated progress for the live slice line. With the stored pot set,
  // trust the server's figure; otherwise sum what the draft selection would
  // contribute — a pot's whole balance when "count existing" is on (capped
  // at the ledger's free remainder when an older goal already claims part
  // of it — see potsDetailByAccount), its server-known contribution when
  // the link is unchanged, else zero (growth starts from link time).
  // Hedged — the backend derives the truth on save.
  const estimatedProgress = (() => {
    if (commitment && !potsChanged) return commitment.progress;
    const sum = pots.reduce((acc, p) => {
      const existing = commitment?.funding_pots?.find(
        (fp) => fp.account_id === p.account_id
      );
      if (existing && existing.count_existing === p.count_existing) {
        return acc + existing.contributing_balance;
      }
      if (p.count_existing) {
        const bal = accountList.find((a) => a.id === p.account_id)?.balance ?? 0;
        const detail = potsDetailByAccount.get(p.account_id);
        const cap = detail && detail.also_funding.length > 0 ? detail.free : bal;
        return acc + Math.max(0, Math.min(bal, cap));
      }
      return acc;
    }, 0);
    return amountValid ? Math.min(parsedAmount, sum) : sum;
  })();

  // Live "≈ £X/period" estimate — remaining over pay periods left, ceiled to £5
  const periods = monthValid ? periodsLeftFor(month, payPeriodConfig) : null;
  const periodLabel = periodRhythmLabel(payPeriodConfig);
  const remaining = amountValid
    ? Math.max(0, parsedAmount - estimatedProgress)
    : null;
  const slice =
    periods != null && remaining != null && remaining > 0
      ? ceil5(remaining / periods)
      : null;

  // Feasibility shown — with the stored pot set, trust the server's verdict
  // (it knows accrued growth the preview can't see), mirroring how
  // estimatedProgress trusts commitment.progress in the same branch.
  const feasibility =
    commitment && !potsChanged ? commitment.feasibility : preview?.feasibility;
  const feasibilityNote =
    commitment && !potsChanged
      ? commitment.feasibility_note
      : preview?.feasibility_note;
  const feasibilityTone =
    commitment && !potsChanged ? commitment.feasibility_tone : preview?.feasibility_tone;
  const feasibilityCaution = feasibilityTone ? feasibilityTone === "caution" : feasibility === "stretch";

  async function doSave() {
    setSaving(true);
    setSaveError(false);
    const target_date = `${month}-01`;
    try {
      let item: Commitment;
      if (commitment) {
        const body: Parameters<typeof api.updateCommitment>[1] = {
          name: name.trim(),
          amount: parsedAmount,
        };
        // Only send the date when it changed — the backend rejects a
        // target_date in the past even when it is the stored one, which
        // would lock editing once a plan's month arrives.
        if (target_date !== commitment.target_date.slice(0, 10)) {
          body.target_date = target_date;
        }
        // Only send the pots when they changed — a PATCH re-captures the
        // baselines, which would wipe progress on a no-op save.
        if (potsChanged) {
          body.funding_pots = pots;
        }
        item = await api.updateCommitment(commitment.id, body);
      } else {
        item = await api.createCommitment({
          name: name.trim(),
          amount: parsedAmount,
          target_date,
          funding_pots: pots,
          source,
        });
      }
      onSaved?.(item);
      onClose();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !amountValid || !monthValid || saving) return;
    // Consent gate applies only on CREATE, never when editing an existing
    // plan — an edit's own preview already excludes the plan's prior self
    // from "others" (commitment_id is sent), and the user already made this
    // call once when they first created it. Never gate on a missing/failed
    // preview — proceed straight to save.
    if (!commitment && preview?.consent?.required && !showConsent) {
      setConsentSnapshot(preview.consent);
      setShowConsent(true);
      return;
    }
    doSave();
  }

  async function handleCancelCommitment() {
    if (!commitment || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await api.cancelCommitment(commitment.id);
      onCancelled?.();
      onClose();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const canSave = !saving && name.trim().length > 0 && amountValid && monthValid;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-[65] fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={commitment ? "Edit plan" : "Plan a big expense"}
        className="fixed inset-x-0 bottom-0 z-[70]"
        style={reduceMotion ? undefined : { animation: "slideUpSheet 280ms cubic-bezier(0.32, 0.72, 0, 1) both" }}
      >
        <div
          className="mx-auto w-full max-w-[500px] glass-sheet rounded-t-3xl flex flex-col"
          style={{ maxHeight: "85dvh" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-2 pb-3 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {commitment ? "Edit plan" : "Plan a big expense"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A goal you set money aside for, separate from single bills.
              </p>
            </div>
            <button
              onClick={() => (showConsent ? setShowConsent(false) : onClose())}
              aria-label="Close"
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2 active:bg-slate-200 dark:active:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <X size={15} />
            </button>
          </div>

          {/* Scrollable content */}
          <div
            className="overflow-y-auto flex-1 px-5 space-y-3"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {showConsent && consentSnapshot ? (
              <div className="space-y-4">
                <p className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug">
                  {consentSnapshot.title}
                </p>
                <div className="space-y-2">
                  {consentSnapshot.lines.map((line, i) => (
                    <p key={i} className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {line}
                    </p>
                  ))}
                </div>
                {saveError && (
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">
                    That didn&apos;t save. Try again.
                  </p>
                )}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={doSave}
                    className="w-full min-h-[44px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    {saving ? "Saving…" : consentSnapshot.actions.anyway}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setShowConsent(false);
                      setTimeout(() => monthInputRef.current?.focus(), 0);
                    }}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-semibold active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {consentSnapshot.actions.later_date}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      onClose();
                      router.push("/debt-plan");
                    }}
                    className="w-full min-h-[44px] text-sm font-semibold text-indigo-600 dark:text-indigo-400 rounded-xl hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {consentSnapshot.actions.debt_first}
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setSaveError(false); }}
                  placeholder="Summer holiday"
                  maxLength={40}
                  required
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Total amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setSaveError(false); }}
                    placeholder="0.00"
                    required
                    className="w-full min-h-[48px] pl-7 pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm text-left tabular-nums"
                  />
                </div>
              </div>

              {/* Target month */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  By when
                </label>
                <input
                  ref={monthInputRef}
                  type="month"
                  value={month}
                  min={minMonth}
                  onChange={(e) => { setMonth(e.target.value); setSaveError(false); }}
                  required
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm appearance-none text-left [&::-webkit-date-and-time-value]:text-left"
                />
              </div>

              {/* Funding pots (optional, multi) — connected savings pots plus
                  offline manually-updated accounts. Offline pots are badged
                  and never receive automated payday-plan legs. */}
              {potOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Fund it from savings pots?
                  </label>
                  <div
                    role="group"
                    aria-label="Fund it from savings pots?"
                    className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
                  >
                    {/* "No pot" — first row, clears the selection */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={pots.length === 0}
                      onClick={() => setPots([])}
                      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                    >
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex-shrink-0">
                        <CircleDashed size={16} className="text-slate-400 dark:text-slate-500" />
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">No pot, track it by hand</span>
                      <CheckDot selected={pots.length === 0} />
                    </button>

                    {potOptions.map((acc) => {
                      const brand = accountBrand(acc);
                      const sel = pots.find((p) => p.account_id === acc.id);
                      const balance = Math.max(0, acc.balance ?? 0);
                      // Live pot-ledger conflict — an older goal is already
                      // drawing from this pot, so what's actually free is
                      // less than the raw balance.
                      const detail = potsDetailByAccount.get(acc.id);
                      const hasConflict = !!(sel && detail && detail.also_funding.length > 0);
                      const chipBalance = hasConflict ? detail!.free : balance;
                      return (
                        <div key={acc.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={!!sel}
                            onClick={() => togglePot(acc.id)}
                            className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                          >
                            <BankBadge
                              logoSrc={brand.logoSrc}
                              initials={brand.initials}
                              altText={brand.label}
                              brandBg={brand.background}
                            />
                            <span className="flex-1 min-w-0">
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{acc.name}</span>
                                {acc.manual && (
                                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/[0.08] text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                    offline, updated by you
                                  </span>
                                )}
                              </span>
                              {acc.provider && !acc.manual && (
                                <span className="block text-xs text-slate-400 dark:text-slate-500 truncate">{acc.provider}</span>
                              )}
                            </span>
                            <CheckDot selected={!!sel} />
                          </button>
                          {/* Per-pot choice, made at link time: count the
                              balance already in the pot, or only its growth
                              from today (default). */}
                          {sel && (
                            <div className="pl-[60px] pr-3 pb-2">
                              <button
                                type="button"
                                aria-pressed={sel.count_existing}
                                onClick={() => toggleCountExisting(acc.id)}
                                className="min-h-[44px] -my-2 flex items-center active:scale-95 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-full"
                              >
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                                    sel.count_existing
                                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/60"
                                      : "bg-slate-100/80 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 border-transparent"
                                  }`}
                                >
                                  {sel.count_existing && (
                                    <Check size={11} strokeWidth={3} aria-hidden="true" />
                                  )}
                                  <MoneyText text={`count the £${Math.round(chipBalance).toLocaleString("en-GB")} already here`} />
                                </span>
                              </button>
                              {/* Non-blocking — information, not attention. An
                                  older goal keeps first claim on a shared pot. */}
                              {hasConflict && (
                                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                                  <MoneyText
                                    text={`Also funding ${detail!.also_funding.map((f) => f.name).join(", ")}, £${Math.round(
                                      detail!.also_funding.reduce((sum, f) => sum + f.amount, 0)
                                    ).toLocaleString("en-GB")} spoken for · £${Math.round(detail!.free).toLocaleString("en-GB")} free`}
                                  />
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    Pick pots and progress tracks their growth from today, offline pots you update yourself.
                  </p>
                </div>
              )}

              {/* Live per-period estimate — hedged, backend derives the real slice */}
              {slice != null && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 num" aria-live="polite">
                  <MoneyText text={`≈ £${slice.toLocaleString("en-GB")} ${periodLabel ? `each pay period (${periodLabel})` : "a period"} · ${periods} ${periods === 1 ? "period" : "periods"}`} />
                </p>
              )}

              {/* Feasibility verdict — slate text always; amber dot signifier
                  when feasibility needs attention (savings or stretch), never red. */}
              {slice != null && feasibility && feasibilityNote && (
                <p
                  className="text-[13px] leading-snug text-slate-500 dark:text-slate-400"
                  aria-live="polite"
                >
                  {feasibilityCaution && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 align-middle"
                      aria-hidden="true"
                    />
                  )}
                  {feasibilityNote}
                </p>
              )}

              {/* Error — quiet, per the AimSheet idiom */}
              {saveError && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  That didn&apos;t save. Try again.
                </p>
              )}

              {/* Save / Cancel */}
              <button
                type="submit"
                disabled={!canSave}
                className="w-full min-h-[48px] rounded-xl bg-indigo-600 text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                {saving ? "Saving…" : commitment ? "Save changes" : "Save plan"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="w-full min-h-[44px] text-sm font-semibold text-slate-500 dark:text-slate-400 rounded-xl hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Cancel
              </button>

              {/* Cancel-commitment — edit mode only, quiet two-step confirm */}
              {commitment && !confirmingCancel && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmingCancel(true)}
                  className="w-full min-h-[44px] text-[13px] font-medium text-slate-400 dark:text-slate-500 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                >
                  Cancel this plan
                </button>
              )}
              {commitment && confirmingCancel && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3 space-y-2">
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                    Stop reserving for this? Money already set aside stays where it is.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleCancelCommitment}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-slate-600 active:scale-95 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {saving ? "Cancelling…" : "Yes, cancel it"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmingCancel(false)}
                      className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </form>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
