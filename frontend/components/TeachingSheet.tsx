"use client";

// The teaching sheet collects a classification and a payment scope before
// saving. The server owns the matching set, protection and Undo snapshots.

import { displayAccountName } from "@/lib/accountName";
import { useState, useEffect, useRef, useId } from "react";
import { Undo2, ChevronRight, ChevronLeft, Home, Landmark, ReceiptText, Target } from "lucide-react";
import {
  api, ApiError, type Account, type Commitment, type Transaction,
  type CorrectionChoice, type CorrectionRequest, type CorrectionScope, type CorrectionScopeCounts,
} from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import { getCategoryColour, inferCategoryKind, type CategoryKind } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { usePreferences } from "@/components/PreferencesContext";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { useCategories } from "@/components/CategoriesContext";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { useCategoryIcons } from "@/components/IconProvider";
import CategoryIconPicker from "@/components/CategoryIconPicker";
import { formatDate } from "@/lib/payPeriod";
import { currencySymbol, formatCurrency, MINUS } from "@/lib/currency";
import { accountBrand, BankBadge } from "@/components/AccountMiniCard";
import CommitmentSheet from "@/components/CommitmentSheet";
import { invalidateAfterTransactionCorrection, notifyTransactionsChanged } from "@/lib/cacheInvalidation";
import CorrectionScopeReview, { paymentCount } from "@/components/CorrectionScopeReview";
import CategorisationRulesSheet from "@/components/CategorisationRulesSheet";

type Step =
  | "spend-root"
  | "review-card"
  | "spend-naming"
  | "movement-root"
  | "movement-kind"
  | "movement-goal"
  | "movement-offline"
  | "scope"
  | "done";

type CorrectionDraft = {
  choice: CorrectionChoice;
  category: string;
  detail?: string;
  back: Step;
  newCategory?: { kind: CategoryKind; icon?: string };
};

type CorrectionReceipt = {
  operationId: string;
  count: number;
  category: string;
  protectedCount: number;
  ruleId: string | null;
  ruleConflict?: boolean;
  refreshPending: boolean;
  undone: boolean;
};

type CategoryChange = Pick<Transaction, "id" | "category">;
type CategoryChanges = { ids: string[]; category: string };

const primaryAction = "min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50";
const secondaryAction = "min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800";

function saveErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "The update could not be confirmed. Try again to check what was saved.";
}

interface TeachingSheetProps {
  transaction: Transaction;
  onClose: () => void;
  /** Mirrors TransactionSheet's contract so existing callers (SpendPage's
   *  cache invalidation / verdict refetch) plug in unchanged. */
  onUpdated: (change: CategoryChange, additionalIds?: string[], reverted?: boolean) => void;
  account?: Account;
  /** Opens straight on "Is this account yours?" instead of the category
   *  picker, without changing what `transaction.category` says (so the
   *  header/undo copy stays honest). For the Spend ask card's "Tell me
   *  what this was": the row is genuinely unresolved ("Other"), and for a
   *  payment the engine cannot place, the Destination Rule's movement
   *  question is the better first question — not a synthesised category
   *  guess. Keeps preview (/design/spend-live) and production identical:
   *  both now land on movement-root for the ask handoff. */
  forceMovementRoot?: boolean;
  /**
   * A review surface can start at one clear next step without recreating the
   * correction logic here. It deliberately does not save anything on mount:
   * the person still confirms the choice in this sheet.
   */
  initialReviewChoice?: "savings" | "spending" | "card";
  nested?: boolean;
  /** Transfer review saves immediately and refreshes totals once on close. */
  deferRecompute?: boolean;
}

