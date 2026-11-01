"use client";

import Link from "next/link";
import { CalendarClock, Home, PieChart, Target } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import type { PresenceVariant } from "./fixtures";
import styles from "./presence.module.css";

type PresenceDoorProps = {
  variant: PresenceVariant;
  onPennyOpen: () => void;
};

export function PresenceDoor({ variant, onPennyOpen }: PresenceDoorProps) {
  const style = variant === "c" ? undefined : { background: BRAND_GRADIENT };
  return (
    <button
      type="button"
      className={`${styles.pennyDoor} ${styles[`door${variant === "current" ? "Current" : variant.toUpperCase()}`]}`}
      style={style}
      onClick={onPennyOpen}
      aria-label="Ask Penny"
    >
      <span className={styles.doorMark} style={variant === "c" ? { background: BRAND_GRADIENT } : undefined}>
        <PennyMark size={18} />
      </span>
      {variant !== "current" && <span className={styles.doorLabel}>Penny</span>}
    </button>
  );
}

type PresenceNavProps = {
  variant: PresenceVariant;
  onAction: (label: string, route: string) => void;
  onPennyOpen: () => void;
};

/**
 * A contained facsimile of the app navigation. FixtureBottomNav is fixed to
 * the browser viewport, which would not let the design comparison sit inside
 * the phone column at desktop widths.
 */
export function PresenceNav({ variant, onAction, onPennyOpen }: PresenceNavProps) {
  const links = [
    { label: "Home", route: "/", Icon: Home },
    { label: "Spend", route: "/spend", Icon: PieChart },
    { label: "Upcoming", route: "/upcoming", Icon: CalendarClock },
    { label: "Planning", route: "/planning", Icon: Target },
  ] as const;

  return (
    <nav data-g388-nav className={styles.nav} aria-label="Preview navigation">
      <div className={styles.navSurface}>
        <div className={styles.navLinks}>
          {links.slice(0, 2).map(({ label, route, Icon }) => (
            <Link key={label} href={route} aria-current={label === "Home" ? "page" : undefined} className={`${styles.navLink} ${label === "Home" ? styles.navLinkActive : ""}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(label, route); }}>
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
          <div className={styles.navDoorSlot}><PresenceDoor variant={variant} onPennyOpen={onPennyOpen} /></div>
          {links.slice(2).map(({ label, route, Icon }) => (
            <Link key={label} href={route} className={styles.navLink} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(label, route); }}>
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
