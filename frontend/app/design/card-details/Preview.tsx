"use client";

// Synthetic, session-only design proposal. No API calls or bank actions.
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Eye, EyeOff, Pin, RefreshCw, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { BANK_META, BankBadge, bankKey, bankLogoSrc } from "@/components/AccountMiniCard";
import { SheetFrame } from "@/components/SheetFrame";
import { ACCOUNT_IDS, EXAMPLE_CONTEXT, FIXTURES, money, ordinal, PAYMENT_METHODS, PAYING_ACCOUNTS, paymentLabel, statementDatesPresent, type AccountFixture, type AccountId, type PaymentSettings } from "./fixtures";
import Rates, { initialRates, type RatesRecord } from "./Rates";
import styles from "./preview.module.css";

type Variant = "a" | "b";
type SessionRecord = { settings: PaymentSettings; rates: RatesRecord; counted: boolean; name: string; balance: number };
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function Identity({ account }: { account: AccountFixture }) {
  const key = bankKey({ provider: account.bank });
  const meta = BANK_META[key];
  return <BankBadge logoSrc={bankLogoSrc(meta)} initials={meta?.initials ?? ""} initialsSize={meta?.initialsSize} altText={`${account.bank} logo`} brandBg={meta?.bg} size={40} resetKey={key} />;
}
function Amount({ value, hidden }: { value: number; hidden: boolean }) {
  return <span className={styles.money} aria-label={hidden ? "Amount hidden" : undefined}>{money(value, hidden)}</span>;
}
function link(params: URLSearchParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  Object.entries(changes).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, value));
  return `?${next}`;
}
function Radio({ selected, onChange, children, name, value }: { selected: boolean; onChange: () => void; children: ReactNode; name: string; value: string }) {
  return <label className={`${styles.radio} ${selected ? styles.selected : ""}`}>
    <input type="radio" name={name} value={value} checked={selected} onChange={onChange} />
    <span>{children}</span>
  </label>;
}
function Days({ label, value, onChange, closeDay = false }: { label: string; value: number | null; onChange: (value: number | null) => void; closeDay?: boolean }) {
  return <details className={styles.dayPicker} data-g412-close-day={closeDay ? "true" : undefined}>
    <summary><span>{label}<strong>{value === null ? "Not set" : `${ordinal(value)} each month`}</strong></span><ChevronDown size={18} aria-hidden="true" /></summary>
    <fieldset className={styles.days}><legend className="sr-only">{label}</legend><div>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={value === null ? styles.selected : ""}>Not set</button>
      {Array.from({ length: 31 }, (_, index) => index + 1).map(day => <button key={day} type="button" aria-pressed={value === day} onClick={() => onChange(day)} className={value === day ? styles.selected : ""}>{day}</button>)}
    </div></fieldset>
  </details>;
}
function PaymentForm({ initial, hidden, onSave }: { initial: PaymentSettings; hidden: boolean; onSave: (value: PaymentSettings) => void }) {
  const [draft, setDraft] = useState({ ...initial });
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const edit = (patch: Partial<PaymentSettings>) => { setDraft(current => ({ ...current, ...patch })); setError(null); };
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let issue: typeof error = null;
    if (draft.dueMode === "offset" && draft.dueOffset !== null && (!Number.isInteger(draft.dueOffset) || draft.dueOffset < 1 || draft.dueOffset > 366)) {
      issue = { field: "g412-offset", message: "Enter a whole number of days between 1 and 366, or leave it blank." };
    } else if (draft.method === "fixed" && (!draft.fixedAmount.trim() || !Number.isFinite(Number(draft.fixedAmount)) || Number(draft.fixedAmount) <= 0)) {
      issue = { field: "g412-fixed", message: "Enter the fixed amount you have arranged, greater than £0." };
    }
    if (issue) { setError(issue); document.getElementById(issue.field)?.focus(); return; }
    onSave(draft);
  }
  return <form id="g412-payment-form" data-g412-payment-form="true" className={styles.form} onSubmit={submit} noValidate>
    <h3 tabIndex={-1}>Payment details</h3>
    <p className={styles.helper}>Copy these from your card statement. Dates are optional. This does not change your bank instructions.</p>
    <Days label="Statement closing day" value={draft.closeDay} onChange={closeDay => edit({ closeDay })} closeDay />
    <fieldset className={styles.fieldset}><legend>When is the payment due?</legend><div className={styles.stack}>
      <Radio name="due" value="day" selected={draft.dueMode === "day"} onChange={() => edit({ dueMode: "day" })}><strong>A day of the month</strong></Radio>
      <Radio name="due" value="offset" selected={draft.dueMode === "offset"} onChange={() => edit({ dueMode: "offset" })}><strong>Days after the statement closes</strong></Radio>
    </div>
      {draft.dueMode === "day" ? <Days label="Payment due day" value={draft.dueDay} onChange={dueDay => edit({ dueDay })} /> :
        <label className={styles.input}>Days after close<input id="g412-offset" name="dueOffset" autoComplete="off" inputMode="numeric" value={draft.dueOffset ?? ""} aria-invalid={error?.field === "g412-offset" || undefined} aria-describedby={error?.field === "g412-offset" ? "payment-error" : undefined} onChange={event => edit({ dueOffset: event.target.value === "" ? null : Number(event.target.value) })} /></label>}
    </fieldset>
    <fieldset className={styles.fieldset}><legend>How do you pay?</legend><div className={styles.stack}>{PAYMENT_METHODS.map(method =>
      <Radio key={method.value} name="method" value={method.value} selected={draft.method === method.value} onChange={() => edit({ method: method.value })}><strong>{method.label}</strong><small>{method.detail}</small></Radio>
    )}</div></fieldset>
    {draft.method === "fixed" && <label className={styles.input}>Fixed payment (£)<input id="g412-fixed" name="fixedAmount" autoComplete="off" inputMode="decimal" disabled={hidden} value={hidden ? "" : draft.fixedAmount} placeholder={hidden ? "Show figures to edit" : "0.00"} aria-invalid={error?.field === "g412-fixed" || undefined} aria-describedby={error?.field === "g412-fixed" ? "payment-error" : undefined} onChange={event => edit({ fixedAmount: event.target.value })} /></label>}
    <fieldset className={styles.fieldset}><legend>Which account pays it?</legend><div className={styles.stack}>{PAYING_ACCOUNTS.map(source =>
      <Radio key={source} name="source" value={source} selected={draft.source === source} onChange={() => edit({ source })}><strong>{source}</strong></Radio>
    )}</div></fieldset>
    {error && <p id="payment-error" className={styles.error} role="alert">{error.message}</p>}
  </form>;
}
function Bill({ account, settings, hidden }: { account: AccountFixture; settings: PaymentSettings; hidden: boolean }) {
  if (!account.statement || !statementDatesPresent(settings)) return null;
  const original = account.settings;
  const datesChanged = settings.closeDay !== original.closeDay || settings.dueMode !== original.dueMode || (settings.dueMode === "day" ? settings.dueDay !== original.dueDay : settings.dueOffset !== original.dueOffset);
  if (datesChanged) return <section className={styles.bill} data-g412-estimate="unavailable"><h3>Estimate needs updating</h3><p className={styles.helper}>Your dates have changed. This design preview cannot calculate a new bill.</p></section>;
  const statement = account.statement;
  const payment = settings.method === "full" ? statement.amount : settings.method === "fixed" ? Number(settings.fixedAmount) : null;
  const timing = statement.dueBeforePayday ? "Before your next payday on 27 Nov" : "After your next payday on 27 Nov";
  return <section className={styles.bill} data-g412-estimate="available">
    <div className={styles.sectionHeading}><h3>{payment === null ? "Estimated statement bill" : `Payment due ${statement.due}`}</h3>{payment === null ? null : <Amount value={payment} hidden={hidden} />}</div>
    {payment === null ? <p className={styles.billAmount}><Amount value={statement.amount} hidden={hidden} /></p> : <p className={styles.helper}>{settings.method === "full" ? "Estimated bill. " : "Arranged fixed payment. "}{timing}.</p>}
    {settings.method === "minimum" && <p className={styles.helper}>The minimum payment is not known. The statement balance is not treated as the minimum.</p>}
    {settings.method === "manual" && <p className={styles.helper}>No automatic payment is assumed. Record a payment separately when you plan it.</p>}
    <dl className={styles.rows}>
      <div><dt>Statement period</dt><dd>{statement.start} to {statement.close}</dd></div>
      {settings.method === "fixed" && <div><dt>Estimated statement bill</dt><dd><Amount value={statement.amount} hidden={hidden} /></dd></div>}
      <div><dt>Paid from</dt><dd>{settings.source}</dd></div>
      <div><dt>Since statement close</dt><dd><Amount value={statement.nextSpending} hidden={hidden} /></dd></div>
    </dl>
    <p className={styles.helper}>New spending belongs to the next bill, not this one. Check your card statement for the exact amount, including any refunds, interest and fees.</p>
    {account.id === "corporate" && /Barclays|NatWest/.test(settings.source) && <p className={styles.helper}>Paid from personal cash, so this business card payment still counts.</p>}
  </section>;
}
function PaymentRecord({ settings, edit }: { settings: PaymentSettings; edit: () => void }) {
  return <section className={styles.section} data-g412-section="payment">
    <div className={styles.sectionHeading}><h3>Payment details</h3><button type="button" className={styles.linkButton} data-g412-edit-payment="true" onClick={edit}>Edit</button></div>
    <dl className={styles.rows}>
      <div><dt>Statement closes</dt><dd>{settings.closeDay ? `${ordinal(settings.closeDay)} each month` : "Not set"}</dd></div>
      <div><dt>Payment due</dt><dd>{settings.dueMode === "day" ? settings.dueDay ? `${ordinal(settings.dueDay)} each month` : "Not set" : settings.dueOffset ? `${settings.dueOffset} days after close` : "Not set"}</dd></div>
      <div><dt>How you pay</dt><dd>{paymentLabel(settings)}</dd></div>
      <div><dt>Paying account</dt><dd>{settings.source}</dd></div>
    </dl>
  </section>;
}
function Inclusion({ account, value, onChange }: { account: AccountFixture; value: boolean; onChange: (value: boolean) => void }) {
  return <section className={styles.section}>
    <div className={styles.switchRow}><span id="g412-inclusion">Count towards Left to spend</span><button type="button" role="switch" aria-labelledby="g412-inclusion" aria-describedby="g412-inclusion-help" aria-checked={value} disabled={!!account.lockedReason} className={styles.switch} onClick={() => onChange(!value)}><span /></button></div>
    <p id="g412-inclusion-help" className={styles.helper}>{account.lockedReason ?? "Include this balance in the estimate. This does not move any money."}</p>
  </section>;
}
function OfflineForm({ initial, hidden, onSave }: { initial: SessionRecord; hidden: boolean; onSave: (value: SessionRecord) => void }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  return <form id="g412-offline-form" className={styles.form} onSubmit={event => {
    event.preventDefault();
    if (!draft.name.trim()) { setError("Enter an account name."); document.getElementById("offline-name")?.focus(); return; }
    onSave(draft);
  }}>
    <h3 tabIndex={-1}>Edit offline account</h3>
    <label className={styles.input}>Account name<input id="offline-name" name="accountName" autoComplete="off" value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setError(""); }} aria-invalid={!!error || undefined} aria-describedby={error ? "offline-error" : undefined} /></label>
    <label className={styles.input}>Balance (£)<input name="balance" inputMode="decimal" autoComplete="off" disabled={hidden} value={hidden ? "" : draft.balance} placeholder={hidden ? "Show figures to edit" : "0.00"} type="number" step="0.01" required onChange={event => setDraft({ ...draft, balance: Number(event.target.value) })} /></label>
    {error && <p id="offline-error" role="alert" className={styles.error}>{error}</p>}
  </form>;
}
function Connection({ account }: { account: AccountFixture }) {
  const [pinned, setPinned] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  return <section className={styles.section} data-g412-section="connection">
    {account.connectedUntil && <><h3>Connection</h3><dl className={styles.rows}>
      <div><dt>Connected until</dt><dd>{account.connectedUntil}</dd></div>
      <div><dt>Bank data updated</dt><dd>{account.updated}</dd></div>
    </dl></>}
    <div className={styles.actions}>
      {account.connectedUntil && <button type="button" onClick={() => setMessage("Preview only. Your bank connection has not been refreshed.")}><RefreshCw size={18} aria-hidden="true" />Refresh bank data</button>}
      <button type="button" onClick={() => { setPinned(!pinned); setMessage(pinned ? "Unpinned in this preview." : "Pinned in this preview."); }}><Pin size={18} aria-hidden="true" />{pinned ? "Unpin account" : "Pin account"}</button>
      <button type="button" className={styles.destructive} onClick={() => setConfirm(true)}><Trash2 size={18} aria-hidden="true" />Remove account</button>
    </div>
    {confirm && <div className={styles.confirm}><h4>Remove this account?</h4><p>This only demonstrates the confirmation. No account will be removed.</p><div className={styles.formActions}><button type="button" className={styles.secondary} onClick={() => setConfirm(false)}>Keep account</button><button type="button" className={styles.secondary} onClick={() => { setConfirm(false); setMessage("Removal demonstrated. No account was changed."); }}>Confirm removal</button></div></div>}
    {message && <p role="status" className={styles.helper}>{message}</p>}
  </section>;
}
function Disclosure({ title, subtitle, children, open = false, onOpenChange }: { title: string; subtitle: string; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return <details className={styles.disclosure} open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)}><summary><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronDown size={18} aria-hidden="true" /></summary><div>{children}</div></details>;
}
function Details({ account, value, variant, hidden, close, onChange }: { account: AccountFixture; value: SessionRecord; variant: Variant; hidden: boolean; close: () => void; onChange: (value: SessionRecord) => void }) {
  const [editing, setEditing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [ratesEditing, setRatesEditing] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => { if (editing) document.querySelector<HTMLElement>("[data-g412-sheet] form h3")?.focus(); }, [editing]);
  useEffect(() => { if (ratesEditing) document.getElementById("g412-apr")?.focus(); }, [ratesEditing]);
  const stopEditing = () => { setEditing(false); setPaymentOpen(true); requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-g412-edit-payment]")?.focus()); };
  const save = (next: SessionRecord) => { onChange(next); stopEditing(); setStatus("Saved in this preview only."); };
  const payment = <><Bill account={account} settings={value.settings} hidden={hidden} /><PaymentRecord settings={value.settings} edit={() => setEditing(true)} /></>;
  const changeRatesEditing = (next: boolean) => { setRatesEditing(next); if (!next) { setRatesOpen(true); requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-g412-edit-rates]")?.focus()); } };
  const rates = <Rates account={account} hidden={hidden} value={value.rates} editing={ratesEditing} onEditingChange={changeRatesEditing} embedded={variant === "b" && !ratesEditing} onChange={rates => { onChange({ ...value, rates }); setStatus("Rates saved in this preview only."); }} />;
  const datesMatch = value.settings.closeDay === account.settings.closeDay && value.settings.dueMode === account.settings.dueMode && (value.settings.dueMode === "day" ? value.settings.dueDay === account.settings.dueDay : value.settings.dueOffset === account.settings.dueOffset);
  const paymentAmount = value.settings.method === "full" ? account.statement?.amount : value.settings.method === "fixed" ? Number(value.settings.fixedAmount) : undefined;
  const paymentSummary = statementDatesPresent(value.settings) && datesMatch && paymentAmount !== undefined ? `${money(paymentAmount, hidden)} due ${account.statement?.due}${value.settings.method === "full" ? " · estimated" : " · fixed"}` : paymentLabel(value.settings);
  const footer = editing ? <div className={styles.formActions}><button type="button" className={styles.secondary} data-g412-cancel="true" onClick={stopEditing}>Cancel</button><button form={account.kind === "card" ? "g412-payment-form" : "g412-offline-form"} type="submit" className={styles.primary} data-g412-save="true">Save details</button></div> : ratesEditing ? <div className={styles.formActions}><button form="g412-rates-form" type="reset" className={styles.secondary}>Cancel</button><button form="g412-rates-form" type="submit" className={styles.primary}>Save rates and deals</button></div> : null;
  return <SheetFrame variant="focused" title="Account details" leading={<Identity account={account} />} onClose={close} bodyClassName="px-5 pb-6" themeClass={styles.sheetTheme} footer={footer}>
    <div className={styles.sheet} data-g412-sheet="true">
      <div className={styles.accountHead}><h2>{value.name}</h2><p>{account.subtitle}</p><p className={styles.balanceLabel}>{account.kind === "offline" ? "Recorded balance" : "Bank balance"}</p><p className={styles.balance}><Amount value={value.balance} hidden={hidden} /></p></div>
      {editing ? account.kind === "card" ? <PaymentForm initial={value.settings} hidden={hidden} onSave={settings => save({ ...value, settings })} /> : <OfflineForm initial={value} hidden={hidden} onSave={save} /> : ratesEditing ? rates : <>
        {account.kind === "card" ? variant === "a" ? <>{payment}{rates}<Connection account={account} /></> : <>
          <Disclosure title="Statement and payment" subtitle={paymentSummary} open={paymentOpen} onOpenChange={setPaymentOpen}>{payment}</Disclosure>
          <Disclosure title="Rates and deals" subtitle={account.id === "corporate" ? "Charge card" : `${value.rates.apr || "Not recorded"}${value.rates.apr ? "% APR" : ""}`} open={ratesOpen} onOpenChange={setRatesOpen}>{rates}</Disclosure>
          <Disclosure title="Connection and account actions" subtitle="Bank data, pin and remove"><Connection account={account} /></Disclosure>
        </> : <>
          {account.kind === "offline" && <section className={styles.section}><div className={styles.sectionHeading}><h3>Account record</h3><button type="button" className={styles.linkButton} data-g412-edit-payment="true" onClick={() => setEditing(true)}>Edit</button></div><p className={styles.helper}>You update this balance yourself. There is no bank connection.</p></section>}
          <Inclusion account={account} value={value.counted} onChange={counted => { onChange({ ...value, counted }); setStatus("Account setting saved in this preview only."); }} />
          <Connection account={account} />
        </>}
      </>}
      {status && <p className={styles.status} role="status">{status}</p>}
      <p className={styles.previewNote}>Design preview. No bank details or payments are changed.</p>
    </div>
  </SheetFrame>;
}
function Landing({ account, hidden, open }: { account: AccountFixture; hidden: boolean; open: () => void }) {
  return <section className={styles.landing}>
    <div className={styles.sample}><Identity account={account} /><div><h2>{account.name}</h2><p>{account.subtitle}</p></div></div>
    <p className={styles.balance}><Amount value={account.balance} hidden={hidden} /></p>
    <button type="button" className={styles.primary} data-g412-open-details="true" onClick={open}>Open account details<ChevronRight size={18} aria-hidden="true" /></button>
    <p className={styles.helper}>{EXAMPLE_CONTEXT}</p>
    {account.kind === "card" && <details className={styles.disclosure}><summary><strong>Example: inside the Home calculation</strong><ChevronDown size={18} aria-hidden="true" /></summary><div><p><Amount value={275} hidden={hidden} /> earmarked from Barclays to NatWest to cover payments.</p><p className={styles.helper}>Already included in the estimate. This line explains the move and does not subtract it again.</p></div></details>}
  </section>;
}
export default function Preview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : "a";
  const dark = params.get("mode") === "dark";
  const accountId: AccountId = ACCOUNT_IDS.includes(params.get("account") as AccountId) ? params.get("account") as AccountId : "ba";
  const account = useMemo(() => {
    const source = FIXTURES[accountId];
    return (params.get("dates") === "none" || params.get("state") === "undated") && source.kind === "card" ? { ...source, settings: { ...source.settings, closeDay: null, dueDay: null, dueOffset: null } } : source;
  }, [accountId, params]);
  const ready = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const [open, setOpen] = useState(params.get("open") === "1");
  const [hidden, setHidden] = useState(params.get("hidden") === "1");
  const [session, setSession] = useState<Record<string, SessionRecord>>({});
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  const go = (changes: Record<string, string | null>) => link(params, { hidden: hidden ? "1" : null, ...changes });
  const value = session[account.id] ?? { settings: account.settings, rates: initialRates(account), counted: !!account.counted, name: account.name, balance: account.balance };
  return <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
    <main className={styles.page} data-g412-ready={ready ? "true" : "false"}><div className={styles.wrap}>
      <a className={styles.back} href="/design"><ArrowLeft size={16} aria-hidden="true" />Design rounds</a>
      <header><h1>One place for your card details</h1><p>Optional statement dates, how you pay and card rates, together in Account details.</p><p className={styles.helper}>G412 design round. Synthetic examples. Production is unchanged.</p></header>
      <nav className={styles.variantLinks} aria-label="Design direction"><a aria-current={variant === "a" ? "page" : undefined} className={variant === "a" ? styles.active : ""} href={go({ variant: "a" })}>A · Payment first</a><a aria-current={variant === "b" ? "page" : undefined} className={variant === "b" ? styles.active : ""} href={go({ variant: "b" })}>B · One tidy record</a></nav>
      <p className={styles.direction}>{variant === "a" ? "An open record. The next payment leads, with dates, rates and account controls below." : "A quieter record. Expand payment, rates or connection only when you need them."}</p>
      <Landing account={account} hidden={hidden} open={() => setOpen(true)} />
      <details className={styles.examples}><summary>Examples and display<ChevronDown size={18} aria-hidden="true" /></summary><div className={styles.exampleLinks}>
        {ACCOUNT_IDS.map(item => <a key={item} className={item === accountId ? styles.active : ""} href={go({ account: item })}>{FIXTURES[item].name}</a>)}
        <a href={go({ mode: dark ? "light" : "dark" })}>{dark ? "Light theme" : "Dark theme"}</a>
        <button type="button" onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}{hidden ? "Show figures" : "Hide figures"}</button>
        <a href={go({ state: params.get("state") === "undated" ? null : "undated", dates: null })}>{params.get("state") === "undated" ? "Dated card" : "No statement dates"}</a>
      </div></details>
    </div></main>
    {open && <Details key={account.id} account={account} value={value} variant={variant} hidden={hidden} close={() => setOpen(false)} onChange={next => setSession(current => ({ ...current, [account.id]: next }))} />}
  </div>;
}
