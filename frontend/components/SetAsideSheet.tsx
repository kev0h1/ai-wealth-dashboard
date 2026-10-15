"use client";
import { useEffect, useRef, useState } from "react";
import { Target, Wallet, Receipt, Pencil } from "lucide-react";
import { api, Account, Allocation } from "@/lib/api";
import { SheetFrame } from "@/components/SheetFrame";
import {
  EffectiveDateField,
  FillRulePicker,
  RhythmToggle,
  type AllocationRhythm,
  type FillRuleValue,
} from "@/components/AllocationFields";
import { AccountRadioPicker } from "@/components/AccountRadioPicker";
import { isPlanSourceAccount } from "@/lib/upcomingPlans";
import { PlanAffordability, PlanContribution, PlanRouteSummary, PlanTrackingSummary } from "@/components/plans/PlanEditorSummary";
import { tidyAccountName } from "@/lib/accountName";

// The ONE door replacing Planning's three creation affordances ("+ Plan a
// big expense", "+ Allocation", "+ Plan a one-off") — Variant A from
// /design/planning-create (owner pick, 2026-08-29), transplanted faithfully:
// step 1 is three shape cards; picking "By a date" or "One payment" hands
// off to the existing CommitmentSheet/PlanOneOffSheet UNCHANGED (byte-
// identical behaviour, just reached through this door instead of their old
// ones) — those two flows are already built, tested and live, re-
// implementing their fields here would only invite drift. "An envelope" is
// the one shape whose fields actually changed (owner amendment, 2026-08-29:
// the fill rule now mirrors the offline-account rule — exact or contains —
// plus an effective-date choice), so it gets a real step 2 inside this
// sheet.

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Kind = "date" | "envelope" | "single";

const KINDS: { id: Kind; title: string; sub: string; icon: typeof Target }[] = [
  { id: "date", title: "By a date", sub: "Save toward a target, a bit each pay period", icon: Target },
  { id: "envelope", title: "An envelope", sub: "Set aside an amount, every pay period or just this one", icon: Wallet },
  { id: "single", title: "One payment", sub: "A single payment you know is coming", icon: Receipt },
];

interface SetAsideSheetProps {
  accounts: Account[];
  /** Start of the current pay period — labels the effective-date default chip. */
  periodStart: Date;
  onClose: () => void;
  /** Hands off to the existing CommitmentSheet (create mode); this sheet closes itself. */
  onSelectByDate?: () => void;
  /** Hands off to the existing PlanOneOffSheet; this sheet closes itself. */
  onSelectSingle: () => void;
  onSavedAllocation: (item: Allocation) => void;
  /** Limits the first step to period-scoped choices on Upcoming. */
  scope?: "all" | "upcoming";
  /** Injectable for fixture-only editor verification. */
  operations?: Pick<typeof api, "createAllocation" | "allocationFillCandidates">;
}

