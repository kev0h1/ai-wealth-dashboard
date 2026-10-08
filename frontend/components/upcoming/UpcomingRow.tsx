"use client";

import type { LucideIcon } from "lucide-react";
import { AlertCircle, AlertTriangle, Check, ChevronDown, Clock } from "lucide-react";
import SwipeDismissRow from "@/components/upcoming/SwipeDismissRow";
import { getUpcomingStatus, upcomingMoney, upcomingStatusText } from "@/lib/upcomingAttention";

/**
 * G176 row boundary. The default `current` treatment preserves the shipped
 * Upcoming behaviour while the named treatments let the design preview use
 * this production component. Keep cash-flow derivation and API state in the
 * planning page; this component owns only row presentation and interaction.
 */
export type UpcomingRowTreatment =
  | "current"
  | "status-shelf"
  | "exception-cluster"
  | "inline-summary"
  | "account-coverage"
  | "needs-attention";

export type UpcomingRowAfter =
  | { kind: "balance"; value: number }
  | { kind: "settling" | "pooled-transfer" | "credit-card" };

export type UpcomingRowModel = {
  rowKey: string;
  identity?: string;
  type: "bill" | "income";
  name: string;
  amount: number;
  expectedDate: string;
  originalDate?: string | null;
  category?: string | null;
  accountLabel?: string | null;
  accountBalance?: number | null;
  edited?: boolean;
  isPlanned?: boolean;
  createdViaPenny?: boolean;
  isMovement?: boolean;
  isCreditCard?: boolean;
  isSettling?: boolean;
  pending?: boolean;
  daysPastDue?: number;
  amountBasis?: "balance_estimate" | null;
  flagged?: boolean;
  timingRisk?: boolean;
  accountShort?: boolean;
  accountTiming?: boolean;
  atRisk?: boolean;
  movementCalm?: boolean;
  unfundedMovement?: boolean;
  highlighted?: boolean;
  assessment?: "unverified" | "future";
  coverage?: {
    shortfall: number;
    optionalMove?: boolean;
    before?: number;
    after?: number;
  };
  why?: {
    open: boolean;
    culprit?: { amount: number; expectedDate: string };
  };
  after: UpcomingRowAfter;
  categoryColour: string;
  CategoryIcon: LucideIcon;
};

type UpcomingRowProps = {
  model: UpcomingRowModel;
  treatment?: UpcomingRowTreatment;
  lateStatusGrouped?: boolean;
  hideAccountLabel?: boolean;
  dismissLabel?: string;
  onOpen: () => void;
  onDismiss: () => void;
  onToggleWhy?: () => void;
  onSkipOccurrence?: () => void;
};

const sym = "£";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function StatusIcon({ model, categoryOnly = false }: { model: UpcomingRowModel; categoryOnly?: boolean }) {
  if (model.flagged && !categoryOnly) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-500 dark:bg-rose-900/40" aria-hidden="true">
        <AlertTriangle size={14} />
      </span>
    );
  }
  if (model.timingRisk && !categoryOnly) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-500 dark:bg-amber-900/40 dark:text-amber-400" aria-hidden="true">
        <AlertCircle size={14} />
      </span>
    );
  }
  if (model.isSettling && !categoryOnly) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500" aria-hidden="true">
        <Clock size={14} />
      </span>
    );
  }
  const Icon = model.CategoryIcon;
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: `${model.categoryColour}26` }}
      aria-hidden="true"
    >
      <Icon size={15} style={{ color: model.categoryColour }} />
    </span>
  );
}

function RowBadge({ model }: { model: UpcomingRowModel }) {
  if (model.isPlanned) {
    return (
      <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
        planned
      </span>
    );
  }
  if (model.edited) {
    return (
      <span className="shrink-0 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
        edited
      </span>
    );
  }
  return null;
}

