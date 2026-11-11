"use client";

import { useId, type Ref } from "react";
import type { CorrectionScope, CorrectionScopeCounts } from "@/lib/api";
import styles from "./CorrectionScopeReview.module.css";

export function paymentCount(count: number): string {
  return `${new Intl.NumberFormat("en-GB").format(count)} ${count === 1 ? "payment" : "payments"}`;
}

type Props = {
  category: string;
  detail?: string;
  counts: CorrectionScopeCounts | null;
  oneCount: number;
  loading: boolean;
  scope: CorrectionScope;
  onChange: (scope: CorrectionScope) => void;
  onBack: () => void;
  disabled: boolean;
  headingRef: Ref<HTMLHeadingElement>;
};

export default function CorrectionScopeReview({
  category, detail, counts, oneCount, loading, scope, onChange, onBack, disabled, headingRef,
}: Props) {
  const name = useId();
  const heading = useId();
  const options: { value: CorrectionScope; label: string; detail: string; count: number | null; disabled: boolean }[] = [
    {
      value: "one",
      label: "This payment only",
      detail: oneCount
        ? "Only the selected payment changes."
        : counts?.selected_protected ? "This payment is protected." : "This payment is unavailable.",
      count: oneCount,
      disabled: oneCount === 0,
    },
    {
      value: "history",
      label: "This and earlier payments like it",
      detail: counts ? `${paymentCount(counts.earlier_count)} to this payee before or on this date. No future rule.` : "Check earlier payments to choose this.",
      count: counts?.history_count ?? null,
      disabled: !counts?.earlier_count,
    },
    {
      value: "history-future",
      label: "Earlier and future payments",
      detail: counts
        ? counts.can_save_rule
          ? `${paymentCount(counts.all_count)} now, plus a rule for new matching payments.`
          : "A rule needs an identifiable payee."
        : "Check matching payments to choose this.",
      count: counts?.all_count ?? null,
      disabled: !counts?.can_save_rule || !counts.all_count,
    },
  ];
  const count = options.find(option => option.value === scope)?.count;

  return (
    <section className={styles.panel} aria-labelledby={heading}>
      <div>
        {detail && <p className="break-words text-sm text-slate-700 dark:text-slate-300">{detail}</p>}
        <button
          type="button"
          onClick={onBack}
          disabled={disabled}
          className="min-h-11 rounded-lg px-1 text-sm font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-800 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200"
        >
          Change classification
        </button>
      </div>
      <div className={styles.receipt}>
        <h3 id={heading} ref={headingRef} tabIndex={-1} className={styles.category}>Change to {category}</h3>
        <p className={styles.impact} role="status">
          {count ? `${paymentCount(count)} will be filed as ${category}.` : "Choose an available payment scope."}
        </p>
      </div>

      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.legend}>How far should this apply?</legend>
        <div className={styles.options}>
          {options.map(option => (
            <label
              key={option.value}
              className={styles.option}
              data-selected={option.value === scope}
              data-unavailable={disabled || option.disabled}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={scope === option.value}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              <span className={styles.optionCopy}>
                <span className={styles.optionHeading}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  <span className={styles.count}>
                    {option.count === null ? (loading ? "Checking…" : "Unavailable") : paymentCount(option.count)}
                  </span>
                </span>
                <span className={styles.description}>{option.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!!counts?.protected_count && (
        <p className={styles.protection}>
          {`${paymentCount(counts.protected_count)} you already categorised will keep ${counts.protected_count === 1 ? "its category" : "their categories"}.`}
        </p>
      )}
    </section>
  );
}
