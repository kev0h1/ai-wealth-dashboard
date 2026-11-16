"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, LockKeyhole, Wallet } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import OfferCards from "@/components/card-offers/OfferCards";
import type { CardTermsCard } from "@/lib/api";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import { ACCOUNTS, HEURISTICS, STATE_NAMES, VARIANTS, type AccountKind, type Actions, type Child, type ConnectionState, type Example, type Model, type Variant } from "./fixtures";
import { AccountFacts, ConnectionSummary, Identity, Money } from "./ui";
import styles from "./AccountDetails.module.css";

export default function AccountDetailsClient() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "b" ? "b" : params.get("variant") === "c" ? "c" : "a";
  const kind: AccountKind = params.get("account") === "savings" ? "savings" : params.get("account") === "credit" ? "credit" : "current";
  const connection: ConnectionState = params.get("state") === "reconnect" ? "reconnect" : params.get("state") === "never" ? "never" : "healthy";
  const example: Example = (["locked", "missing", "long", "failure"] as const).find(value => value === params.get("example")) ?? "normal";
  const dark = params.get("mode") === "dark";
  return <Preview key={`${variant}-${kind}-${connection}-${example}-${dark}-${params.get("hidden")}-${params.get("open")}`} variant={variant} kind={kind} connection={connection} example={example} dark={dark} initialHidden={params.get("hidden") === "1"} initialOpen={params.get("open") !== "0"} />;
}

