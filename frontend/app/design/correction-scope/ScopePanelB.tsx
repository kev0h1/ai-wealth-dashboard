"use client";

import type { ScopePanelProps } from "./model";
import styles from "./variant-b.module.css";

function paymentNoun(count: number): string {
  return count === 1 ? "payment" : "payments";
}

export default function ScopePanelB({
  options,
  scope,
  onChange,
  category,
  protectedCount,
  disabled = false,
}: ScopePanelProps) {
  const selected = options.find((option) => option.value === scope);
  const selectedCount = selected?.count ?? null;
  const impact = selectedCount === null
    ? "Check matching payments before choosing how far this applies."
    : `${selectedCount} ${paymentNoun(selectedCount)} will be filed as ${category}.`;

  return (
    <section className={styles.panel} aria-labelledby="scope-b-heading">
      <div className={styles.receipt} aria-live="polite">
        <p className={styles.category}>Change to {category}</p>
        <p className={styles.impact}>{impact}</p>
      </div>

      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend id="scope-b-heading" className={styles.legend}>How far should this apply?</legend>
        <p className={styles.intro}>Choose which matching payments should use this classification.</p>
        <div className={styles.options}>
          {options.map((option) => {
            const selectedOption = option.value === scope;
            const unavailable = disabled || option.disabled;
            return (
              <label
                key={option.value}
                className={styles.option}
                data-selected={selectedOption}
                data-unavailable={unavailable}
              >
                <input
                  type="radio"
                  name="correction-scope-b"
                  value={option.value}
                  checked={selectedOption}
                  disabled={unavailable}
                  onChange={() => onChange(option.value)}
                />
                <span className={styles.optionCopy}>
                  <span className={styles.optionHeading}>
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.count === null ? (
                      <span className={styles.checking}>Checking</span>
                    ) : (
                      <span className={styles.count}>{option.count} {paymentNoun(option.count)}</span>
                    )}
                  </span>
                  <span className={styles.description}>{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {protectedCount > 0 ? (
        <p className={styles.protection}>
          {protectedCount} {paymentNoun(protectedCount)} you already categorised will stay as {protectedCount === 1 ? "it is" : "they are"}.
        </p>
      ) : null}
    </section>
  );
}
