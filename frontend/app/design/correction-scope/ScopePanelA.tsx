import type { ScopePanelProps } from "./model";
import styles from "./preview.module.css";

export default function ScopePanelA({ options, scope, onChange, protectedCount, disabled }: ScopePanelProps) {
  return <fieldset className={styles.scopeList} disabled={disabled}>
    <legend className="sr-only">Which payments should change?</legend>
    {options.map(option => <label key={option.value} className={`${styles.scopeChoice} ${scope === option.value ? styles.selected : ""}`}>
      <input type="radio" name="correction-scope-a" value={option.value} checked={scope === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
      <span><strong>{option.label}</strong><small>{option.description}</small></span>
      <span className={styles.count}>{option.count === null ? "Checking…" : option.count}</span>
    </label>)}
    <p className={styles.protection}>{protectedCount} {protectedCount === 1 ? "payment you already categorised stays" : "payments you already categorised stay"} unchanged.</p>
  </fieldset>;
}
