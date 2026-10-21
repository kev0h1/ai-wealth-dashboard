"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleDashed, Pencil } from "lucide-react";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";
import { api, Account, Commitment, CommitmentPreview, PlanFillCandidates } from "@/lib/api";
import { FillRulePicker, type FillRuleValue } from "@/components/AllocationFields";
import { usePreferences } from "@/components/PreferencesContext";
import { getPayPeriodWithConfig, nextPeriodWithConfig, periodRhythmLabel, PayPeriodConfig } from "@/lib/payPeriod";
import MoneyText from "@/components/MoneyText";
import { invalidateVerdictCache } from "@/lib/verdictCache";
import { SheetFrame } from "@/components/SheetFrame";
import { DateField } from "@/components/DatePicker";
import { PlanAffordability, PlanContribution, PlanRouteSummary, PlanTrackingSummary } from "@/components/plans/PlanEditorSummary";
import { tidyAccountName } from "@/lib/accountName";
import { PlanCategoryTracking, type PlanCategoryTrackingValue } from "@/components/plans/PlanCategoryTracking";
import { PlanRecordView } from "@/components/plans/PlanRecordView";
import { useCategories } from "@/components/CategoriesContext";
import { PlanTrackingMethod } from "@/components/plans/PlanTrackingMethod";

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
  /** Injectable only for deterministic auth-free component fixtures. */
  operations?: CommitmentSheetOperations;
  initialMode?: "view" | "edit";
}

/** The existing Commitment API surface, kept injectable for real component
 * fixtures without changing production behaviour. */
export type CommitmentSheetOperations = Pick<typeof api,
  "accounts" | "previewCommitment" | "createCommitment" | "updateCommitment" | "cancelCommitment">
  & Partial<Pick<typeof api, "planFillCandidates">>;

/** "1 Oct" from an ISO date. */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : "";
}