function CurrentSupportingCopy({
  model,
  onToggleWhy,
  onSkipOccurrence,
}: {
  model: UpcomingRowModel;
  onToggleWhy?: () => void;
  onSkipOccurrence?: () => void;
}) {
  const hasAccount = Boolean(model.accountLabel);
  const culprit = model.why?.culprit;

  return (
    <>
      {model.createdViaPenny && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">set up with Penny</p>
      )}

      {model.accountShort && hasAccount && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span className="min-w-0 truncate">
            {model.accountLabel} · only <span className="font-mono tabular-nums">{sym}{(model.accountBalance ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> available
          </span>
          {culprit && onToggleWhy && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleWhy();
              }}
              className="pointer-events-auto shrink-0 font-medium text-slate-400 underline-offset-2 hover:underline focus:outline-none focus-visible:underline dark:text-slate-500"
            >
              Why? {model.why?.open ? <ChevronDown size={10} className="inline" aria-hidden="true" /> : "›"}
            </button>
          )}
        </p>
      )}
      {model.accountShort && model.why?.open && culprit && (
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          Includes a <span className="font-mono tabular-nums">{sym}{culprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> move {formatDate(culprit.expectedDate)}
        </p>
      )}

      {model.accountTiming && hasAccount && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
          <span className="min-w-0 truncate">{model.accountLabel} · money&apos;s due in around now</span>
          {culprit && onToggleWhy && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleWhy();
              }}
              className="pointer-events-auto shrink-0 font-medium text-slate-400 underline-offset-2 hover:underline focus:outline-none focus-visible:underline dark:text-slate-500"
            >
              Why? {model.why?.open ? <ChevronDown size={10} className="inline" aria-hidden="true" /> : "›"}
            </button>
          )}
        </p>
      )}
      {model.accountTiming && model.why?.open && culprit && (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
          <span className="truncate">Includes a <span className="font-mono tabular-nums">{sym}{culprit.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> move {formatDate(culprit.expectedDate)}</span>
        </p>
      )}

      {model.atRisk && !model.accountShort && !model.accountTiming && (
        <>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Overall balance will be low</p>
          {model.type === "bill" && hasAccount && (
            <p className="truncate text-xs text-slate-400 dark:text-slate-500">{model.accountLabel}</p>
          )}
        </>
      )}

      {model.movementCalm && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
          May not go through if the balance is tight. No fee either way.
        </p>
      )}

      {model.isCreditCard && hasAccount && !model.flagged && !model.timingRisk && (
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{model.accountLabel}</p>
      )}
      {model.type === "bill" && !model.accountShort && !model.accountTiming && !model.isCreditCard && !model.atRisk && !model.movementCalm && hasAccount && (
        <p className="truncate text-xs text-slate-400 dark:text-slate-500">{model.accountLabel}</p>
      )}

      {model.type === "bill" && model.pending && (() => {
        const pendingDate = formatDate(model.originalDate ?? model.expectedDate);
        const daysPastDue = model.daysPastDue ?? 0;
        if (model.isMovement) {
          const showDismiss = Boolean(model.unfundedMovement) || daysPastDue >= 5;
          return (
            <div>
              {model.unfundedMovement ? (
                <p className="flex min-w-0 items-center gap-1.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" />
                  <span className="truncate">Planned for {pendingDate}, hasn&apos;t left. {model.accountLabel || "The account"} may not have the funds for it.</span>
                </p>
              ) : (
                <p className="text-xs leading-snug text-slate-500 dark:text-slate-400">Planned for {pendingDate}, hasn&apos;t left yet.</p>
              )}
              {showDismiss && onSkipOccurrence && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSkipOccurrence();
                  }}
                  className="pointer-events-auto mt-0.5 text-xs font-medium text-slate-500 underline-offset-2 hover:underline focus:outline-none focus-visible:underline dark:text-slate-400"
                >
                  Dismiss for this month
                </button>
              )}
            </div>
          );
        }
        if (daysPastDue >= 5) {
          const isDebt = model.category === "Debt";
          return (
            <div>
              <p className={`text-xs leading-snug ${isDebt ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
                {isDebt
                  ? `Expected ${pendingDate}, hasn't left. A missed card payment can mean fees, so worth checking today.`
                  : `Expected ${pendingDate}, we haven't seen it leave. Worth checking with them.`}
              </p>
              {onSkipOccurrence && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSkipOccurrence();
                  }}
                  className="pointer-events-auto mt-0.5 text-xs font-medium text-slate-500 underline-offset-2 hover:underline focus:outline-none focus-visible:underline dark:text-slate-400"
                >
                  Dismiss for this month
                </button>
              )}
            </div>
          );
        }
        return (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            expected {new Date(model.originalDate ?? model.expectedDate).toLocaleDateString("en-GB", { weekday: "short" })}, hasn&apos;t left yet
          </p>
        );
      })()}
    </>
  );
}

