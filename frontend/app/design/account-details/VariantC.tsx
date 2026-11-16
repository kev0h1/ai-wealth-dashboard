"use client";

import type { VariantProps } from "./fixtures";
import {
  CardRows,
  ConnectionDisclosure,
  ConnectionSummary,
  Identity,
  InclusionRow,
  PinRow,
  RemoveRow,
  SavedNotice,
} from "./ui";
import styles from "./VariantC.module.css";

/** Connection-first: restore the account's data before changing its settings. */
export default function VariantC({ model, actions }: VariantProps) {
  return (
    <div className={styles.body}>
      <Identity model={model} actions={actions} />

      <section className={styles.connection} aria-labelledby="connection-status">
        <h3 id="connection-status" className={styles.sectionTitle}>Connection</h3>
        <ConnectionSummary
          model={model}
          actions={actions}
        />
        <ConnectionDisclosure model={model} actions={actions} />
      </section>

      <section className={styles.controls} aria-labelledby="account-controls">
        <h3 id="account-controls" className={styles.sectionTitle}>Account settings</h3>
        <div className={styles.rows}>
          <CardRows model={model} actions={actions} />
          <InclusionRow model={model} actions={actions} />
          <PinRow model={model} actions={actions} />
        </div>
        <SavedNotice model={model} />
      </section>

      <RemoveRow model={model} actions={actions} />
    </div>
  );
}
