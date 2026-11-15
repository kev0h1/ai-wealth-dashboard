"use client";

import { useId, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, CreditCard, Info, Landmark, RefreshCw, ShieldCheck, Star, Trash2, Wallet } from "lucide-react";
import { MaskedAmount } from "@/lib/balancesHidden";
import { connectionCaption, connectionTitle, type Model, type VariantProps } from "./fixtures";
import styles from "./AccountDetails.module.css";

export function Money({ value, hidden }: { value: number; hidden: boolean }) {
  if (hidden) return <MaskedAmount text={`${value < 0 ? "−" : ""}£••••`} className={styles.money} />;
  return <span className={styles.money}>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value).replace(/^-/, "−")}</span>;
}
export function Identity({ model, actions }: VariantProps) {
  const { account } = model;
  return <div className={styles.identity}>
    <span className={styles.bankMark} aria-hidden="true">{account.kind === "credit" ? <CreditCard size={25} /> : <Landmark size={25} />}</span>
    <div className={styles.identityText}><h3>{account.name}</h3><p>{account.bank} · {account.kind === "credit" ? "Credit card" : account.kind === "savings" ? "Savings" : "Current account"}</p><small>{account.last4 ? `Ending ${account.last4}` : "Last four digits not supplied"}{account.sortCode ? ` · ${account.sortCode}` : ""}</small></div>
    <button type="button" className={styles.iconButton} onClick={() => actions.open("identity")} aria-label="View account information"><Info size={18} aria-hidden="true" /></button>
  </div>;
}
export function NavRow({ icon, title, caption, onClick, caution = false }: { icon: ReactNode; title: string; caption: ReactNode; onClick: () => void; caution?: boolean }) {
  return <button type="button" className={styles.navRow} onClick={onClick}><span className={styles.rowIcon} aria-hidden="true">{icon}</span><span className={styles.rowText}><strong>{title}</strong><small>{caution && <span className={styles.cautionDot} aria-hidden="true" />}{caption}</small></span><ChevronRight className={styles.chevron} size={17} aria-hidden="true" /></button>;
}
export function SwitchRow({ icon, title, caption, checked, disabled, busy, onChange }: { icon: ReactNode; title: string; caption: string; checked: boolean; disabled?: boolean; busy?: boolean; onChange: () => void }) {
  const id = useId();
  return <div className={styles.switchRow}><span className={styles.rowIcon} aria-hidden="true">{icon}</span><div className={styles.rowText}><strong>{title}</strong><small id={id}>{caption}</small></div><button type="button" role="switch" aria-label={title} aria-describedby={id} aria-checked={checked} aria-busy={busy || undefined} disabled={disabled || busy} onClick={onChange} className={styles.switch}><span aria-hidden="true" className={checked ? styles.trackOn : styles.trackOff}><span /></span></button></div>;
}
export function CardRows({ model, actions }: VariantProps) {
  const method = model.paymentMethod === "full" ? "Full balance" : model.paymentMethod === "minimum" ? "Minimum payment" : "Paid manually";
  return model.account.kind === "credit" ? <><NavRow icon={<Wallet size={18} />} title="Payment" caption={`${method} · Due on the 8th`} onClick={() => actions.open("payment")} /><NavRow icon={<CreditCard size={18} />} title="Rates and deals" caption="22.9% purchase APR · 1 offer" onClick={() => actions.open("rates")} /></> : null;
}
export function InclusionRow({ model, actions }: VariantProps) {
  if (model.account.kind === "credit") return null;
  if (model.account.kind === "savings") return <div className={styles.factRow}><span className={styles.rowIcon} aria-hidden="true"><Wallet size={18} /></span><div className={styles.rowText}><strong>Left to spend</strong><small>Savings are not counted in Left to spend.</small></div><span className={styles.factValue}>Not counted</span></div>;
  if (model.state !== "healthy") return <div className={styles.factRow}><span className={styles.rowIcon} aria-hidden="true"><Wallet size={18} /></span><div className={styles.rowText}><strong>Left to spend</strong><small>{model.state === "reconnect" ? "Not counted while the bank connection has ended." : "Inclusion can be checked after the first bank update."}</small></div><span className={styles.factValue}>Not counted</span></div>;
  return <SwitchRow icon={<Wallet size={18} />} title="Include in Left to spend" caption={model.example === "locked" ? "Included because this account pays 2 upcoming items. It cannot be switched off yet." : model.included ? "Turn off for an account you do not spend from." : "This account is excluded from the estimate."} checked={model.included} disabled={model.example === "locked"} onChange={actions.toggleIncluded} />;
}
export function PinRow({ model, actions }: VariantProps) {
  return <><SwitchRow icon={<Star size={18} />} title="Pin to Home" caption={model.state === "reconnect" ? "Reconnect this account before changing its Home pin." : "Show this account in your pinned accounts."} checked={model.pinned} disabled={model.state === "reconnect"} busy={model.busy === "pin"} onChange={actions.togglePin} />{model.pinError && <p role="alert" className={styles.inlineError}>The pin could not be saved. It is still {model.pinned ? "on" : "off"}. Try the switch again.</p>}</>;
}
export function ConnectionRow({ model, actions }: VariantProps) {
  return <NavRow icon={<ShieldCheck size={18} />} title="Connection" caption={model.state === "healthy" ? model.refreshed ? "Connected · Bank data from 11:15" : "Connected · Bank data from 10:24" : model.state === "reconnect" ? "Updates stopped · Reconnect" : "Waiting for the first bank update"} caution={model.state === "reconnect"} onClick={() => actions.open("connection")} />;
}
export function ConnectionSummary({ model, actions, evidence = false }: VariantProps & { evidence?: boolean }) {
  return <div className={styles.connectionSummary}><div className={styles.stateHeading}>{model.state === "reconnect" ? <span className={styles.cautionDot} aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}<h3>{connectionTitle(model)}</h3></div><p>{connectionCaption(model)}</p>{model.state === "reconnect" ? <button type="button" className={styles.primary} onClick={() => actions.open("reconnect")}>Reconnect {model.account.bank}<ChevronRight size={16} aria-hidden="true" /></button> : <button type="button" className={styles.textButton} onClick={actions.refresh} disabled={model.busy === "refresh" || model.refreshed}><RefreshCw size={15} aria-hidden="true" />{model.busy === "refresh" ? "Checking for an update…" : model.refreshed ? "Next refresh at 12:15" : model.state === "never" ? "Check for an update" : "Refresh account"}</button>}{model.refreshError && <p role="alert">The bank could not be reached. Your recorded details are unchanged. Try refreshing again.</p>}{evidence && <ConnectionEvidence model={model} />}</div>;
}
export function ConnectionEvidence({ model }: { model: Model }) {
  return <dl className={styles.facts}><div><dt>Bank data</dt><dd>{model.state === "never" ? "Not received yet" : model.refreshed ? "15 Nov 2026 at 11:15" : model.state === "reconnect" ? "12 Nov 2026 at 16:08" : "15 Nov 2026 at 10:24"}</dd></div><div><dt>Next reconfirmation</dt><dd>{model.state === "reconnect" ? "Needed now" : model.example === "missing" ? "Date not supplied" : "12 Feb 2027"}</dd></div></dl>;
}
export function ConnectionDisclosure(props: VariantProps) {
  return <details className={styles.disclosure}><summary>Connection details<ChevronDown size={16} aria-hidden="true" /></summary><ConnectionEvidence model={props.model} /><p className={styles.helper}>Reconfirming lets your bank keep sharing this account’s data with Sorted. It does not make a payment.</p></details>;
}
export function RemoveRow({ actions }: VariantProps) {
  return <div className={styles.removeBoundary}><NavRow icon={<Trash2 size={18} />} title="Remove account" caption="Review before removing it from Sorted" onClick={() => actions.open("remove")} /></div>;
}
export function AccountFacts({ model }: { model: Model }) {
  return <dl className={styles.facts}><div><dt>Account name</dt><dd>{model.account.name}</dd></div><div><dt>Bank</dt><dd>{model.account.bank}</dd></div><div><dt>Account type</dt><dd>{model.account.product}</dd></div><div><dt>Last four digits</dt><dd>{model.account.last4 ?? "Not supplied by the bank"}</dd></div>{model.account.kind !== "credit" && <div><dt>Sort code</dt><dd>{model.account.sortCode ?? "Not supplied by the bank"}</dd></div>}</dl>;
}
export function SavedNotice({ model }: { model: Model }) { return model.notice ? <p className={styles.saved} role="status"><Check size={15} aria-hidden="true" />{model.notice}</p> : null; }