function Preview({ variant, kind, connection, example, dark, initialHidden, initialOpen }: { variant: Variant; kind: AccountKind; connection: ConnectionState; example: Example; dark: boolean; initialHidden: boolean; initialOpen: boolean }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(initialOpen);
  const [child, setChild] = useState<Child>(null);
  const [hidden, setHidden] = useState(initialHidden);
  const [included, setIncluded] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState<Model["busy"]>(null);
  const [refreshed, setRefreshed] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState(false);
  const [method, setMethod] = useState<"full" | "minimum" | "manual">("full");
  const [methodDraft, setMethodDraft] = useState(method);
  const [editingPayment, setEditingPayment] = useState(false);
  const live = useRef(true);
  const pinAttempted = useRef(false);
  const refreshAttempted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const account = { ...ACCOUNTS[kind], ...(example === "missing" ? { last4: null, sortCode: null } : {}), ...(example === "long" ? { name: "Household bills and everyday spending", bank: "Harbour Community Building Society" } : {}) };
  const model: Model = { account, state: connection, example, hidden, included, pinned, busy, refreshed, pinError, refreshError, notice, paymentMethod: method };
  useEffect(() => {
    live.current = true;
    const priorDark = document.documentElement.classList.contains("dark"), priorScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", dark); document.documentElement.style.colorScheme = dark ? "dark" : "light"; setReady(true);
    return () => { live.current = false; if (timer.current) clearTimeout(timer.current); document.documentElement.classList.toggle("dark", priorDark); document.documentElement.style.colorScheme = priorScheme; };
  }, [dark]);

  const href = (patch: Record<string, string>) => `/design/account-details?${new URLSearchParams({ variant, account: kind, state: connection, example, mode: dark ? "dark" : "light", hidden: hidden ? "1" : "0", ...patch })}`;
  function openChild(next: Exclude<Child, null>) { setEditingPayment(false); setChild(next); }
  function togglePin() {
    if (busy || connection === "reconnect") return;
    setBusy("pin"); setPinError(false);
    timer.current = setTimeout(() => { if (!live.current) return; setBusy(null); if (example === "failure" && !pinAttempted.current) { pinAttempted.current = true; setPinError(true); return; } setPinned(value => !value); setNotice(pinned ? "Removed from Home in this preview." : "Pinned to Home in this preview."); }, 400);
  }
  function refresh() {
    if (busy || refreshed || connection === "reconnect") return;
    setBusy("refresh"); setRefreshError(false);
    timer.current = setTimeout(() => { if (!live.current) return; setBusy(null); if (example === "failure" && !refreshAttempted.current) { refreshAttempted.current = true; setRefreshError(true); return; } if (connection === "never") { setNotice("No bank data has arrived yet. Check again later."); return; } setRefreshed(true); setNotice("Account refreshed in this preview."); }, 500);
  }
  const actions: Actions = { open: openChild, togglePin, refresh, toggleIncluded: () => { if (example === "locked" || connection !== "healthy" || kind !== "current") return; setIncluded(value => !value); setNotice(included ? "Excluded from Left to spend in this preview." : "Included in Left to spend in this preview."); } };
  const componentProps = { model, actions };
  const childTitle = child === "identity" ? "Account information" : child === "connection" ? "Bank connection" : child === "payment" ? editingPayment ? "How you pay" : "Payment" : child === "rates" ? "Rates and deals" : child === "remove" ? "Remove this account?" : `Reconnect ${account.bank}`;
  const methodLabel = method === "full" ? "Full balance by Direct Debit" : method === "minimum" ? "Minimum payment by Direct Debit" : "Paid manually";
  const card: CardTermsCard = { account_id: "fixture-g474-card", name: account.name, provider: account.bank, balance: account.balance, currency: "GBP", source: "fixture", ask_eligible: false, card_class: "credit_card", terms: { apr_pct: 22.9, cash_apr_pct: 28.9, rates_as_of: "2026-11-11", status: "confirmed", confirmed_at: null, min_payment_note: null, product_key: null, usage: "carry", bt_offers: [], promos: [{ id: "fixture-g474-offer", kind: "balance_transfer", offer_type: "balance_transfer", balance: 620.40, apr_pct: 0, until: "2027-05-21", revert_apr_pct: 22.9, as_of: "2026-11-11" }] } };

  return <main className={`${styles.surface} ${styles.page}`} id="account-details-preview" tabIndex={-1}>
    <a href="#account-details-preview" className={styles.skip}>Skip to account details preview</a>
    <div className={styles.pageInner}>
      <Link href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design previews</Link>
      <h1>Account details</h1><p className={styles.pageIntro}>Three ways to make the selected account clear and its controls consistent. Fictional accounts, fixed at 15 November 2026. Every interaction stays in this preview.</p>
      <div className={styles.previewLayout}>
        <div className={styles.controls}>
          <fieldset><legend>Design direction</legend><nav aria-label="Design direction" className={styles.choices}>{(Object.keys(VARIANTS) as Variant[]).map(value => <a key={value} href={href({ variant: value })} aria-current={value === variant ? "page" : undefined}>{value.toUpperCase()} · {VARIANTS[value].name}</a>)}</nav></fieldset>
          <fieldset><legend>Account</legend><nav aria-label="Fictional account" className={styles.choices}>{(["current", "savings", "credit"] as AccountKind[]).map(value => <a key={value} href={href({ account: value })} aria-current={value === kind ? "page" : undefined}>{value === "credit" ? "Credit card" : value === "current" ? "Current account" : "Savings"}</a>)}</nav></fieldset>
          <fieldset><legend>Connection</legend><nav aria-label="Connection example" className={styles.choices}>{(Object.keys(STATE_NAMES) as ConnectionState[]).map(value => <a key={value} href={href({ state: value })} aria-current={value === connection ? "page" : undefined}>{STATE_NAMES[value]}</a>)}</nav></fieldset>
          <div className={styles.choices}><a href={href({ mode: dark ? "light" : "dark" })}>{dark ? "Light theme" : "Dark theme"}</a><button type="button" onClick={() => setHidden(value => !value)}><LockKeyhole size={14} aria-hidden="true" />{hidden ? "Show balances" : "Hide balances"}</button></div>
          <details className={styles.disclosure}><summary>More examples<ChevronDown size={16} aria-hidden="true" /></summary><nav className={styles.choices} aria-label="Additional checks">{(["normal", "locked", "missing", "long", "failure"] as Example[]).map(value => <a key={value} href={href({ example: value })} aria-current={value === example ? "page" : undefined}>{({ normal: "Usual details", locked: "Inclusion locked", missing: "Missing identifiers", long: "Long account name", failure: "Action failure" })[value]}</a>)}</nav><p className={styles.helper}>Close the account sheet to switch examples. Missing identifiers stay missing. Pinning on an ended connection stays unavailable with a reason. Card payment and offer examples remain separate.</p></details>
        </div>
        <section className={styles.stage} aria-label="Selected direction"><h2>{variant.toUpperCase()} · {VARIANTS[variant].name}</h2><p>{VARIANTS[variant].summary}</p><p>{VARIANTS[variant].tradeoff}</p><div className={styles.stageAccount}><Identity {...componentProps} /><p>{connection === "never" ? "Waiting for the first bank balance" : connection === "reconnect" ? "Last recorded bank balance" : "Bank balance"}</p><strong>{connection === "never" ? "Not available yet" : <Money value={account.balance} hidden={hidden} />}</strong></div>{removed ? <p role="status">Removed from this preview. No real account was changed. Reload the page to reset it.</p> : <button type="button" className={styles.primary} onClick={() => setOpen(true)}>Open account details<ChevronRight size={16} aria-hidden="true" /></button>}</section>
      </div>
      <Critique />
      {ready && open && !removed && <SheetFrame title="Account details" variant="compact" onClose={() => setOpen(false)} themeClass={styles.surface} bodyClassName={`${styles.surface} ${styles.sheetBody}`} footer={({ close }) => <div className={styles.footer}><button type="button" className={styles.primary} onClick={close}>Done</button></div>}>
        {variant === "a" ? <VariantA {...componentProps} /> : variant === "b" ? <VariantB {...componentProps} /> : <VariantC {...componentProps} />}
      </SheetFrame>}
      {ready && child && <SheetFrame nested={open} title={childTitle} description={account.name} variant="compact" themeClass={styles.surface} bodyClassName={`${styles.surface} ${styles.childBody}`} onClose={() => { setChild(null); setEditingPayment(false); }} onBack={child === "payment" && editingPayment ? () => setEditingPayment(false) : undefined} onEscape={child === "payment" && editingPayment ? () => setEditingPayment(false) : undefined} onHistoryBack={child === "payment" && editingPayment ? () => setEditingPayment(false) : undefined}
        footer={({ close, closeThen }) => <div className={styles.footer}>
          {child === "remove" ? <><button type="button" className={styles.secondary} onClick={close}>Keep account</button><button type="button" className={styles.primary} onClick={() => closeThen(() => { setRemoved(true); setOpen(false); })}>Remove from Sorted</button></>
            : child === "reconnect" ? <><button type="button" className={styles.secondary} onClick={close}>Cancel</button><button type="button" className={styles.primary} onClick={() => closeThen(() => setNotice("Connection hand-off previewed. No bank connection was opened."))}>Review connection</button></>
            : child === "payment" && editingPayment ? <><button type="button" className={styles.secondary} onClick={() => setEditingPayment(false)}>Cancel</button><button type="button" className={styles.primary} onClick={() => { setMethod(methodDraft); setEditingPayment(false); setNotice("Payment method changed in this preview."); }}>Use these details</button></>
            : <><button type="button" className={styles.primary} onClick={close}>Back to account details</button>{(child === "payment" || child === "rates") && <button type="button" className={styles.secondary} aria-label={hidden ? "Show balances" : "Hide balances"} onClick={() => setHidden(value => !value)}><LockKeyhole size={17} aria-hidden="true" />{hidden ? "Show" : "Hide"}</button>}</>}
        </div>}>
        {child === "identity" && <><AccountFacts model={model} /><p>Only the last four digits are shown. Missing details stay unknown rather than being filled in.</p></>}
        {child === "connection" && <><ConnectionSummary {...componentProps} evidence /><p>Reconfirming lets your bank keep sharing this account’s data with Sorted. It does not make a payment.</p>{notice && <p role="status">{notice}</p>}</>}
        {child === "reconnect" && <><p>Bank access has ended, so Sorted cannot request new balances or transactions for this account.</p><p>You will review the connection in Sorted before continuing to Finexer and your bank to confirm access again.</p><p>Your last recorded details stay here. Reconnecting does not move money.</p></>}
        {child === "remove" && <><h3>{account.bank} · {account.name}</h3><p>This removes this account and its transactions from Sorted. It does not close your bank account or cancel any payments.</p><p>You can keep the account by going back. Nothing changes until you choose Remove from Sorted.</p></>}
        {child === "payment" && (editingPayment ? <fieldset><legend className={styles.fieldLabel}>Payment method</legend>{(["full", "minimum", "manual"] as const).map(value => <label key={value} className={styles.paymentChoice}><input name="payment-method" type="radio" value={value} checked={methodDraft === value} onChange={() => setMethodDraft(value)} /><span>{value === "full" ? "Full balance by Direct Debit" : value === "minimum" ? "Minimum payment by Direct Debit" : "Paid manually"}</span></label>)}<p className={styles.helper}>Records how you already pay. It does not set up or change a Direct Debit at your bank.</p></fieldset> : <><div className={styles.paymentLead}><p>Recorded statement amount</p><strong><Money value={164.35} hidden={hidden} /></strong><small>Statement closed 2 Nov 2026</small></div><button type="button" className={styles.navRow} onClick={() => { setMethodDraft(method); setEditingPayment(true); }}><span className={styles.rowIcon}><Wallet size={18} aria-hidden="true" /></span><span className={styles.rowText}><strong>How you pay</strong><small>{methodLabel}</small></span><ChevronRight size={16} aria-hidden="true" /></button><dl className={styles.facts}><div><dt>Payment due</dt><dd>8 Dec 2026</dd></div><div><dt>Paid from</dt><dd>Harbour Bank · ending 6382</dd></div></dl><p>Payment settings stay separate from card rates and offers.</p></>)}
        {child === "rates" && <><h3>Standard rates</h3><dl className={styles.facts}><div><dt>Purchase rate</dt><dd>22.9% APR</dd></div><div><dt>Cash advance rate</dt><dd>28.9% APR</dd></div></dl><p>Rates recorded 11 Nov 2026.</p><div className={styles.group}><h3>Deals you are using</h3><OfferCards cards={[card]} today="2026-11-15" hidden={hidden} /></div><p>In the app, Rates and deals also lets you add a statement or screenshot and confirm the values before saving.</p></>}
      </SheetFrame>}
    </div>
  </main>;
}