export default function SetAsideSheet({
  accounts,
  periodStart,
  onClose,
  onSelectByDate,
  onSelectSingle,
  onSavedAllocation,
  scope = "all",
  operations = api,
}: SetAsideSheetProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [step, setStep] = useState<"kind" | "envelope">("kind");
  const [view, setView] = useState<"main" | "details" | "route" | "destination" | "tracking">("main");
  const detailFocus = useRef<HTMLButtonElement>(null);
  const routeFocus = useRef<HTMLButtonElement>(null);
  const destinationFocus = useRef<HTMLButtonElement>(null);
  const trackingFocus = useRef<HTMLButtonElement>(null);
  const showEditor = step === "envelope" && view !== "main";
  const returnKey = useRef<"details" | "route" | "destination" | "tracking">("details");
  const backToMain = () => { setView("main"); requestAnimationFrame(() => { const targets = { details: detailFocus, route: routeFocus, destination: destinationFocus, tracking: trackingFocus }; targets[returnKey.current].current?.focus(); }); };

  // ── Envelope fields (step 2 of the "An envelope" path only) ──────────────
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [rhythm, setRhythm] = useState<AllocationRhythm>("every_period");
  const [accountId, setAccountId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [trackingMode, setTrackingMode] = useState<"existing_payment" | "manual">("existing_payment");
  const [rule, setRule] = useState<FillRuleValue>({ match_type: "description_contains", match_value: "", fill_display_name: "" });
  const sourceAccounts = accounts.filter((account) => (trackingMode === "manual" || account.id !== accountId) && isPlanSourceAccount(account) && account.include_in_safe_to_spend !== false && !/saving|isa|credit/.test(`${account.type} ${account.subtype ?? ""}`.toLowerCase()));
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodStartLabel = periodStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  function pickKind(kind: Kind, closeThen: (next: () => void) => void) {
    if (kind === "date") { closeThen(() => onSelectByDate?.()); return; }
    if (kind === "single") { closeThen(onSelectSingle); return; }
    setStep("envelope");
  }

  // Clear the fill rule when the account changes so a rule picked against
  // one account is never silently submitted against another.
  function pickAccount(id: string) {
    setAccountId(id);
    setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" });
    setError(null);
  }

  const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""));
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const canSave =
    !saving &&
    name.trim().length > 0 &&
    amountValid &&
    sourceAccounts.some(account => account.id === sourceId) &&
    (trackingMode === "manual" || (accountId !== "" && rule.match_value.trim().length > 0));

  async function handleSubmit(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const item = await operations.createAllocation({
        name: name.trim(),
        amount_per_period: parsedAmount,
        source_account_id: sourceId,
        fill_account_id: trackingMode === "manual" ? "" : accountId,
        match_type: trackingMode === "manual" ? "description_contains" : rule.match_type,
        match_value: trackingMode === "manual" ? "" : rule.match_value,
        fill_display_name: trackingMode === "manual" ? "" : rule.fill_display_name || undefined,
        tracking_mode: trackingMode,
        recurrence: rhythm,
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      });
      onSavedAllocation(item);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save, please try again");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  const title = step === "kind" ? "Set money aside" : "An envelope";
  const subtitle = step === "kind" ? "What shape is this?" : "Set aside an amount";

  return (
    <SheetFrame
      title={title}
      description={subtitle}
      onClose={onClose}
      dismissDisabled={saving}
      onBack={step === "envelope" ? (view === "main" ? () => setStep("kind") : backToMain) : undefined}
      footer={step === "envelope" ? ({ close }) => (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={close} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 active:scale-95 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button key={view === "main" ? "confirm" : "keep-draft"} type={view === "main" ? "submit" : "button"} onClick={view === "main" ? undefined : (event) => { event.preventDefault(); backToMain(); }} form={view === "main" ? "set-aside-envelope-form" : undefined} disabled={view === "main" ? !canSave : false} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-60">{saving ? "Saving…" : view === "main" ? (rhythm === "once" ? "Confirm this period" : "Confirm set-aside") : "Keep these changes"}</button>
        </div>
      ) : undefined}
    >
      {({ close, closeThen }) => {
        return <>
            {step === "kind" && (
              <div className="space-y-2 pb-2">
                {KINDS.filter((kind) => scope === "all" || kind.id !== "date").map((k) => {
                  const Icon = k.icon;
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => pickKind(k.id, closeThen)}
                      className="w-full min-h-[44px] flex items-center gap-3 px-3.5 py-3 rounded-2xl border border-slate-200/70 dark:border-white/[0.08] bg-slate-50/60 dark:bg-white/[0.03] text-left transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400">
                        <Icon size={16} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{k.title}</span>
                        <span className="block text-[12px] text-slate-500 dark:text-slate-400 leading-snug">{k.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {step === "envelope" && (
              <form id="set-aside-envelope-form" onSubmit={(event) => handleSubmit(event, close)} className="space-y-3">
                {view === "main" && <>
                  <PlanContribution amount={amountValid ? parsedAmount : null} cadence={rhythm === "once" ? "this pay period" : "each pay period"} />
                  <PlanAffordability>This is a planned set-aside, not a bank payment. Check Upcoming for its effect on available cash.</PlanAffordability>
                  <button ref={detailFocus} type="button" onClick={() => { returnKey.current = "details"; setView("details"); }} className="w-full border-y border-slate-200 py-4 text-left dark:border-slate-700"><span className="flex items-center justify-between gap-3"><span><strong className="block text-sm">{name || "Add a name"}</strong><small className="mt-1 block text-xs text-slate-500">{rhythm === "once" ? "Just this period" : "Every pay period"}</small></span><Pencil size={16} className="text-slate-400" /></span></button>
                  <PlanRouteSummary sourceAccount={accounts.find((account) => account.id === sourceId)} destinationAccount={trackingMode === "existing_payment" ? accounts.find((account) => account.id === accountId) : undefined} buttonRef={routeFocus} destinationButtonRef={destinationFocus} source={accounts.find((account) => account.id === sourceId) ? tidyAccountName(accounts.find((account) => account.id === sourceId)!.name) : "Choose a paying account"} destination={trackingMode === "manual" ? "Reserve in this account" : accounts.find((account) => account.id === accountId) ? tidyAccountName(accounts.find((account) => account.id === accountId)!.name) : "Choose a receiving account"} onEdit={() => { returnKey.current = "route"; setView("route"); }} onDestinationEdit={() => { returnKey.current = "destination"; setView("destination"); }} />
                  <PlanTrackingSummary buttonRef={trackingFocus} label={trackingMode === "manual" ? "Check it yourself" : rule.fill_display_name || "Choose a matching transfer"} detail={trackingMode === "manual" ? "The full amount stays reserved. No payment is matched automatically." : "Only a matching incoming transfer at the receiving account counts towards this set-aside."} onEdit={() => { returnKey.current = "tracking"; setView("tracking"); }} />
                  <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Confirming saves every choice. It does not move money.</p>
                </>}
                {showEditor && <>
                <button type="button" onClick={backToMain} className="min-h-11 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Back to summary</button>
                <PlanContribution amount={amountValid ? parsedAmount : null} cadence={rhythm === "once" ? "this pay period" : "each pay period"} />
                {view === "details" && <>
                {/* Name */}
                <div>
                  <label htmlFor="set-aside-name" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Name
                  </label>
                  <input
                    id="set-aside-name"
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setError(null); }}
                    placeholder="House deposit top-up"
                    maxLength={40}
                    required
                    className="w-full min-h-[48px] px-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm"
                  />
                </div>

                {/* Amount per period */}
                <div>
                  <label htmlFor="set-aside-amount" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    Amount per period
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400 text-sm pointer-events-none select-none">£</span>
                    <input
                      id="set-aside-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); setError(null); }}
                      placeholder="0.00"
                      required
                      className="w-full min-h-[48px] pl-7 pr-3 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 text-sm text-left tabular-nums"
                    />
                  </div>
                </div>

                <RhythmToggle value={rhythm} onChange={setRhythm} />
                </>}

                {view === "route" && <div id="allocation-route" className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                  <AccountRadioPicker accounts={sourceAccounts} value={sourceId} onChange={(id) => { setSourceId(id); setRule({ match_type: "description_contains", match_value: "", fill_display_name: "" }); setError(null); }} label="Pay from" />
                </div>}
                {view === "destination" && (trackingMode === "existing_payment" ? <AccountRadioPicker accounts={accounts.filter((account) => account.id !== sourceId)} value={accountId} onChange={pickAccount} label="Receiving account" /> : <><p className="text-sm leading-6 text-slate-600 dark:text-slate-300">This set-aside stays in the paying account. It has no receiving account.</p><button type="button" onClick={() => setView("tracking")} className="min-h-11 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Change tracking</button></>)}
                {view === "tracking" && <><fieldset><legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tracking</legend><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" aria-pressed={trackingMode === "existing_payment"} onClick={() => setTrackingMode("existing_payment")} className="min-h-11 rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/30">Match a transfer</button><button type="button" aria-pressed={trackingMode === "manual"} onClick={() => setTrackingMode("manual")} className="min-h-11 rounded-xl border border-slate-200 px-3 text-left text-sm font-semibold aria-pressed:border-indigo-600 aria-pressed:bg-indigo-50 dark:border-slate-700 dark:aria-pressed:bg-indigo-950/30">Reserve in account</button></div></fieldset>{trackingMode === "existing_payment" && accountId !== "" && <><p className="text-xs text-slate-500">Suggested payment, or choose a different payment below.</p><FillRulePicker accountId={accountId} value={rule} onChange={setRule} loadCandidates={operations.allocationFillCandidates} /></>}</>}

                {view === "details" && <EffectiveDateField
                  value={effectiveFrom}
                  periodStartLabel={periodStartLabel}
                  todayIso={todayIso()}
                  onChange={setEffectiveFrom}
                />}

                {error && (
                  <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
                )}

                </>}
              </form>
            )}
        </>;
      }}
    </SheetFrame>
  );
}
