"use client";

import { createElement } from "react";
import { ArrowLeftRight, CalendarDays, ChevronRight, CircleDot, CreditCard, PiggyBank, ReceiptText, type LucideIcon } from "lucide-react";
import { useColours } from "@/components/ColourProvider";
import MirrorFeedbackCard from "@/components/MirrorFeedbackCard";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import styles from "./preview.module.css";

export type CardProps = React.ComponentProps<typeof MirrorFeedbackCard>;

const PATTERN_ICONS: Record<string, LucideIcon> = {
  saving_habit: PiggyBank,
  orchestrator: ArrowLeftRight,
  hygiene: ReceiptText,
  front_loader: CalendarDays,
  credit_switch: CreditCard,
};

/** The real G286 card and controller, with an explicitly preview-local
 * presentation adapter. No production source/defaults are changed. The outer
 * article supplies ONE visible boundary around the card and evidence action. */
export default function PreviewTraitCard({ variant, onEvidence, selected, ...props }: CardProps & {
  variant: "a" | "b"; onEvidence(): void; selected: boolean;
}) {
  const { colours } = useColours();
  const category = props.category ?? props.trait.ref_category ?? null;
  const icon = category ? getCategoryIcon(category) : PATTERN_ICONS[props.trait.id] ?? CircleDot;
  return <article data-preview-trait={props.trait.id} data-choice={props.trait.choice ?? "unchosen"} data-variant={variant} className={styles.proposed}>
    <span data-pattern-icon={props.trait.id} aria-hidden="true" className={styles.patternIcon} style={category ? { color: getCategoryColour(category, colours) } : undefined}>
      {createElement(icon, { size: 16, strokeWidth: 2, focusable: "false" })}
    </span>
    <MirrorFeedbackCard {...props} />
    <footer className={variant === "a" ? styles.quietFooter : styles.rowFooter}>
      <button type="button" onClick={onEvidence} className={styles.evidenceAction} aria-label={`View evidence for ${props.trait.title}`} aria-controls="g302-evidence" aria-current={selected ? "true" : undefined}>
        View evidence<ChevronRight size={15} aria-hidden="true" />
      </button>
    </footer>
  </article>;
}
