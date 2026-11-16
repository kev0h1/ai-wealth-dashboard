"use client";
import type { VariantProps } from "./fixtures";
import { CardRows, ConnectionDisclosure, ConnectionSummary, Identity, InclusionRow, PinRow, RemoveRow, SavedNotice } from "./ui";
import styles from "./AccountDetails.module.css";

export default function VariantB(props: VariantProps) {
  return <div data-variant="b"><Identity {...props} />
    <section className={styles.group} aria-label="Account controls"><h3>{props.model.account.kind === "credit" ? "Card and Home" : "Home and Left to spend"}</h3><div className={styles.groupedRows}><CardRows {...props} /><InclusionRow {...props} /><PinRow {...props} /></div></section>
    <section className={styles.group} aria-label="Bank connection"><h3>Bank connection</h3><ConnectionSummary {...props} /><ConnectionDisclosure {...props} /></section>
    <SavedNotice model={props.model} /><RemoveRow {...props} />
  </div>;
}
