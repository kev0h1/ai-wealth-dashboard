import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import type { PennyAppearance } from "@/lib/pennyAppearance";
import styles from "./navigation/BottomNav.module.css";

/** G423 A keeps the adviser door within the rail and follows its selected appearance. */
export default function PennyLauncherButton({ appearance, resolved = true, active, open, current, paydayActive, onClick }: {
  appearance: PennyAppearance;
  /** G390: an unresolved appearance stays neutral and markless until ready. */
  resolved?: boolean;
  active: boolean;
  open: boolean;
  current: boolean;
  paydayActive: boolean;
  onClick: () => void;
}) {
  const original = resolved && appearance === "original";
  return <button
    type="button"
    onClick={onClick}
    aria-label="Penny"
    aria-current={current ? "page" : undefined}
    aria-pressed={open}
    data-penny-appearance={resolved ? appearance : "pending"}
    data-active={active}
    className={`${styles.penny}${resolved ? ` ${styles.pennyPress}` : ""}`}
    style={original ? { background: BRAND_GRADIENT } : undefined}
  >
    {resolved && (original
      ? <PennyMark size={26} className={styles.originalMark} />
      : <PennyAppearanceIcon appearance={appearance} size={26} className={styles.pennyGlyph} />)}
    {paydayActive && <span aria-hidden="true" className={styles.paydayDot} data-payday-ready />}
  </button>;
}