const EMPTY_RULE: FillRuleValue = { match_type: "description_contains", match_value: "", fill_display_name: "" };

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
  operations = api,
  initialMode = "edit",
}: CommitmentSheetProps) {
  const { payPeriodConfig } = usePreferences();
  const { allCategories } = useCategories();
  const router = useRouter();
  const monthInputRef = useRef<HTMLButtonElement>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [consentSnapshot, setConsentSnapshot] = useState<CommitmentPreview["consent"]>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { queueMicrotask(() => setMounted(true)); }, []);

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
  // G230 "Paid from": prefilled with the stored or inferred paying account.
  // A displayed suggestion is persisted only by the final confirmation.
  const [sourceId, setSourceId] = useState<string>(commitment?.source_account_id ?? "");
  const [sourceTouched, setSourceTouched] = useState(false);
  // G256: the payment that fulfils each period's contribution, same rule shape
  // and picker as a set-aside. A suggestion from the user's transfers is only
  // prefilled; nothing is saved until the user picks it (or any rule).
  const [rule, setRule] = useState<FillRuleValue>(() =>
    commitment?.fill_rule
      ? { ...commitment.fill_rule, fill_display_name: commitment.fill_rule.match_value }
      : EMPTY_RULE);
  const [ruleTouched, setRuleTouched] = useState(false);
  const [paymentPickerOpen, setPaymentPickerOpen] = useState(Boolean(commitment?.fill_rule));
  const [categoryTracking, setCategoryTracking] = useState<PlanCategoryTrackingValue>(() => (commitment as (Commitment & { category_tracking?: PlanCategoryTrackingValue }) | undefined)?.category_tracking ?? null);
  const [suggestion, setSuggestion] = useState<PlanFillCandidates["suggestion"]>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [viewing, setViewing] = useState(Boolean(commitment && initialMode === "view"));
  const [createNameStep, setCreateNameStep] = useState(!commitment);
  const [reviewEditing, setReviewEditing] = useState(false);
  const [sheetHistoryGeneration, setSheetHistoryGeneration] = useState(0);
  // A newly created goal is a short guided journey. Existing plans keep the
  // established summary and subview editor so their edit contract is stable.
  const [editorView, setEditorView] = useState<"main" | "details" | "route" | "destination" | "tracking">(commitment ? "main" : "details");
  const summaryFocus = useRef<HTMLButtonElement>(null);
  const routeFocus = useRef<HTMLButtonElement>(null);
  const trackingFocus = useRef<HTMLButtonElement>(null);
  const destinationFocus = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<"details" | "route" | "destination" | "tracking">("details");
  const returnToSummary = () => { setEditorView("main"); requestAnimationFrame(() => { const targets = { details: summaryFocus, route: routeFocus, destination: destinationFocus, tracking: trackingFocus }; targets[returnFocus.current].current?.focus(); }); };
  const returnToSavedView = () => {
    if (!commitment) return;
    setName(commitment.name);
    setAmount(String(Math.round(commitment.amount * 100) / 100));
    setMonth(commitment.target_date.slice(0, 7));
    setPots(potsFromCommitment(commitment));
    setSourceId(commitment.source_account_id ?? "");
    setSourceTouched(false);
    setRule(commitment.fill_rule ? { ...commitment.fill_rule, fill_display_name: commitment.fill_rule.match_value } : EMPTY_RULE);
    setRuleTouched(false);
    setPaymentPickerOpen(Boolean(commitment.fill_rule));
    setCategoryTracking((commitment as Commitment & { category_tracking?: PlanCategoryTrackingValue }).category_tracking ?? null);
    setEditorView("main");
    setViewing(true);
  };
  const createPrevious = () => {
    if (reviewEditing) { setReviewEditing(false); setCreateNameStep(false); setEditorView("main"); return; }
    if (!commitment && editorView === "details" && !createNameStep) {
      setCreateNameStep(true);
      return;
    }
    const previous = { details: null, route: "details", destination: "route", tracking: "destination", main: "tracking" } as const;
    const next = previous[editorView];
    if (next) setEditorView(next);
  };
  const createNext = () => {
    if (reviewEditing) { setReviewEditing(false); setCreateNameStep(false); setEditorView("main"); return; }
    if (!commitment && createNameStep) {
      setCreateNameStep(false);
      return;
    }
    const next = { details: "route", route: "destination", destination: "tracking", tracking: "main", main: "main" } as const;
    setEditorView(next[editorView]);
  };
  const allowConsentCloseRef = useRef(false);

  // Accounts — use the parent's list when given, otherwise self-fetch
  const [fetchedAccounts, setFetchedAccounts] = useState<Account[] | null>(null);
  useEffect(() => {
    if (accounts && accounts.length > 0) return;
    let cancelled = false;
    operations.accounts()
      .then((a) => { if (!cancelled) setFetchedAccounts(a); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accounts, operations]);
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
  const potOptions = [...connectedPots, ...offlinePots].filter(account => account.id !== sourceId && (account.currency || (account.manual ? "GBP" : "")).toUpperCase() === "GBP");

  // G230: counted current accounts only. Cards, savings pots, accounts left
  // out of Safe to Spend and the plan's own pots are never offered.
  const sourceOptions = accountList.filter((acc) => {
    const kind = `${acc.type} ${acc.subtype ?? ""}`.toLowerCase();
    return isPlanSourceAccount(acc)
      && acc.include_in_safe_to_spend !== false
      && !/saving|isa/.test(kind)
      && !pots.some((p) => p.account_id === acc.id);
  });
  const sourceInferred = Boolean(commitment?.source_inferred) && !sourceTouched && sourceId !== "";

  // G256: candidates are payments leaving the chosen paying account; the
  // suggestion rides along from the same call.
  const potKey = pots.map((p) => p.account_id).join(",");
  const loadFillCandidates = useCallback(
    (accountId: string) =>
      (operations.planFillCandidates ?? api.planFillCandidates)(accountId, potKey ? potKey.split(",") : [])
        .then((r) => {
          // The suggestion is always a row the user can tap, unselected until they do.
          const s = r.suggestion;
          const has = s && r.items.some((c) => c.display_name === s.match_value);
          return s && !has
            ? [{ series_key: "suggested", display_name: s.match_value, last_amount: s.last_amount, last_date: s.last_date, occurrences_90d: s.occurrences_90d }, ...r.items]
            : r.items;
        }),
    [operations, potKey],
  );
  // Offered, never preselected: nothing is chosen until the user taps a row.
  const suggestedActive = Boolean(suggestion && !ruleTouched && !commitment?.fill_rule);
  const fulfilment = commitment?.fill_rule && !ruleTouched && sourceId === commitment.source_account_id ? commitment.fulfilment ?? null : null;

  function togglePot(accountId: string) {
    setSuggestion(null);
    setRule(EMPTY_RULE);
    // Category evidence is scoped to this route. A changed pot needs a fresh
    // choice rather than silently carrying a category to another account.
    setCategoryTracking(null);
    setRuleTouched(true);
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

  const parsedAmount = Number(amount.trim());
  const amountValid = /^\d+(?:\.\d{1,2})?$/.test(amount.trim()) && Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000;
  const monthValid = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && month >= minMonth;

  // Live feasibility verdict — debounced POST /commitments/preview as the
  // amount/month change. Failure-tolerant: any error just hides the line.
  const [preview, setPreview] = useState<CommitmentPreview | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const previewKey = JSON.stringify([parsedAmount, month, pots, commitment?.id]);
  const activePreview = previewFor === previewKey ? preview : null;
  useEffect(() => {
    if (!amountValid || !monthValid) {
      queueMicrotask(() => setPreview(null));
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      operations.previewCommitment(parsedAmount, `${month}-01`, pots, commitment?.id)
        .then((p) => { if (!stale) { setPreview(p); setPreviewFor(previewKey); } })
        .catch(() => { if (!stale) setPreview(null); });
    }, 400);
    return () => { stale = true; clearTimeout(timer); };
  }, [amountValid, monthValid, parsedAmount, month, pots, commitment?.id, operations, previewKey]);

  // Live pot-ledger conflicts, keyed by account — an older goal may already
  // be drawing from a pot this draft also selects (see pots_detail).
  const potsDetailByAccount = new Map(
    (activePreview?.pots_detail ?? []).map((pd) => [pd.account_id, pd])
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
    if (activePreview?.starting_progress != null) return Math.min(parsedAmount, activePreview.starting_progress);
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
        const cap = detail?.free ?? 0;
        return acc + Math.max(0, Math.min(bal, cap));
      }
      return acc;
    }, 0);
    return amountValid ? Math.min(parsedAmount, sum) : sum;
  })();

  // Live "≈ £X/period" estimate — remaining over pay periods left, ceiled to £5
  const periods = monthValid ? periodsLeftFor(month, payPeriodConfig) : null;
  const periodLabel = periodRhythmLabel(payPeriodConfig);
  const contributionCadence = periodLabel === "monthly" ? "each month" : periodLabel === "weekly" ? "each week" : periodLabel?.startsWith("every ") ? periodLabel : "each pay period";
  const remaining = amountValid
    ? Math.max(0, parsedAmount - estimatedProgress)
    : null;
  const slice = periods != null && remaining != null ? ceil5(remaining / periods) : null;

  // Load a single sensible suggestion before showing the summary, rather
  // than making users open the raw picker to discover it. Never apply a
  // stale response after changing the source or the savings pots.
  useEffect(() => {
    let stale = false;
    if (!sourceId || !potKey) return;
    (operations.planFillCandidates ?? api.planFillCandidates)(sourceId, potKey.split(","))
      .then(result => {
        if (stale) return;
        setSuggestion(result.suggestion);
        if (!ruleTouched && !commitment?.fill_rule && result.suggestion) {
          setRule({ ...result.suggestion, fill_display_name: "Suggested transfer" });
          setPaymentPickerOpen(true);
        }
      }).catch(() => { /* Manual reference and check-yourself remain available. */ });
    return () => { stale = true; };
  }, [sourceId, potKey, operations, commitment?.fill_rule, ruleTouched]);

  // Feasibility shown — with the stored pot set, trust the server's verdict
  // (it knows accrued growth the preview can't see), mirroring how
  // estimatedProgress trusts commitment.progress in the same branch.
  const unchangedFinancials = commitment && !potsChanged && parsedAmount === commitment.amount && month === commitment.target_date.slice(0, 7);
  const summarySlice = unchangedFinancials
    ? fulfilment ? fulfilment.expected_pence / 100 : commitment.usual_slice ?? commitment.per_period_slice
    : activePreview?.per_period_slice ?? slice;
  const feasibility =
    unchangedFinancials ? commitment.feasibility : activePreview?.feasibility;
  const feasibilityNote =
    unchangedFinancials
      ? commitment.feasibility_note
      : activePreview?.feasibility_note;
  const feasibilityTone =
    unchangedFinancials ? commitment.feasibility_tone : activePreview?.feasibility_tone;
  const feasibilityCaution = feasibilityTone ? feasibilityTone === "caution" : feasibility === "stretch";

  async function doSave(close: () => void) {
    setSaving(true);
    setSaveError(false);
    const target_date = `${month}-01`;
    // G256: a rule needs a paying account to read; "Not set" or an emptied rule sends null.
    const ruleBody = !categoryTracking && sourceId && rule.match_value.trim()
      ? { match_type: rule.match_type, match_value: rule.match_value.trim() }
      : null;
    try {
      let item: Commitment;
      if (commitment) {
        const body: Parameters<CommitmentSheetOperations["updateCommitment"]>[1] = {
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
        if (sourceTouched || sourceInferred) { body.source_account_id = sourceId || null; body.source_unset = !sourceId; }
        if (ruleTouched || suggestedActive || (sourceTouched && !sourceId) || categoryTracking) body.fill_rule = ruleBody;
        (body as typeof body & { category_tracking?: PlanCategoryTrackingValue }).category_tracking = categoryTracking ? { category: categoryTracking.category } : null;
        item = await operations.updateCommitment(commitment.id, body);
      } else {
        item = await operations.createCommitment({
          name: name.trim(),
          amount: parsedAmount,
          target_date,
          funding_pots: pots,
          source,
          source_account_id: sourceId,
          source_unset: false,
          ...(ruleTouched || suggestedActive || categoryTracking ? { fill_rule: ruleBody } : {}),
          ...(categoryTracking ? { category_tracking: { category: categoryTracking.category } } : {}),
        });
      }
      // G83 fix-round: a commitment create/edit can change the goal-name
      // labels /spend/verdict's "money you moved to your pots" line reads
      // off commitments_col (see spend_verdict.py's own module docstring)
      // — the backend already response_cache.invalidate()s on this write.
      invalidateVerdictCache();
      onSaved?.(item);
      close();
    } catch {
      // A failed consent save must restore the ordinary consent dismissal
      // contract. Otherwise the next X/Back would be mistaken for the
      // successful programmatic close this attempt had prepared.
      allowConsentCloseRef.current = false;
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    if (!commitment && editorView !== "main") return;
    if (!name.trim() || !amountValid || !monthValid || saving || !trackingValid || !sourceOptions.some(account => account.id === sourceId)) return;
    // Consent gate applies only on CREATE, never when editing an existing
    // plan — an edit's own preview already excludes the plan's prior self
    // from "others" (commitment_id is sent), and the user already made this
    // call once when they first created it. Never gate on a missing/failed
    // preview — proceed straight to save.
    if (!commitment && activePreview?.consent?.required && !showConsent) {
      setConsentSnapshot(activePreview.consent);
      setShowConsent(true);
      return;
    }
    void doSave(close);
  }

  async function handleCancelCommitment(close: () => void) {
    if (!commitment || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await operations.cancelCommitment(commitment.id);
      invalidateVerdictCache();
      onCancelled?.();
      close();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function setPaused(close: () => void, paused: boolean) {
    if (!commitment || saving) return;
    setSaving(true); setSaveError(false);
    try {
      const item = await operations.updateCommitment(commitment.id, { paused } as Parameters<CommitmentSheetOperations["updateCommitment"]>[1] & { paused: boolean });
      invalidateVerdictCache(); onSaved?.(item); close();
    } catch { setSaveError(true); } finally { setSaving(false); }
  }

  if (!mounted) return null;

  // A plan must name the account its contribution leaves. This remains an
  // explicit confirmation even when the backend inferred a likely source.
  const trackingValid = Boolean(categoryTracking) || !paymentPickerOpen || Boolean(rule.match_value.trim());
  const canSave = !saving && name.trim().length > 0 && amountValid && monthValid && trackingValid && sourceOptions.some(account => account.id === sourceId);
  const returnToDraft = () => {
    setShowConsent(false);
    setEditorView("details");
    setTimeout(() => monthInputRef.current?.focus(), 0);
  };
  const returnToDraftAfterHistory = () => {
    returnToDraft();
    // X and browser Back consume SheetFrame's entry before calling onClose.
    // Remount its history hook with the preserved draft, so the next close
    // still owns an entry rather than navigating out of the parent sheet.
    setSheetHistoryGeneration(generation => generation + 1);
  };
  const handleSheetClose = () => {
    if (showConsent && !allowConsentCloseRef.current) {
      returnToDraftAfterHistory();
      return;
    }
    allowConsentCloseRef.current = false;
    onClose();
  };
  const closeConsentThen = (closeThen: (next: () => void) => void, next: () => void) => {
    allowConsentCloseRef.current = true;
    closeThen(next);
  };
  const saveFromConsent = (close: () => void) => {
    allowConsentCloseRef.current = true;
    void doSave(close);
  };

  return (
    <SheetFrame
      key={sheetHistoryGeneration}
      title={commitment ? viewing ? commitment.name : "Edit plan" : editorView === "main" ? "Check your plan" : createNameStep ? "What is this for?" : editorView === "details" ? "How much do you want to save?" : editorView === "route" ? "Which account pays for it?" : editorView === "destination" ? "Where will you save it?" : "How should we track this?"}
      description={commitment ? viewing ? "Your goal" : "A goal you set money aside for, separate from single bills." : editorView === "main" ? "Review your goal before saving." : `Step ${createNameStep ? 1 : (["details", "route", "destination", "tracking"] as const).indexOf(editorView as "details" | "route" | "destination" | "tracking") + 2} of 6`}
      onClose={handleSheetClose}
      dismissDisabled={saving}
      onEscape={showConsent ? returnToDraft : !commitment && createNameStep && !reviewEditing ? undefined : editorView !== "main" ? commitment ? returnToSummary : createPrevious : undefined}
      onBack={showConsent ? returnToDraft : !commitment && createNameStep && !reviewEditing ? undefined : editorView !== "main" ? commitment ? returnToSummary : createPrevious : commitment && !viewing ? returnToSavedView : !commitment ? createPrevious : undefined}
      backLabel="Back to plan"
      onHistoryBack={showConsent ? returnToDraft : !commitment && createNameStep && !reviewEditing ? undefined : editorView !== "main" ? commitment ? returnToSummary : createPrevious : commitment && !viewing ? returnToSavedView : !commitment ? createPrevious : undefined}
      footer={({ close, closeThen }) => {
        if (viewing && commitment) {
          if (confirmingCancel) return <div className="space-y-2"><p className="text-sm leading-5 text-slate-700 dark:text-slate-200">Delete this plan? Money already set aside stays where it is. This only stops tracking it.</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setConfirmingCancel(false)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold dark:border-slate-600">Keep plan</button><button type="button" disabled={saving} onClick={() => void handleCancelCommitment(close)} className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Deleting…" : "Delete plan"}</button></div></div>;
          const paused = Boolean((commitment as Commitment & { paused?: boolean }).paused);
          return <div className="space-y-2"><button type="button" onClick={() => setViewing(false)} className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">Edit plan</button><div className="grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => void setPaused(close, !paused)} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-semibold dark:border-slate-600">{paused ? "Resume plan" : "Pause plan"}</button><button type="button" disabled={saving} onClick={() => setConfirmingCancel(true)} className="min-h-11 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-700 dark:border-red-900 dark:text-red-300">Delete plan</button></div></div>;
        }
        if (showConsent && consentSnapshot) {
          return (
            <div className="space-y-2">
              <button type="button" disabled={saving} onClick={() => saveFromConsent(close)} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">
                {saving ? "Saving…" : consentSnapshot.actions.anyway}
              </button>
              <button type="button" disabled={saving} onClick={returnToDraft} className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 active:scale-95 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
                {consentSnapshot.actions.later_date}
              </button>
              <button type="button" disabled={saving} onClick={() => closeConsentThen(closeThen, () => router.push("/cards"))} className="w-full rounded-xl px-4 py-2 text-sm font-semibold text-indigo-600 active:scale-95 disabled:opacity-50 dark:text-indigo-400">
                {consentSnapshot.actions.debt_first}
              </button>
            </div>
          );
        }
        if (commitment && !viewing && editorView === "main") {
          return <div className="grid grid-cols-2 gap-2"><button type="button" onClick={returnToSavedView} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">Back to plan</button><button type="submit" form="commitment-form" disabled={!canSave} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save changes"}</button></div>;
        }
        if (!commitment && editorView === "main") {
          return <div className="grid grid-cols-2 gap-2"><button type="button" onClick={createPrevious} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">Back</button><button type="submit" form="commitment-form" disabled={!canSave} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save goal"}</button></div>;
        }
        if (!commitment && editorView !== "main") {
          const createValid = createNameStep ? name.trim().length > 0 : editorView === "details" ? amountValid && monthValid : editorView === "route" ? sourceOptions.some(account => account.id === sourceId) : editorView === "tracking" ? trackingValid : true;
          return <div className="grid grid-cols-2 gap-2"><button type="button" onClick={reviewEditing ? returnToSummary : createNameStep ? close : createPrevious} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">{createNameStep && !reviewEditing ? "Cancel" : "Back"}</button><button key="navigate-draft" type="button" disabled={!createValid} onClick={event => { event.preventDefault(); createNext(); }} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60">{reviewEditing ? "Return to review" : editorView === "tracking" ? "Review goal" : "Continue"}</button></div>;
        }
        return (
          editorView !== "main" ? <button type="button" onClick={returnToSummary} className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95">Keep these changes</button> :
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={saving} onClick={close} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 active:scale-95 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Cancel</button>
            <button type="submit" form="commitment-form" disabled={!canSave} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">{saving ? "Saving…" : commitment ? "Save changes" : "Save plan"}</button>
          </div>
        );
      }}
    >
      {({ close }) => <>
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
              </div>
            ) : viewing && commitment ? (
              <PlanRecordView
                kind="goal"
                contribution={commitment.paused ? 0 : commitment.planned_per_period_slice ?? commitment.usual_slice ?? commitment.per_period_slice}
                cadence="estimated each pay period"
                target={{ amount: commitment.amount, month: new Date(`${commitment.target_date.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) }}
                progress={commitment.progress}
                sourceAccount={accountList.find(account => account.id === commitment.source_account_id)}
                sourceUnavailable={Boolean(commitment.source_account_id) && !accountList.some(account => account.id === commitment.source_account_id)}
                destinationUnavailable={potsFromCommitment(commitment).some(pot => !accountList.some(account => account.id === pot.account_id))}
                destinationAccounts={potsFromCommitment(commitment).map(pot => accountList.find(account => account.id === pot.account_id)).filter((account): account is Account => Boolean(account))}
                trackingLabel={(commitment as Commitment & { category_tracking?: PlanCategoryTrackingValue }).category_tracking ? `${(commitment as Commitment & { category_tracking?: PlanCategoryTrackingValue }).category_tracking?.category} category activity` : commitment.fill_rule?.match_value ? commitment.fill_rule.match_value : "Not linked yet"}
                paused={Boolean((commitment as Commitment & { paused?: boolean }).paused)}
                periodNote={commitment.fulfilment ? `£${(commitment.fulfilment.matched_pence / 100).toLocaleString("en-GB")} paid this period` : undefined}
              >
                {saveError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">That did not save. Please try again.</p>}
                {(commitment as Commitment & { category_tracking?: PlanCategoryTrackingValue }).category_tracking && <PlanCategoryTracking kind="goal" sourceAccountId={commitment.source_account_id ?? ""} destinationAccountIds={potsFromCommitment(commitment).map(pot => pot.account_id)} value={(commitment as Commitment & { category_tracking?: PlanCategoryTrackingValue }).category_tracking ?? null} onChange={() => {}} commitmentId={commitment.id} readOnly />}
              </PlanRecordView>
            ) : (
            <form id="commitment-form" onSubmit={(event) => handleSubmit(event, close)} className="space-y-3 [&_input]:text-base">
              {editorView === "main" && !commitment ? <div className="space-y-5">
                <div><button type="button" onClick={() => { setReviewEditing(true); setCreateNameStep(true); setEditorView("details"); }} className="min-h-11 max-w-full break-words text-left text-lg font-bold text-slate-900 dark:text-slate-100">{name || "Name this goal"}</button><p className="text-sm text-slate-600 dark:text-slate-300">{amountValid ? <MoneyText text={`£${parsedAmount.toLocaleString("en-GB")} by ${new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`} /> : "Choose a target amount"}</p><button type="button" onClick={() => { setReviewEditing(true); setCreateNameStep(false); setEditorView("details"); }} className="min-h-11 text-sm font-semibold text-indigo-700 underline underline-offset-2 dark:text-indigo-300">Change target</button></div>
                <PlanContribution amount={summarySlice} cadence="estimated each pay period" progress={amountValid ? { current: estimatedProgress, target: parsedAmount } : undefined} />
                <div className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
                  <button type="button" onClick={() => { setReviewEditing(true); setEditorView("route"); }} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left"><span className="shrink-0 text-slate-600 dark:text-slate-300">Pay from</span><strong className="min-w-0 break-words text-right text-slate-900 dark:text-slate-100">{tidyAccountName(accountList.find(account => account.id === sourceId)?.name ?? "Choose an account")}</strong></button>
                  <button type="button" onClick={() => { setReviewEditing(true); setEditorView("destination"); }} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left"><span className="shrink-0 text-slate-600 dark:text-slate-300">Save in</span><strong className="min-w-0 break-words text-right text-slate-900 dark:text-slate-100">{pots.length ? pots.map(pot => tidyAccountName(accountList.find(account => account.id === pot.account_id)?.name ?? "Savings pot")).join(", ") : "Stays in the paying account"}</strong></button>
                  <button type="button" onClick={() => { setReviewEditing(true); setEditorView("tracking"); }} className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left"><span className="shrink-0 text-slate-600 dark:text-slate-300">Tracking</span><strong className="min-w-0 break-words text-right text-slate-900 dark:text-slate-100">{categoryTracking ? `${categoryTracking.category} category` : rule.match_value ? "Payment confirmed" : "Not linked yet"}</strong></button>
                </div>
                <PlanAffordability caution={feasibilityCaution}>{feasibilityNote ?? "Check Upcoming to see how this fits before payday."}</PlanAffordability>
                <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">This is a plan. You move the money in your bank. Any standing order will keep running.</p>
                {saveError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">That did not save. Please try again.</p>}
              </div> : editorView === "main" ? <>
              <PlanContribution amount={summarySlice} cadence={contributionCadence} progress={amountValid ? { current: estimatedProgress, target: parsedAmount } : undefined} />
              {unchangedFinancials && fulfilment && <p className="pb-3 text-xs leading-5 text-slate-600 dark:text-slate-300"><MoneyText text={`£${(fulfilment.matched_pence / 100).toLocaleString("en-GB")} paid this period · £${(fulfilment.unmet_pence / 100).toLocaleString("en-GB")} still to set aside`} /></p>}
              {saveError && <p role="alert" className="text-sm text-slate-700 dark:text-slate-200">That did not save. Please try again.</p>}
              <PlanAffordability caution={feasibilityCaution}>{feasibilityNote ?? "We will check the contribution against your current plan before you save."}</PlanAffordability>
              <button ref={summaryFocus} type="button" aria-label="Change details" onClick={() => { returnFocus.current = "details"; setEditorView("details"); }} className="flex min-h-12 w-full items-center justify-between border-y border-slate-200 py-3 text-left dark:border-slate-700"><span><strong className="block text-sm">{name || "Add a name"}</strong><small className="mt-1 block text-xs text-slate-600 dark:text-slate-300">{amountValid ? <MoneyText text={`Target £${parsedAmount.toLocaleString("en-GB")}`} /> : "Choose a target"} · by {new Date(`${month}-01T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</small></span><Pencil size={16} className="text-slate-400" aria-hidden="true" /></button>
              <PlanRouteSummary
                source={accountList.find((account) => account.id === sourceId) ? tidyAccountName(accountList.find((account) => account.id === sourceId)!.name) : "Choose a paying account"}
                sourceAccount={accountList.find(account => account.id === sourceId)}
                destinationAccount={pots.length === 1 ? accountList.find(account => account.id === pots[0].account_id) : undefined}
                destination={pots.length ? pots.map(pot => tidyAccountName(accountList.find(account => account.id === pot.account_id)?.name ?? "Savings pot")).join(", ") : "Kept in the paying account"}
                buttonRef={routeFocus} onEdit={() => { returnFocus.current = "route"; setEditorView("route"); }}
                destinationButtonRef={destinationFocus} onDestinationEdit={() => { returnFocus.current = "destination"; setEditorView("destination"); }}
              />
              {sourceInferred && <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">Paying account suggested from recent transfers. Saving confirms this choice.</p>}
              <PlanTrackingSummary buttonRef={trackingFocus} label={categoryTracking ? `${categoryTracking.category} category activity` : rule.match_value ? (suggestedActive ? "Suggested transfer to your savings pot" : "Your chosen transfer") : "Check it yourself"} detail={categoryTracking ? "Category activity is evidence only. It does not count as progress or release money." : rule.match_value ? "A matching outgoing payment counts towards this period’s contribution, not as spending." : "No transfer rule is set. The contribution stays reserved until you change the plan."} onEdit={() => { returnFocus.current = "tracking"; setEditorView("tracking"); }} />
              {rule.match_value && <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-slate-600 dark:text-slate-300">Transfer reference</summary><p className="break-words pb-3 text-xs text-slate-600 dark:text-slate-300">{rule.match_value}</p></details>}
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Confirming saves every choice. It does not move money.</p>
              </> : <>
              {!commitment && editorView === "details" && createNameStep && <p className="mb-4 text-sm leading-6 text-slate-600 dark:text-slate-300"><MoneyText unmasked text="For example, save £2,000 for a trip to Japan by December 2028." /></p>}
              <h3 className="mb-5 text-base font-semibold text-slate-900 dark:text-slate-100">{editorView === "details" ? createNameStep ? "Name your goal" : "Choose your target" : editorView === "route" ? "Choose a paying account" : editorView === "destination" ? "Choose savings pots" : "Recognise your transfer"}</h3>
              {/* G228: a quiet statement, no control. Changing the amount or the
                  date below ends the easing; that is the way back. */}
              {editorView === "details" && commitment?.eased_this_period != null && (
                <p data-plan-eased className="text-xs leading-5 text-slate-600 dark:text-slate-400">
                  Eased to £{commitment.eased_this_period.toLocaleString("en-GB")} this period. Changing the amount or the date here ends the easing.
                </p>
              )}
              {/* Name */}
              {editorView === "details" && <>
              {(commitment || createNameStep) && <div>
                <label htmlFor="commitment-name" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Name
                </label>
                <input
                  id="commitment-name" type="text" autoComplete="off"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setSaveError(false); }}
                  placeholder="Summer holiday"
                  maxLength={40}
                  required
                  className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                />
              </div>}

              {/* Amount */}
              {(!createNameStep || commitment) && <>
              <div>
                <label htmlFor="commitment-amount" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                  Total amount
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                  <input
                    id="commitment-amount" type="text"
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
                <DateField
                  mode="month" label="By when" title="Target month" value={month} min={minMonth} buttonRef={monthInputRef}
                  onChange={(v) => { setMonth(v); setSaveError(false); }}
                  required
                />
              </div>
              </>}
              </>}

              {/* Funding pots (optional, multi) — connected savings pots plus
                  offline manually-updated accounts. Offline pots are badged
                  and never receive automated payday-plan legs. */}
              {editorView === "destination" && potOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Set aside in savings pots
                  </label>
                  <div
                    role="group"
                    aria-label="Set aside in savings pots"
                    className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden"
                  >
                    {/* "No pot" — first row, clears the selection */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={pots.length === 0}
                    onClick={() => { setPots([]); setSuggestion(null); setRule(EMPTY_RULE); setCategoryTracking(null); setRuleTouched(true); }}
                      className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 text-left active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
                    >
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-white/[0.06] ring-1 ring-black/[0.06] dark:ring-white/[0.12] flex-shrink-0">
                        <CircleDashed size={16} className="text-slate-400 dark:text-slate-500" />
                      </span>
                      <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">Keep in the paying account</span>
                      <CheckDot selected={pots.length === 0} />
                    </button>

                    {potOptions.map((acc) => {
                      const brand = accountBrand(acc);
                      const sel = pots.find((p) => p.account_id === acc.id);
                      // Live pot-ledger conflict — an older goal is already
                      // drawing from this pot, so what's actually free is
                      // less than the raw balance.
                      const detail = potsDetailByAccount.get(acc.id);
                      const hasConflict = !!(sel && detail && detail.also_funding.length > 0);
                      const chipBalance = detail?.free ?? 0;
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
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{tidyAccountName(acc.name)}</span>
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
                                disabled={!sel.count_existing && (acc.manual || !detail)}
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
                                  <MoneyText text={acc.manual && !sel.count_existing ? "Offline balance, update it before including money" : !detail && !sel.count_existing ? "Checking available pot money…" : `Include £${Math.round(chipBalance).toLocaleString("en-GB")} already free in this pot`} />
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

              {/* G230: the current account the contribution leaves each period.
                  Quiet and optional; "Not set" keeps the plan pooled-only. */}
              {editorView === "route" && sourceOptions.length === 0 && <p role="status" className="text-sm leading-6 text-slate-600 dark:text-slate-300">No counted GBP current account is available. Check Accounts or connect a paying account before saving this plan.</p>}
              {editorView === "route" && sourceOptions.length > 0 && (
                <div id="commitment-source-picker" data-testid="paid-from-field">
                  <AccountRadioPicker
                    accounts={sourceOptions}
                    value={sourceId}
                    onChange={(id) => { setSourceId(id); setSourceTouched(true); setSuggestion(null); setRule(EMPTY_RULE); setCategoryTracking(null); setRuleTouched(true); setSaveError(false); }}
                    label="Pay from"
                    helperText={sourceInferred
                      ? "Based on recent transfers. Saving the plan confirms this account."
                      : "Choose the account this contribution leaves each period. This does not move money."}
                  />
                </div>
              )}

              {/* G256: the payment that fulfils each period's contribution. The
                  shared set-aside rule picker, reading payments leaving the
                  paying account. A suggestion is prefilled, never applied. */}
              {editorView === "tracking" && sourceOptions.length > 0 && sourceId && (
                <div data-testid="plan-fill-rule-field" className="space-y-1.5">
                  <PlanTrackingMethod value={categoryTracking ? "category" : paymentPickerOpen ? "payment" : "none"} onChange={method => { setCategoryTracking(method === "category" ? { category: allCategories.includes("Savings") ? "Savings" : allCategories[0] ?? "Other" } : null); setPaymentPickerOpen(method === "payment"); setRule(EMPTY_RULE); setRuleTouched(true); }} />
                  {categoryTracking && <PlanCategoryTracking kind="goal" sourceAccountId={sourceId} destinationAccountIds={pots.map((pot) => pot.account_id)} value={categoryTracking} commitmentId={commitment?.id} onChange={(value) => { setCategoryTracking(value); setPaymentPickerOpen(value === null); setRule(EMPTY_RULE); setRuleTouched(true); }} />}
                  {!categoryTracking && paymentPickerOpen && <>
                  <FillRulePicker
                    accountId={sourceId}
                    value={rule}
                    onChange={(v) => { setRule(v); setRuleTouched(true); setSaveError(false); }}
                    loadCandidates={loadFillCandidates}
                    note={suggestedActive ? "Suggested from your transfers" : undefined}
                    suggestedName={suggestedActive ? suggestion?.match_value : undefined}
                    emptyText="No suitable transfers found in the last 90 days."
                    helperText={suggestedActive
                      ? "Saving the plan confirms the displayed rule. A matching payment from this account counts as this period’s contribution."
                      : "A matching payment from this account counts as this period’s contribution, not everything leaving the account."}
                  />
                  </>}
                  {!categoryTracking && !paymentPickerOpen && <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">You can add tracking later. The contribution stays held back in the meantime.</p>}
                  {fulfilment && fulfilment.state !== "unmet" && fulfilment.matched.length > 0 && (
                    <p data-testid="plan-fill-rule-matched" className="text-[13px] text-slate-500 dark:text-slate-400 num">
                      <MoneyText text={fulfilment.state === "fulfilled"
                        ? `Matched: £${(fulfilment.matched_pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })} on ${shortDate(fulfilment.matched[fulfilment.matched.length - 1].date)}, ${fulfilment.matched[fulfilment.matched.length - 1].label}.`
                        : `Matched so far: £${(fulfilment.matched_pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })} of £${(fulfilment.expected_pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}.`} />
                      {fulfilment.seen_in_sink ? " It has arrived in the pot." : ""}
                    </p>
                  )}
                  {fulfilment && fulfilment.state === "unmet" && (
                    <p data-testid="plan-fill-rule-matched" className="text-[13px] text-slate-500 dark:text-slate-400">
                      No matching payment yet this pay period.
                    </p>
                  )}
                  {rule.match_value.trim() !== "" && (
                    <button
                      type="button"
                      onClick={() => { setRule(EMPTY_RULE); setRuleTouched(true); }}
                      className="min-h-[44px] flex items-center px-1 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
                    >
                      Stop matching a payment
                    </button>
                  )}
                </div>
              )}

              {/* Live per-period estimate — hedged, backend derives the real slice */}
              {editorView === "details" && slice != null && (
                <p className="text-[13px] text-slate-500 dark:text-slate-400 num" aria-live="polite">
                  <MoneyText text={`≈ £${slice.toLocaleString("en-GB")} ${periodLabel ? `each pay period (${periodLabel})` : "a period"} · ${periods} ${periods === 1 ? "period" : "periods"}`} />
                </p>
              )}

              {/* Feasibility verdict — slate text always; amber dot signifier
                  when feasibility needs attention (savings or stretch), never red. */}
              {editorView === "details" && slice != null && feasibility && feasibilityNote && (
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

              {/* Cancel-commitment — edit mode only, quiet two-step confirm */}
              {editorView === "details" && commitment && !confirmingCancel && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirmingCancel(true)}
                  className="w-full min-h-[44px] text-[13px] font-medium text-slate-400 dark:text-slate-500 hover:opacity-80 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                >
                  Cancel this plan
                </button>
              )}
              {editorView === "details" && commitment && confirmingCancel && (
                <div className="rounded-xl bg-slate-50 dark:bg-slate-700/50 px-4 py-3 space-y-2">
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                    Stop reserving for this? Money already set aside stays where it is.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleCancelCommitment(close)}
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
              </>}
            </form>
            )}
      </>}
    </SheetFrame>
  );
}