function Critique() {
  return <details className={styles.critique} id="critique"><summary>Critique of the current sheet<ChevronDown size={18} aria-hidden="true" /></summary>
    <p>Method: two independent source assessments, A (g474_critique_a) and B (g474_critique_b), synthesised against PRODUCT.md and DESIGN.md. No incumbent screenshot was supplied. The detector and overlays were unavailable because the skill launcher was permission-denied. This is a source-based assessment, not a visual contrast or browser audit.</p>
    <p>The account card carries Sorted’s identity, but its details sheet becomes a generic list. It uses the shared focus, Back and scroll behaviour, and the two card settings destinations are sound. Opening the sheet should keep the account recognisable and make its connection state understandable.</p>
    <table><caption>Current-sheet heuristic assessment</caption><thead><tr><th scope="col">Heuristic</th><th scope="col">Score / 4</th></tr></thead><tbody>{HEURISTICS.map(([name, score]) => <tr key={name}><th scope="row">{name}</th><td>{score}</td></tr>)}<tr><th scope="row">Total</th><td>22 / 40</td></tr></tbody></table>
    <ol><li><strong>P1: Restore recognition.</strong> AccountsPage.tsx opens a full-height sheet without the account name, bank mark or available masked identifiers. A person managing several accounts must recall what they selected.</li><li><strong>P1: Use consistent controls.</strong> CardDetailsSections.tsx has navigational rows, while the host uses loose Connection text, a star action and red removal. Separate navigation, preferences and read-only facts. Routine removal gets a quiet row and explicit confirmation.</li><li><strong>P1: Explain reconnection.</strong> State that bank updates have stopped, retain the recorded data and provide a clear indigo repair action. Amber belongs in a small status signifier.</li><li><strong>P2: Keep inclusion reasons attached.</strong> Put savings exclusions, current-account inclusion and locked shortfall explanations in the same row grammar. Never offer a switch that cannot change the estimate.</li><li><strong>P2: Make connection copy consistent.</strong> Use Next reconfirmation once. Distinguish bank-data time, a refresh attempt and no data received; do not imply an unknown timestamp means a failed connection.</li></ol>
    <p>For a new user, Pin to Home needs a short explanation. For someone whose connection has expired, the sheet needs to explain what will recover. For a card holder, Payment and Rates and deals must remain separate and tied to the selected card.</p>
    <p>Constraints retained: no overdraft line (G463), separate payment and offer settings (G470/G471), explicit editing affordances (G461), signed privacy masks, eligibility rules, disabled inclusion with a reason, and confirmed removal. Pinning is unavailable for expired connections in the current implementation. The previews show that reason rather than silently dropping the row. Missing bank facts are not editable. Fictional display names also demonstrate where an existing nickname would appear.</p>
  </details>;
}