export default function TeachingSheet({ transaction, onClose, onUpdated, account, forceMovementRoot, initialReviewChoice, nested, deferRecompute = false }: TeachingSheetProps) {

  const { colours } = useColours();
  const { hideNetWorth, preferencesReady } = usePreferences();
  const { icons: iconOverrides } = useCategoryIcons();
  const SavingsCategoryIcon = getCategoryIcon("Savings", iconOverrides);
  const InvestmentCategoryIcon = getCategoryIcon("Investment", iconOverrides);
  const DebtCategoryIcon = getCategoryIcon("Debt", iconOverrides);
  const { allCategories, customCategories, kinds, addCategory } = useCategories();

  const originalCategory = transaction.category || "Other";
  const originalKind = kinds[originalCategory] ?? inferCategoryKind(originalCategory);
  const isMovementRead = originalKind === "movement";
  const isCredit = transaction.transaction_type === "credit";
  const name = transaction.merchant_name || transaction.description || "(no description)";
  const [step, setStep] = useState<Step>(() => {
    // These are explicit review choices. Savings still asks for the kind and
    // destination; card repayment still asks for a final confirmation.
    if (initialReviewChoice === "savings" && !isCredit) return "movement-kind";
    if (initialReviewChoice === "card" && !isCredit) return "review-card";
    if (initialReviewChoice === "spending") return "spend-root";
    return isMovementRead || forceMovementRoot ? "movement-root" : "spend-root";
  });
  // True once the movement fork was reached via the spend fork's escape
  // hatch (not because the row was already filed as movement) — suppresses
  // the redundant "No — this was spending" option and shows a back link.
  const [viaEscape, setViaEscape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<Commitment[] | null>(null);
  // Distinct from "genuinely none" (goals === []) — a failed read must never
  // collapse into the empty-state copy, which would push the user toward
  // creating a duplicate offline pot for a goal that actually exists.
  const [goalsFailed, setGoalsFailed] = useState(false);
  const [goalSetupOpen, setGoalSetupOpen] = useState(false);
  const [goalSetupBusy, setGoalSetupBusy] = useState(false);
  useEffect(() => {
    if (step !== "movement-goal" || goals !== null || goalsFailed) return;
    api.listCommitments()
      .then((r) => setGoals(r.items.filter((c) => c.status === "active")))
      .catch(() => setGoalsFailed(true));
  }, [step, goals, goalsFailed]);

  const [offlineName, setOfflineName] = useState("");
  const offlineNameId = useId();

  const [namingText, setNamingText] = useState("");
  const namingId = useId();
  const [namingIcon, setNamingIcon] = useState<string | null>(null);
  const [namingKind, setNamingKind] = useState<CategoryKind>("discretionary");
  function changeNamingText(text: string) {
    setNamingText(text);
    const guess = inferCategoryKind(text);
    setNamingKind(guess === "movement" ? "discretionary" : guess);
  }

  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [scope, setScope] = useState<CorrectionScope>("one");
  const [counts, setCounts] = useState<CorrectionScopeCounts | null>(null);
  const [countStatus, setCountStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [pendingRequest, setPendingRequest] = useState<CorrectionRequest | null>(null);
  const [receipt, setReceipt] = useState<CorrectionReceipt | null>(null);
  const [undoFailed, setUndoFailed] = useState(false);
  const [viewRuleId, setViewRuleId] = useState<string | null>(null);
  const countRead = useRef(0);
  const mutationInFlight = useRef(false);
  const createdCategory = useRef<string | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const sheetHeading = useRef<HTMLHeadingElement>(null);
  const sheetBody = useRef<HTMLDivElement>(null);
  const returningFromReview = useRef(false);

  useEffect(() => () => { countRead.current += 1; }, []);
  useEffect(() => {
    if (step === "scope" || step === "done") {
      sheetBody.current?.scrollTo({ top: 0 });
      reviewHeading.current?.focus({ preventScroll: true });
    } else if (returningFromReview.current) {
      returningFromReview.current = false;
      sheetHeading.current?.focus({ preventScroll: true });
    }
  }, [step, receipt?.undone]);

  async function checkCounts() {
    const read = ++countRead.current;
    setCounts(null);
    setCountStatus("loading");
    try {
      const next = await api.correctionScope(transaction.id);
      if (read !== countRead.current) return;
      setCounts(next);
      setCountStatus("ready");
    } catch (cause) {
      if (read !== countRead.current) return;
      const unavailable = cause instanceof ApiError && (cause.status === 400 || cause.status === 404);
      setCountStatus(unavailable ? "unavailable" : "error");
    }
  }

  function openReview(next: Omit<CorrectionDraft, "back">) {
    setDraft({ ...next, back: step });
    setScope("one");
    setError(null);
    setStep("scope");
    void checkCounts();
  }

  function changeClassification() {
    if (!draft || mutationInFlight.current || pendingRequest) return;
    countRead.current += 1;
    returningFromReview.current = true;
    setStep(draft.back);
    setDraft(null);
    setError(null);
  }

  function chooseSpend(category: string) {
    openReview({ choice: { resolution: isMovementRead ? "spending" : "category", category }, category });
  }

  function chooseNewCategory() {
    const category = namingText.trim().replace(/\s+/g, " ");
    if (!category) return;
    openReview({
      choice: { resolution: isMovementRead ? "spending" : "category", category },
      category,
      newCategory: { kind: namingKind, icon: namingIcon ?? undefined },
    });
  }

  const oneCount = counts?.one_count ?? (
    countStatus === "unavailable" || transaction.custom_category != null || transaction.is_pending || transaction.planned ? 0 : 1
  );
  const selectedCount = scope === "one" ? oneCount : scope === "history" ? counts?.history_count : counts?.all_count;

  function notifyUpdated(groups: CategoryChanges[], reverted = false) {
    const changes = groups.filter(group => group.ids.length);
    if (!changes.length) return;
    if (!deferRecompute) invalidateAfterTransactionCorrection(transaction.id, { oldCategory: originalCategory, newCategory: changes[0].category });
    for (const { ids: [id, ...siblings], category } of changes) {
      onUpdated({ id, category }, siblings, reverted);
    }
    if (!deferRecompute) {
      notifyTransactionsChanged(changes.flatMap(group => group.ids), changes.length === 1 ? changes[0].category : undefined);
    }
  }

  async function saveCorrection() {
    if (!draft || mutationInFlight.current || (!pendingRequest && !selectedCount)) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = pendingRequest ?? {
        ...draft.choice,
        operation_id: crypto.randomUUID(),
        scope,
        expected_count: selectedCount!,
        defer_recompute: deferRecompute,
      };
      if (draft.newCategory && createdCategory.current !== draft.category && !allCategories.includes(draft.category)) {
        await addCategory(draft.category, draft.newCategory.kind, draft.newCategory.icon);
        createdCategory.current = draft.category;
      }
      setPendingRequest(request);
      const saved = await api.applyCorrection(transaction.id, request);
      const changes = [{ ids: saved.affected_ids, category: saved.category }];
      setPendingRequest(null);
      setReceipt({
        operationId: request.operation_id,
        count: saved.updated_count,
        category: saved.category,
        protectedCount: saved.protected_count,
        ruleId: saved.rule_id ?? null,
        ruleConflict: saved.rule_conflict,
        refreshPending: saved.refresh_pending && !saved.refresh_deferred,
        undone: false,
      });
      setStep("done");
      notifyUpdated(changes);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) {
        setPendingRequest(null);
        if (cause.status === 409) {
          setScope("one");
          void checkCounts();
        }
      }
      setError(saveErrorMessage(cause));
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function undoCorrection() {
    if (!receipt || receipt.undone || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setUndoFailed(false);
    setError(null);
    try {
      const restored = await api.undoCorrection(transaction.id, receipt.operationId, deferRecompute);
      const byCategory = new Map<string, string[]>();
      for (const [id, category] of Object.entries(restored.restored_categories)) {
        const ids = byCategory.get(category) ?? [];
        ids.push(id);
        byCategory.set(category, ids);
      }
      const changes = [...byCategory].map(([category, ids]) => ({ ids, category }));
      setReceipt({
        ...receipt,
        count: restored.updated_count,
        ruleId: null,
        ruleConflict: false,
        refreshPending: restored.refresh_pending && !restored.refresh_deferred,
        undone: true,
      });
      notifyUpdated(changes, true);
    } catch {
      setUndoFailed(true);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function refreshFigures() {
    if (!receipt || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const refreshed = await api.refreshCorrection(transaction.id, receipt.operationId);
      if (refreshed.refresh_pending) throw new Error("Refresh still pending");
      setReceipt({ ...receipt, refreshPending: false });
      if (!deferRecompute) {
        invalidateAfterTransactionCorrection(transaction.id, {});
        onUpdated({ id: transaction.id });
        notifyTransactionsChanged();
      }
    } catch {
      setError("The changes are saved. Try refreshing the figures again.");
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  const colour = getCategoryColour(originalCategory, colours);
  const CategoryIcon = getCategoryIcon(originalCategory, iconOverrides);
  const brand = account ? accountBrand(account) : null;

  // kinds populates async from GET /categories and fails open to {} on a
  // slow/failed fetch — fall back to inferCategoryKind so an unresolved
  // fetch never lets movement/income categories leak into the spend picker
  // (the Destination Rule). "Income" is an explicit name exclusion: it
  // matches no MOVEMENT_PATTERN and would otherwise infer discretionary.
  const kindOf = (c: string) => kinds[c] ?? inferCategoryKind(c);
  const spendPickable = allCategories.filter(
    (c) => c !== "Other" && c !== "Income" && kindOf(c) !== "movement" && kindOf(c) !== "income" && kindOf(c) !== "excluded",
  );
  const orderedSpend = [
    ...spendPickable.filter((c) => customCategories.includes(c)),
    ...spendPickable.filter((c) => !customCategories.includes(c)),
  ];

  const amountsHidden = hideNetWorth || !preferencesReady;
  const returnFromGoalSetup = () => { setGoalSetupOpen(false); setStep("movement-goal"); };

  return (
    <>
    <SheetFrame
      nested={nested}
      title={goalSetupOpen ? "Create a goal" : receipt
        ? `${receipt.undone ? "Restored" : "Updated"} ${paymentCount(receipt.count)}`
        : "Tell me what this was"}
      bodyRef={sheetBody}
      headingRef={step === "done" ? reviewHeading : sheetHeading}
      footer={step === "scope" && draft ? () => (
        <div className="grid gap-2">
          <button
            type="button"
            className={primaryAction}
            disabled={busy || (!pendingRequest && (countStatus === "loading" || !selectedCount))}
            onClick={saveCorrection}
          >
            {busy ? "Updating…" : pendingRequest ? "Retry update" : selectedCount ? `Update ${paymentCount(selectedCount)}` : "Update payments"}
          </button>
          <button type="button" className={secondaryAction} disabled={busy || !!pendingRequest} onClick={changeClassification}>Back</button>
        </div>
      ) : step === "done" && receipt ? ({ close }) => (
        <div className="grid gap-2">
          {receipt.refreshPending && !undoFailed && (
            <button type="button" className={primaryAction} disabled={busy} onClick={refreshFigures}>
              {busy ? "Refreshing…" : "Refresh figures"}
            </button>
          )}
          <button type="button" className={receipt.refreshPending ? secondaryAction : primaryAction} disabled={busy} onClick={close}>Done</button>
          {!receipt.undone && receipt.count > 0 && (
            <button
              type="button"
              className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300"
              disabled={busy}
              onClick={undoCorrection}
            >
              <Undo2 size={16} aria-hidden="true" />
              {busy ? "Working…" : undoFailed ? "Retry Undo" : "Undo correction"}
            </button>
          )}
        </div>
      ) : undefined}
      onClose={onClose}
      dismissDisabled={busy || goalSetupBusy}
      onBack={goalSetupOpen ? returnFromGoalSetup : undefined}
      onHistoryBack={goalSetupOpen ? returnFromGoalSetup : undefined}
      onEscape={goalSetupOpen ? returnFromGoalSetup : undefined}
      backLabel="Back to this payment"
    >
        <div className="pb-2">
          {/* 1. Transaction header — shared shape across every step */}
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-xl border border-slate-200 dark:border-transparent flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${colour}26` }}
            >
              <CategoryIcon size={16} style={{ color: colour }} />
            </span>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-800 dark:text-slate-200">
                {name}
              </p>
              <p aria-label={amountsHidden ? "Amount hidden" : undefined} className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                {isCredit ? "+" : MINUS}{amountsHidden ? `${currencySymbol(transaction.currency)}••••` : formatCurrency(transaction.amount, transaction.currency)}
              </p>
              <p className="text-[13px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                {formatDate(transaction.date)}
                {account && brand && (
                  <>
                    {" · "}
                    <BankBadge
                      logoSrc={brand.logoSrc}
                      initials={brand.initials}
                      altText={brand.label}
                      brandBg={brand.background}
                      size={18}
                      initialsSize="7px"
                    />
                    {displayAccountName(account.name)}
                  </>
                )}
              </p>
            </div>
          </div>

          {/* 2/3. The step content */}
          {goalSetupOpen ? (
            <BalancesHiddenContext.Provider value={amountsHidden}>
            <div className="mt-5">
              <CommitmentSheet
                commitment={null}
                onClose={() => { setGoalSetupOpen(false); setStep("movement-goal"); }}
                onSaved={async (goal) => {
                  setGoals((current) => [goal, ...(current ?? [])]);
                  setGoalsFailed(false);
                  setGoalSetupOpen(false);
                  setStep("movement-goal");
                }}
                embedded={{
                  renderActions: (actions) => <div className="mt-4">{actions}</div>,
                  onEdit: () => {},
                  onCancel: () => { setGoalSetupOpen(false); setStep("movement-goal"); },
                  onChangeContribution: () => {},
                  onBusyChange: setGoalSetupBusy,
                }}
              />
            </div>
            </BalancesHiddenContext.Provider>
          ) : <>
          {step === "movement-root" && isCredit && (
            <>
              {/* Credit fork (owner review defect 2) — a credit arriving
                  asks "where is this FROM", never "where did it go", and
                  goals/offline pots (destinations money moves TO) don't
                  apply to money arriving. One fixed intro regardless of
                  viaEscape/isAskHandoff — unlike the debit fork below, the
                  underlying question is the same in every entry path here. */}
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                Money arrived. Where is it from?
              </p>
              <p className="mt-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                Is this from one of your own accounts?
              </p>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({ choice: { resolution: "category", category: "Transfer" }, category: "Transfer", detail: "Money from another of your accounts." })}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity disabled:opacity-50"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    Yes: from another of my accounts
                  </span>
                  <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    filed as a transfer
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({ choice: { resolution: "category", category: "Income" }, category: "Income" })}
                  className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity disabled:opacity-50"
                >
                  <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    No: this was income
                  </span>
                </button>
                {!viaEscape && (
                  <button
                    type="button"
                    onClick={() => { setViaEscape(false); setStep("spend-root"); }}
                    className="w-full min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-700/60 px-3 py-2.5 text-left active:opacity-70 transition-opacity"
                  >
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                      No: something else
                    </span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      opens the category picker
                    </span>
                  </button>
                )}
              </div>
              {viaEscape && (
                <button
                  type="button"
                  onClick={() => setStep("spend-root")}
                  className="mt-3 inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                  Back to categories
                </button>
              )}
            </>
          )}

          {step === "movement-root" && !isCredit && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Where did this money go?</p>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({ choice: { resolution: "mine-here" }, category: "Transfer", detail: "Money moved between your own accounts." })}
                  className="w-full min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><Landmark size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Another of my accounts in Sorted</span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({ choice: { resolution: "mine-card" }, category: "Debt", detail: "A repayment to one of your cards." })}
                  className="w-full min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><DebtCategoryIcon size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Paying off one of my cards</span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-kind")}
                  className="w-full min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><SavingsCategoryIcon size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Savings or investments</span><span className="mt-0.5 block text-[11px] font-normal text-slate-600 dark:text-slate-400">For money put aside outside Sorted</span></span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-goal")}
                  className="w-full min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><Target size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">A goal in Sorted</span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-offline")}
                  className="w-full min-h-[56px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><Home size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">An account Sorted can&apos;t see</span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                {!viaEscape && (
                  <button
                    type="button"
                    onClick={() => { setViaEscape(false); setStep("spend-root"); }}
                    className="w-full min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><ReceiptText size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Spending</span><span className="mt-0.5 block text-[11px] font-normal text-slate-600 dark:text-slate-400">Choose what you bought</span></span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                  </button>
                )}
              </div>
              {viaEscape && (
                <button
                  type="button"
                  onClick={() => setStep("spend-root")}
                  className="mt-3 inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                  Back to categories
                </button>
              )}
            </>
          )}

          {step === "movement-kind" && (
            <>
              <button
                type="button"
                onClick={() => setStep("movement-root")}
                className="mt-3 inline-flex min-h-11 items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                Back
              </button>
              <p className="mt-1 text-[15px] font-semibold text-slate-900 dark:text-slate-100">What did you put it into?</p>
              <div className="mt-3 space-y-2">
                <button type="button" onClick={() => openReview({ choice: { resolution: "mine-savings" }, category: "Savings", detail: "Money you put aside for later." })} className="w-full min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><SavingsCategoryIcon size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Savings</span><span className="mt-0.5 block text-[11px] font-normal text-slate-600 dark:text-slate-400">Cash you&apos;re putting aside</span></span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
                <button type="button" onClick={() => openReview({ choice: { resolution: "mine-investment" }, category: "Investment", detail: "Money sent to an investment." })} className="w-full min-h-[64px] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700/60 px-3 py-2.5 text-left active:scale-[0.99] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <span className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><InvestmentCategoryIcon size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Investment</span><span className="mt-0.5 block text-[11px] font-normal text-slate-600 dark:text-slate-400">Funds, shares, crypto or a pension</span></span><ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" /></span>
                </button>
              </div>
            </>
          )}

          {step === "movement-goal" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">Which goal does this fund?</p>
              {goalsFailed ? (
                <>
                  <p className="mt-3 rounded-xl bg-slate-100 dark:bg-slate-700/60 px-3 py-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200" role="alert">
                    I couldn&apos;t check your goals just now, try again in a moment.
                  </p>
                  <button
                    type="button"
                    onClick={() => setGoalsFailed(false)}
                    className="mt-2 text-[12px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity"
                  >
                    Try again
                  </button>
                </>
              ) : goals === null ? (
                <p className="mt-3 text-[13px] text-slate-600 dark:text-slate-400">Loading your goals…</p>
              ) : goals.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                  <Target size={20} className="text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                  <p className="mt-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">No active goals yet</p>
                  <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">Create one first, then choose it here.</p>
                  <button
                    type="button"
                    onClick={() => setGoalSetupOpen(true)}
                    className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Create a goal
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {goals.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => openReview({ choice: { resolution: "mine-goal", goal_id: g.id }, category: "Transfer", detail: `Money for your ${g.name} goal.` })}
                      className="w-full min-h-[56px] px-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 text-left text-[13px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-700/60 dark:text-slate-100 active:scale-[0.99] transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-transparent dark:bg-indigo-400/15 dark:text-indigo-300"><Target size={18} aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">{g.name}</span>
                      <ChevronRight size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {!goalsFailed && goals && goals.length > 0 && (
                <button type="button" disabled={busy} onClick={() => setGoalSetupOpen(true)} className="mt-3 flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 dark:text-indigo-300">
                  Create a goal
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep("movement-root")}
                className="mt-4 inline-flex min-h-11 items-center gap-0.5 rounded-lg text-[12px] font-semibold text-slate-600 dark:text-slate-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                Back
              </button>
            </>
          )}

          {step === "movement-offline" && (
            <>
              <label htmlFor={offlineNameId} className="mt-4 block text-sm font-semibold text-slate-800 dark:text-slate-200">
                Account name (optional)
              </label>
              <input
                id={offlineNameId}
                name="offline-account-name"
                autoComplete="off"
                value={offlineName}
                onChange={(e) => setOfflineName(e.target.value)}
                placeholder="For example, Premium Bonds…"
                maxLength={60}
                className="mt-3 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({
                    choice: { resolution: "mine-offline", offline_pot_name: offlineName.trim() || undefined },
                    category: "Transfer",
                    detail: offlineName.trim() ? `Money for your ${offlineName.trim()} account.` : "Money moved to an account Sorted cannot see.",
                  })}
                  className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Use this account
                </button>
                <button
                  type="button"
                  onClick={() => setStep("movement-root")}
                  className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                  Back
                </button>
              </div>
            </>
          )}

          {step === "review-card" && (
            <>
              <p className="mt-4 text-[13px] leading-5 text-slate-500 dark:text-slate-400">
                Confirm this was a payment to one of your cards.
              </p>
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/60">
                <p className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">Paying off a card</p>
                <p className="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-400">
                  Choose which matching payments to file as card repayments.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReview({ choice: { resolution: "mine-card" }, category: "Debt", detail: "A repayment to one of your cards." })}
                  className="mt-3 min-h-[44px] w-full rounded-xl bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white active:scale-[0.99] transition-transform disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:ring-offset-slate-900"
                >
                  Choose payment scope
                </button>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep("movement-root")}
                className="mt-3 inline-flex min-h-[44px] items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
              >
                Choose something else
                <ChevronRight size={13} className="flex-shrink-0" aria-hidden="true" />
              </button>
            </>
          )}

          {step === "spend-root" && (
            <>
              <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                Currently filed as {originalCategory}. Choose a category.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {orderedSpend.map((c) => {
                  const active = c === originalCategory;
                  const ChoiceIcon = getCategoryIcon(c, iconOverrides);
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={busy}
                      onClick={() => chooseSpend(c)}
                      className={`min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50 ${
                        active
                          ? "bg-indigo-600 text-white ring-2 ring-indigo-300 dark:ring-indigo-400/40"
                          : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      <ChoiceIcon size={14} className="mr-1.5 shrink-0" style={{ color: active ? "#ffffff" : getCategoryColour(c, colours) }} />
                      {c}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setStep("spend-naming")}
                  className="min-h-[44px] px-3 flex items-center rounded-full text-[13px] font-semibold border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 active:scale-95 transition-transform"
                >
                  Something else…
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setViaEscape(true); setStep("movement-root"); }}
                className="mt-4 inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
              >
                This was money I moved
                <ChevronRight size={13} className="flex-shrink-0" aria-hidden="true" />
              </button>
            </>
          )}

          {step === "spend-naming" && (
            <>
              <div className="mt-4 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-100 dark:ring-indigo-500/20 p-3">
                <label htmlFor={namingId} className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-300">
                  New category
                </label>
                <input
                  id={namingId}
                  name="new-category-name"
                  autoComplete="off"
                  autoFocus
                  disabled={busy}
                  value={namingText}
                  onChange={(e) => changeNamingText(e.target.value)}
                  placeholder="For example, Golf…"
                  maxLength={40}
                  className="mt-1.5 w-full h-11 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 px-3 text-[14px] font-semibold text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={namingKind === "discretionary"}
                    disabled={busy}
                    onClick={() => setNamingKind("discretionary")}
                    className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
                      namingKind === "discretionary"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    Everyday spending
                  </button>
                  <button
                    type="button"
                    aria-pressed={namingKind === "commitment"}
                    disabled={busy}
                    onClick={() => setNamingKind("commitment")}
                    className={`min-h-[36px] px-3 rounded-full text-[12px] font-semibold transition-colors ${
                      namingKind === "commitment"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    A bill I have to pay
                  </button>
                </div>
              </div>
              <div className="mt-5"><CategoryIconPicker name={namingText} kind={namingKind} value={namingIcon} onChange={setNamingIcon} disabled={busy} /></div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !namingText.trim()}
                  onClick={chooseNewCategory}
                  className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                >
                  Use this category
                </button>
                <button
                  type="button"
                  onClick={() => { setNamingText(""); setNamingIcon(null); setNamingKind("discretionary"); setStep("spend-root"); }}
                  disabled={busy}
                  className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity"
                >
                  <ChevronLeft size={13} className="flex-shrink-0" aria-hidden="true" />
                  Back
                </button>
              </div>
            </>
          )}

          {step === "scope" && draft && (
            <div className="mt-5">
              {countStatus === "error" && (
                <div className="mb-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <p role="status">Matching payments could not be checked. You can still choose this payment if it is eligible.</p>
                  <button type="button" onClick={checkCounts} disabled={busy || !!pendingRequest} className="min-h-11 rounded-lg px-1 font-semibold text-indigo-700 underline dark:text-indigo-300">Check again</button>
                </div>
              )}
              {countStatus === "unavailable" && <p role="status" className="mb-4 text-sm text-slate-700 dark:text-slate-200">This payment is unavailable for correction.</p>}
              <CorrectionScopeReview
                category={draft.category}
                detail={draft.detail}
                counts={counts}
                oneCount={oneCount}
                loading={countStatus === "loading"}
                scope={scope}
                onChange={setScope}
                onBack={changeClassification}
                disabled={busy || !!pendingRequest}
                headingRef={reviewHeading}
              />
            </div>
          )}

          {step === "done" && receipt && (
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {!receipt.undone && receipt.count > 0 && (
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Filed as {receipt.category}.</h3>
              )}
              {!receipt.undone && receipt.protectedCount > 0 && (
                <p>{paymentCount(receipt.protectedCount)} you already categorised kept {receipt.protectedCount === 1 ? "its category" : "their categories"}.</p>
              )}
              {receipt.ruleId && (
                <>
                  <p>New matching {isCredit ? "incoming" : "outgoing"} payments will be filed as {receipt.category}.</p>
                  <button type="button" onClick={() => setViewRuleId(receipt.ruleId)} disabled={busy} className="min-h-11 rounded-lg px-1 font-semibold text-indigo-700 underline dark:text-indigo-300">
                    View future rule
                  </button>
                </>
              )}
              {receipt.ruleConflict && <p role="status">The future rule changed elsewhere. Review it in Settings → Category rules.</p>}
              {receipt.refreshPending && <p role="status">Your changes are saved. The figures still need to refresh.</p>}
              {undoFailed && (
                <p className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800" role="alert">
                  Undo could not finish. Some saved changes may still be in place.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200" role="alert">{error}</p>
          )}
          </>}
        </div>
    </SheetFrame>
    {viewRuleId && (
      <CategorisationRulesSheet
        rulesOnly
        nested
        ruleId={viewRuleId}
        onClose={() => setViewRuleId(null)}
        onRuleRemoved={() => setReceipt(current => current ? { ...current, ruleId: null } : null)}
      />
    )}
    </>
  );
}
