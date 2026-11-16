"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Info, Star, Trash2 } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import { SheetFrame } from "@/components/SheetFrame";
import type { Account } from "@/lib/api";
import styles from "./AccountDetailsContent.module.css";

export interface AccountDetailsContentProps {
  account: Account;
  name: string;
  providerLabel: string;
  kindLabel: string;
  controlsTitle: string;
  cardRows?: ReactNode;
  inclusion?: ReactNode;
  actions?: ReactNode;
  connection?: ReactNode;
  connectionDetails?: ReactNode;
  pinned: boolean;
  showPin: boolean;
  pinDisabledReason?: string;
  pinBusy?: boolean;
  onTogglePin: () => void;
  pinMessage?: ReactNode;
  deleting: boolean;
  onRemove: () => void;
}

export interface AccountDetailsPreferenceRowProps {
  icon: ReactNode;
  title: string;
  caption: ReactNode;
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: () => void;
  error?: string | null;
}

/** A switch row whose consequence stays with the preference it describes. */
export function AccountDetailsPreferenceRow({
  icon, title, caption, checked, disabled = false, busy = false, onChange, error,
}: AccountDetailsPreferenceRowProps) {
  const captionId = useId();
  const errorId = useId();
  const describedBy = error ? `${captionId} ${errorId}` : captionId;
  return <div data-account-details-row className={styles.preferenceWrap}>
    <div className={styles.pinRow}>
      <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
      <span className={styles.rowCopy}><strong>{title}</strong><small id={captionId}>{caption}</small></span>
      <button type="button" className={styles.switch} role="switch" aria-label={title} aria-describedby={describedBy} aria-checked={checked} aria-busy={busy || undefined} disabled={disabled || busy} onClick={onChange}><span className={styles.track} data-checked={checked} aria-hidden="true" /></button>
    </div>
    {error ? <p id={errorId} role="alert" className={styles.rowError}>{error}</p> : null}
  </div>;
}

export interface AccountDetailsFactRowProps {
  icon: ReactNode;
  title: string;
  caption: ReactNode;
  value?: string;
}

/** A fact row, used where there is no action a switch could truthfully make. */
export function AccountDetailsFactRow({ icon, title, caption, value }: AccountDetailsFactRowProps) {
  return <div data-account-details-row className={styles.factRow}>
    <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
    <span className={styles.rowCopy}><strong>{title}</strong><small>{caption}</small></span>
    {value ? <span className={styles.factValue}>{value}</span> : null}
  </div>;
}

function maskedAccountFacts(account: Account) {
  const lastFour = account.account_number?.slice(-4);
  const accountFact = lastFour ? `Ending ${lastFour}` : undefined;
  return [accountFact, account.sort_code].filter(Boolean).join(" · ");
}

/** Approved G474 B: grouped controls, then connection evidence, then removal. */
export default function AccountDetailsContent({
  account, name, providerLabel, kindLabel, controlsTitle, cardRows, inclusion, actions,
  connection, connectionDetails, pinned, showPin, pinDisabledReason, pinBusy,
  onTogglePin, pinMessage, deleting, onRemove,
}: AccountDetailsContentProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const closeInfo = useRef<(() => void) | null>(null);
  const accountFacts = maskedAccountFacts(account);
  const controls = [cardRows, inclusion, showPin ? <AccountDetailsPreferenceRow key="pin" icon={<Star size={18} />} title="Pin to Home" caption={pinDisabledReason ?? "Show this account in your pinned accounts."} checked={pinned} disabled={Boolean(pinDisabledReason)} busy={pinBusy} onChange={onTogglePin} error={typeof pinMessage === "string" ? pinMessage : null} /> : null, actions].filter(Boolean);
  return <div className={styles.surface} data-g474-account-details>
    <section className={styles.identity} aria-label="Account identity">
      <BankIcon identity={account} size={44} altText="" />
      <div className={styles.identityCopy}><h3>{name}</h3><p>{providerLabel} · {kindLabel}</p>{accountFacts ? <small>{accountFacts}</small> : <small>Account identifiers not supplied</small>}</div>
      <button type="button" className={styles.info} aria-label="View account information" onClick={() => setInfoOpen(true)}><Info size={18} aria-hidden="true" /></button>
    </section>
    {controls.length > 0 ? <section className={styles.group} aria-label={controlsTitle}><h3 className={styles.groupTitle}>{controlsTitle}</h3><div className={styles.grouped}>{controls}</div>{pinMessage && typeof pinMessage !== "string" ? <p className={styles.notice} role="status">{pinMessage}</p> : null}</section> : null}
    {(connection || connectionDetails) ? <section className={styles.connection} aria-label="Bank connection"><h3 className={styles.groupTitle}>Bank connection</h3>{connection ? <div className={styles.connectionSlot}>{connection}</div> : null}{connectionDetails ? <details className={styles.disclosure}><summary><span>Connection details</span><ChevronDown size={16} aria-hidden="true" /></summary><div className={styles.detailsBody}>{connectionDetails}</div></details> : null}</section> : null}
    <div className={styles.remove} data-after-connection={Boolean(connectionDetails)}><button type="button" data-account-details-row className={styles.removeRow} disabled={deleting} onClick={onRemove}><Trash2 className={styles.rowIcon} size={18} aria-hidden="true" /><span className={styles.rowCopy}><strong>Remove account</strong><small>Review before removing it from Sorted</small></span><ChevronRight size={16} aria-hidden="true" /></button></div>
    {infoOpen ? <SheetFrame title="Account information" mobileFullScreen nested onClose={() => setInfoOpen(false)} onBack={() => closeInfo.current?.()} backLabel="Back to Account details" footer={({ close }) => <button type="button" className={styles.done} onClick={close}>Done</button>}>
      {({ close }) => { closeInfo.current = close; return <dl className={`${styles.surface} ${styles.identityFacts}`}><div><dt>Account name</dt><dd>{name}</dd></div><div><dt>Bank or source</dt><dd>{providerLabel || "Not supplied"}</dd></div><div><dt>Account type</dt><dd>{kindLabel}</dd></div><div><dt>Last four digits</dt><dd>{account.account_number?.slice(-4) || "Not supplied"}</dd></div><div><dt>Sort code</dt><dd>{account.sort_code || "Not supplied"}</dd></div></dl>; }}
    </SheetFrame> : null}
  </div>;
}
