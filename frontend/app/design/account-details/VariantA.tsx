"use client";
import type { VariantProps } from "./fixtures";
import { CardRows, ConnectionRow, Identity, InclusionRow, PinRow, RemoveRow, SavedNotice } from "./ui";
import styles from "./AccountDetails.module.css";

export default function VariantA(props: VariantProps) {
  return <div data-variant="a"><Identity {...props} /><div className={styles.passportRows}><CardRows {...props} /><ConnectionRow {...props} /><InclusionRow {...props} /><PinRow {...props} /></div><SavedNotice model={props.model} /><RemoveRow {...props} /></div>;
}
