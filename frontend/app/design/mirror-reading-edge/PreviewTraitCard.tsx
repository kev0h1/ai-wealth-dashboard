"use client";

import { ChevronRight } from "lucide-react";
import MirrorFeedbackCard from "@/components/MirrorFeedbackCard";
import styles from "./preview.module.css";

export type CardProps = React.ComponentProps<typeof MirrorFeedbackCard>;

/** The real G286 card and controller, with an explicitly preview-local
 * presentation adapter. No production source/defaults are changed. The outer
 * article supplies ONE visible boundary around the card and evidence action. */
export default function PreviewTraitCard({ variant, onEvidence, selected, ...props }: CardProps & {
  variant: "a" | "b"; onEvidence(): void; selected: boolean;
}) {
  return <article data-preview-trait={props.trait.id} data-choice={props.trait.choice ?? "unchosen"} data-variant={variant} className={styles.proposed}>
    <MirrorFeedbackCard {...props} />
    <footer className={variant === "a" ? styles.quietFooter : styles.rowFooter}>
      <button type="button" onClick={onEvidence} className={styles.evidenceAction} aria-label={`View evidence for ${props.trait.title}`} aria-controls="g302-evidence" aria-current={selected ? "true" : undefined}>
        View evidence<ChevronRight size={15} aria-hidden="true" />
      </button>
    </footer>
  </article>;
}