function AfterCopy({ model, compact = false }: { model: UpcomingRowModel; compact?: boolean }) {
  if (compact) return null;
  switch (model.after.kind) {
    case "settling":
      return <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Settling</p>;
    case "pooled-transfer":
      return <p className="text-xs font-medium text-slate-500 dark:text-slate-400">stays in your accounts</p>;
    case "credit-card":
      return <p className="text-xs font-medium text-slate-500 dark:text-slate-400">on your card</p>;
    case "balance":
      return (
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          After: <span className="font-mono tabular-nums">{model.after.value >= 0 ? "" : "−"}{sym}{Math.abs(model.after.value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> {model.after.value < 0 ? "short" : "left"}
        </p>
      );
  }
}

function CoverageCopy({ coverage }: { coverage: NonNullable<UpcomingRowModel["coverage"]> }) {
  if (coverage.shortfall <= 0) {
    return (
      <p className="flex items-center justify-end gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Check size={13} aria-hidden="true" />
        Covered
      </p>
    );
  }

  const status = coverage.optionalMove ? "unfunded" : "short";
  const signifier = coverage.optionalMove
    ? "bg-amber-600 dark:bg-amber-400"
    : "bg-red-600 dark:bg-red-400";

  return (
    <p className="flex items-center justify-end gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${signifier}`} aria-hidden="true" />
      <span className="font-mono tabular-nums">{sym}{coverage.shortfall.toLocaleString("en-GB", { maximumFractionDigits: 0 })}</span> {status}
    </p>
  );
}

function AttentionCopy({ model }: { model: UpcomingRowModel }) {
  const status = getUpcomingStatus(model);
  return <p className="flex items-center justify-end gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
    {status.tone !== "neutral" ? <span className={`size-1.5 shrink-0 rounded-full ${status.tone === "risk" ? "bg-red-600 dark:bg-red-400" : "bg-amber-600 dark:bg-amber-400"}`} aria-hidden="true" /> : status.kind === "covered" ? <Check size={13} aria-hidden="true" /> : null}
    <span>{status.shortfall !== undefined && <><span className="font-mono tabular-nums">{upcomingMoney(status.shortfall)}</span> </>}{status.label}</span>
  </p>;
}

export default function UpcomingRow({
  model,
  treatment = "current",
  lateStatusGrouped = false,
  hideAccountLabel = false,
  dismissLabel = model.isPlanned ? "Delete" : "Not recurring",
  onOpen,
  onDismiss,
  onToggleWhy,
  onSkipOccurrence,
}: UpcomingRowProps) {
  const isCurrent = treatment === "current";
  const isAttention = treatment === "needs-attention";
  const isAccountCoverage = treatment === "account-coverage" || isAttention;
  const compact = treatment === "exception-cluster";
  const amountSign = model.type === "income" ? "+" : "−";
  const coverageStatus = isAttention ? upcomingStatusText(getUpcomingStatus(model)) : model.coverage
    ? model.coverage.shortfall <= 0
      ? "covered"
      : `${sym}${model.coverage.shortfall.toLocaleString("en-GB", { maximumFractionDigits: 0 })} ${model.coverage.optionalMove ? "unfunded" : "short"}`
    : null;
  const accountCoverageLabel = `Open details for ${model.name}${model.accountLabel ? ` ${model.type === "income" ? "into" : "from"} ${model.accountLabel}` : ""}, ${amountSign}${sym}${model.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${coverageStatus ? `, ${coverageStatus}` : ""}`;

  const content = (
    <div
      data-bill-key={model.rowKey}
      className={`relative${model.highlighted ? " ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={isAccountCoverage ? accountCoverageLabel : model.isPlanned ? `Edit planned payment: ${model.name}` : isCurrent ? `Edit ${model.name}` : `Open details for ${model.name}`}
        className="absolute inset-0 z-0 cursor-pointer transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 active:bg-slate-100 dark:hover:bg-slate-700/40 dark:active:bg-slate-700/60"
      />
      <div className={`pointer-events-none relative z-[1] flex gap-3 px-4 ${compact ? "items-start py-2.5" : "items-center py-3"} ${!isCurrent ? "max-[350px]:grid max-[350px]:grid-cols-[2rem_minmax(0,1fr)] max-[350px]:items-start max-[350px]:gap-y-0" : ""}`}>
        <StatusIcon model={model} categoryOnly={isAccountCoverage && !model.isSettling} />

        <div className={`min-w-0 flex-1 ${!isCurrent ? "max-[350px]:col-start-2 max-[350px]:row-start-1" : ""}`}>
          {isCurrent ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{model.name}</p>
              <RowBadge model={model} />
            </div>
          ) : (
            <>
              <p className="break-words text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{model.name}</p>
              {!(isAccountCoverage && hideAccountLabel && !model.isPlanned && !model.edited) && (
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <RowBadge model={model} />
                  {model.accountLabel && !(isAccountCoverage && hideAccountLabel) && (
                    <p className="min-w-0 text-xs leading-4 text-slate-500 dark:text-slate-400">{model.accountLabel}</p>
                  )}
                </div>
              )}
            </>
          )}

          {isCurrent && !lateStatusGrouped && (
            <CurrentSupportingCopy
              model={model}
              onToggleWhy={onToggleWhy}
              onSkipOccurrence={onSkipOccurrence}
            />
          )}
        </div>

        <div className={`shrink-0 text-right ${!isCurrent ? "max-[350px]:col-start-2 max-[350px]:row-start-2 max-[350px]:justify-self-end max-[350px]:pt-1" : ""}`}>
          <p className={`font-mono text-base tabular-nums ${
            isAttention && model.isSettling
              ? "font-semibold text-slate-600 dark:text-slate-400"
              : isAccountCoverage
              ? "font-bold text-slate-800 dark:text-slate-100"
              : model.type === "income"
              ? "font-bold text-emerald-500"
              : model.flagged
                ? "font-bold text-rose-600 dark:text-rose-400"
                : model.isSettling
                  ? "font-semibold text-slate-500 dark:text-slate-400"
                  : "font-bold text-slate-800 dark:text-slate-100"
          }`}>
            {amountSign}{model.amountBasis === "balance_estimate" && isCurrent ? "~" : ""}{sym}{model.amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {model.amountBasis === "balance_estimate" && !isCurrent && (
            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500">estimated</p>
          )}
          {isAttention ? <AttentionCopy model={model} /> : isAccountCoverage && model.coverage ? <CoverageCopy coverage={model.coverage} /> : <AfterCopy model={model} compact={compact} />}
        </div>
      </div>
    </div>
  );

  if (!isCurrent && !isAttention) return content;

  return (
    <SwipeDismissRow onDismiss={onDismiss} label={dismissLabel}>
      {content}
    </SwipeDismissRow>
  );
}
