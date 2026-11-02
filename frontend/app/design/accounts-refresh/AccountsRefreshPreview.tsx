"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Building2, ChevronDown, ChevronRight, CircleAlert, CirclePlus, CircleUserRound, EyeOff, Landmark, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, TriangleAlert, Upload, X } from "lucide-react";
import styles from "./preview.module.css";

type RefreshState = "idle" | "updating" | "partial" | "error" | "cooldown" | "empty";
type Group = "Current" | "Cards" | "Savings" | "Investments" | "Offline";
type Account = { name: string; provider: string; kind: string; group: Group; balance: number; connected?: boolean; statement?: boolean; initials: string };

const accounts: Account[] = [
  { name: "Day to day", provider: "Northbridge Bank", kind: "Current account", group: "Current", balance: 1284.27, connected: true, initials: "N" },
  { name: "Household bills", provider: "Northbridge Bank", kind: "Current account", group: "Current", balance: 412.10, connected: true, initials: "N" },
  { name: "Travel pot", provider: "Harbour Bank", kind: "Current account", group: "Current", balance: 184.60, connected: true, initials: "H" },
  { name: "Joint account", provider: "Cedar Bank", kind: "Current account", group: "Current", balance: 958.84, connected: true, initials: "C" },
  { name: "Rainy day saver", provider: "Northbridge Bank", kind: "Easy access", group: "Savings", balance: 2320.00, connected: true, initials: "N" },
  { name: "Holiday saver", provider: "Harbour Bank", kind: "Easy access", group: "Savings", balance: 675.48, connected: true, initials: "H" },
  { name: "ISA reserve", provider: "Cedar Bank", kind: "Cash ISA", group: "Savings", balance: 4800.00, connected: true, initials: "C" },
  { name: "Emergency fund", provider: "Northbridge Bank", kind: "Savings", group: "Savings", balance: 960.75, connected: true, initials: "N" },
  { name: "Everyday credit", provider: "Lime Card", kind: "Credit card", group: "Cards", balance: -624.18, connected: true, initials: "L" },
  { name: "Travel credit", provider: "Harbour Card", kind: "Credit card", group: "Cards", balance: -1840.00, connected: true, initials: "H" },
  { name: "Store card", provider: "Northbridge Bank", kind: "Credit card", group: "Cards", balance: -285.42, connected: true, initials: "N" },
  { name: "Family card", provider: "Cedar Card", kind: "Credit card", group: "Cards", balance: -360.10, connected: true, initials: "C" },
  { name: "Global index fund", provider: "Paper statement", kind: "Investment", group: "Investments", balance: 7250.00, statement: true, initials: "P" },
  { name: "Workplace pension", provider: "Paper statement", kind: "Pension", group: "Investments", balance: 10400.00, statement: true, initials: "P" },
  { name: "Shares account", provider: "Paper statement", kind: "Investment", group: "Investments", balance: 2180.45, statement: true, initials: "P" },
  { name: "Collective pension", provider: "Paper statement", kind: "Pension", group: "Investments", balance: 3160.00, statement: true, initials: "P" },
  { name: "Cash at home", provider: "Added by you", kind: "Cash", group: "Offline", balance: 95.00, initials: "O" },
  { name: "Car value", provider: "Added by you", kind: "Asset", group: "Offline", balance: 4350.00, initials: "O" },
  { name: "Personal loan", provider: "Added by you", kind: "Loan", group: "Offline", balance: -30000.00, initials: "O" },
  { name: "Bike finance", provider: "Added by you", kind: "Loan", group: "Offline", balance: -15000.00, initials: "O" },
  { name: "Gift card", provider: "Added by you", kind: "Prepaid", group: "Offline", balance: 52.00, initials: "O" },
  { name: "Home contents", provider: "Added by you", kind: "Asset", group: "Offline", balance: 1200.00, initials: "O" },
];

const groups: Group[] = ["Current", "Cards", "Savings", "Investments", "Offline"];
const available: Record<string, number> = { "Day to day": 528.49, "Household bills": 94, "Travel pot": 0, "Joint account": 246.18 };
const labels: Record<RefreshState, string> = { idle: "Ready", updating: "Updating", partial: "Partly updated", error: "Could not update", cooldown: "Try again soon", empty: "No connected banks" };
const valid = <T extends string>(value: string | null, values: readonly T[], fallback: T) => values.includes(value as T) ? value as T : fallback;
const amount = (value: number, hidden: boolean, decimals = 2) => `${value < 0 ? "−" : ""}£${hidden ? "••••" : Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

export default function AccountsRefreshPreview() {
  const params = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const variant = valid(params.get("variant"), ["a", "b"] as const, "a");
  const initialState = valid(params.get("state"), ["idle", "updating", "partial", "error", "cooldown", "empty"] as const, "idle");
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const statements = params.get("tier") === "statements";
  const clean = params.get("clean") === "1";
  const state = initialState;
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<Group, boolean>>({ Current: true, Cards: true, Savings: true, Investments: true, Offline: true });
  const [detail, setDetail] = useState<Account | null>(null);
  const [home, setHome] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const outcome = valid(params.get("outcome"), ["success", "partial", "error"] as const, "partial");
  // Bank data has its own timestamp. Completing the local request example
  // does not establish a new bank-data time.
  const latest = "2 Nov, 09:40";

  useEffect(() => {
    if (state !== "updating" || statements) return;
    timer.current = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      next.set("state", outcome === "success" ? "idle" : outcome);
      if (outcome === "success") next.set("completed", "1");
      router.replace(`${path}?${next}`, { scroll: false });
    }, 900);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [state, outcome, params, path, router, statements]);
  useEffect(() => { if (menu) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [menu]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu) { setMenu(false); requestAnimationFrame(() => addButton.current?.focus()); }
      if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])]; const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const target = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        event.preventDefault(); items[target]?.focus();
      }
    };
    window.addEventListener("keydown", close);
    const outside = (event: MouseEvent) => { if (menu && !menuRef.current?.contains(event.target as Node) && !addButton.current?.contains(event.target as Node)) setMenu(false); };
    window.addEventListener("mousedown", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("mousedown", outside); };
  }, [menu]);
  const set = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); next.set(key, value); router.replace(`${path}?${next}`, { scroll: false }); };
  const href = (changes: Record<string, string>) => { const next = new URLSearchParams(params.toString()); Object.entries(changes).forEach(([key, value]) => next.set(key, value)); return `${path}?${next}`; };
  const refresh = () => {
    if (state === "cooldown" || state === "empty" || statements) return;
    set("state", "updating");
  };
  const shownAccounts = state === "empty" ? accounts.filter(account => !account.connected) : accounts;
  const visible = shownAccounts.filter(account => `${account.name} ${account.provider} ${account.kind}`.toLowerCase().includes(query.toLowerCase()));
  const total = shownAccounts.reduce((sum, account) => sum + account.balance, 0);
  const stateCopy = state === "updating" ? "Refreshing connected banks. Your last known balances stay visible." : state === "partial" ? "Some banks could not update. Check the connection and try again." : state === "error" ? "We could not refresh connected banks. Your last known balances have not changed." : state === "cooldown" ? "Refresh is available again in 14 minutes." : state === "empty" ? "Connect a bank to refresh balances here." : params.get("completed") === "1" ? "Refresh requested. Bank updates may still be running." : "Ready to refresh connected banks.";
  const freshness = state === "empty" ? "Statements and offline accounts use their own update times." : `Oldest bank data: ${latest}`;

  if (detail) return <Detail account={detail} dark={dark} hidden={hidden} onBack={() => setDetail(null)} />;
  return <main ref={node => { if (node) node.dataset.g389Ready = "true"; }} className={`${styles.page} ${dark ? styles.dark : ""}`} data-variant={variant} data-refresh-state={state}>
    <a className={styles.skip} href="#accounts">Skip to accounts</a>
    {!clean && <section className={styles.review} aria-label="Prototype controls">
      <Link href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design review</Link>
      <h1>Accounts refresh placement</h1>
      <p>Two local examples. All people, providers, balances and timestamps are synthetic. No bank data is used.</p>
      <div className={styles.controls}>
        <button onClick={() => set("variant", "a")} aria-pressed={variant === "a"}>A · Refresh by Add</button><button onClick={() => set("variant", "b")} aria-pressed={variant === "b"}>B · Labelled footer</button>
        <button onClick={() => set("mode", dark ? "light" : "dark")} aria-pressed={dark}>Dark theme</button><button onClick={() => set("hidden", hidden ? "0" : "1")} aria-pressed={hidden}>Hide balances</button>
        <button onClick={() => set("tier", statements ? "connected" : "statements")} aria-pressed={statements}>Statements tier</button><button onClick={() => setHome(open => !open)} aria-pressed={home}>Home A context</button>
        <Link href={href({ clean: "1" })}>Hide controls</Link>
      </div>
      <div className={styles.controls} aria-label="Refresh examples">{(Object.keys(labels) as RefreshState[]).map(example => <button key={example} onClick={() => set("state", example)} aria-pressed={initialState === example}>{labels[example]}</button>)}</div>
      <div className={styles.controls} aria-label="Simulated refresh outcome">{(["success", "partial", "error"] as const).map(result => <button key={result} onClick={() => set("outcome", result)} aria-pressed={outcome === result}>Next refresh: {result === "success" ? "success" : result === "partial" ? "partial update" : "failure"}</button>)}</div>
    </section>}
    <div className={styles.shell}>
      {home ? <HomeContext hidden={hidden} onAccounts={() => setHome(false)} /> : <section id="accounts" className={styles.content} tabIndex={-1}>
        <header className={styles.titleRow}><div><h1>Accounts</h1><p>Your balances and account connections.</p></div></header>
        <section className={styles.netWorth} aria-label="Net worth">
          <div className={styles.netTop}><div><p className={styles.metricLabel}>Net worth</p><p className={styles.total}><Money value={total} hidden={hidden} decimals={0} /></p><p className={styles.subline}>Across {shownAccounts.length} accounts</p></div>
            <div className={styles.actions}>
              {variant === "a" && <button ref={refreshButton} type="button" className={styles.iconAction} onClick={refresh} disabled={state === "updating" || state === "cooldown" || state === "empty" || statements} aria-label="Refresh connected banks" title="Refresh connected banks"><RefreshCw size={20} className={state === "updating" ? styles.spin : ""} aria-hidden="true" /></button>}
              <div className={styles.menuWrap}><button ref={addButton} type="button" className={styles.iconAction} onClick={() => setMenu(open => !open)} aria-expanded={menu} aria-haspopup="menu" aria-label="Add account"><Plus size={21} aria-hidden="true" /></button>{menu && <AddMenu menuRef={menuRef} statements={statements} onClose={() => { setMenu(false); requestAnimationFrame(() => addButton.current?.focus()); }} />}</div>
            </div>
          </div>
          {hidden && <button className={styles.showBalances} onClick={() => set("hidden", "0")}><EyeOff size={15} aria-hidden="true" />Balances hidden <span>Show</span></button>}
          {variant === "b" && <div className={styles.refreshFooter}><div><p><RefreshCw size={15} aria-hidden="true" />Refresh connected banks</p><small>{freshness}</small><small role="status">{statements ? "Bank connection is paused on this Statements plan." : stateCopy}</small></div><button ref={refreshButton} type="button" aria-label="Refresh connected banks" onClick={refresh} disabled={state === "updating" || state === "cooldown" || state === "empty" || statements}>{!statements && state === "updating" ? "Refreshing…" : state === "error" ? "Retry" : "Refresh"}</button></div>}
          {variant === "a" && <><p className={styles.fresh}>{freshness}</p>{!statements && <Status state={state} copy={stateCopy} onRetry={refresh} />}</>}
          {statements && <SubscriptionNotice />}
        </section>
        <div className={styles.searchRow}><Search size={18} aria-hidden="true" /><input id="account-search" name="account-search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an account…" aria-label="Search accounts" /><button type="button" onClick={() => { setQuery(""); document.getElementById("account-search")?.focus(); }} aria-label="Clear search" className={query ? "" : styles.invisible}><X size={16} aria-hidden="true" /></button></div>
        {visible.length === 0 && <p className={styles.quiet} role="status">No accounts match your search.</p>}
        <section className={styles.groups} aria-label="Accounts by type">{groups.map(group => {
          const groupAccounts = visible.filter(account => account.group === group);
          if (!groupAccounts.length) return null;
          const groupTotal = groupAccounts.reduce((sum, account) => sum + account.balance, 0);
          return <section key={group} className={styles.group}><button type="button" className={styles.groupTitle} onClick={() => setExpanded(current => ({ ...current, [group]: !current[group] }))} aria-expanded={expanded[group]}><span>{group}<small>{groupAccounts.length} accounts</small></span><Money value={groupTotal} hidden={hidden} /><ChevronDown size={18} aria-hidden="true" className={expanded[group] ? "" : styles.rotate} /></button>{expanded[group] && <div className={styles.rows}>{groupAccounts.map(account => <button key={account.name} type="button" className={styles.account} onClick={() => setDetail(account)}><span className={styles.badge}>{account.initials}</span><span><strong>{account.name}</strong><small>{account.provider} · {account.kind}{account.statement ? " · statement" : ""}</small></span><span className={styles.accountAmounts}><Money value={account.balance} hidden={hidden} />{account.group === "Current" && <small>Available <Money value={available[account.name]} hidden={hidden} /></small>}</span><ChevronRight size={17} aria-hidden="true" /></button>)}</div>}</section>;
        })}</section>
      </section>}
    </div>
  </main>;
}

function Money({ value, hidden, decimals }: { value: number; hidden: boolean; decimals?: number }) { return <span className={styles.money} aria-label={hidden ? (value < 0 ? "Negative balance hidden" : "Balance hidden") : undefined}>{amount(value, hidden, decimals)}</span>; }
function Status({ state, copy, onRetry }: { state: RefreshState; copy: string; onRetry: () => void }) {
  if (state === "idle") return <p className={styles.fresh}><ShieldCheck size={15} aria-hidden="true" />{copy}</p>;
  const Icon = state === "updating" ? LoaderCircle : state === "partial" ? CircleAlert : state === "error" ? AlertCircle : state === "cooldown" ? TriangleAlert : Landmark;
  return <div className={`${styles.status} ${styles[state]} `}><Icon size={17} className={state === "updating" ? styles.spin : ""} aria-hidden="true" /><p role="status">{copy}</p>{state === "error" && <button onClick={onRetry}>Retry</button>}</div>;
}
function SubscriptionNotice() { const [opened, setOpened] = useState(false); return <div className={`${styles.status} ${styles.cooldown}`}><CircleAlert size={17} aria-hidden="true" /><p role="status">{opened ? "Subscription management would open here. No plan is changed in this local example." : "Bank connection is paused on this Statements plan. Upload a statement or manage your subscription to connect a bank."}</p><button type="button" aria-label="Manage subscription for bank connection" onClick={() => setOpened(true)}>Manage plan</button></div>; }
function AddMenu({ statements, onClose, menuRef }: { statements: boolean; onClose: () => void; menuRef: RefObject<HTMLDivElement | null> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const choices = [["Connect a bank", Building2], ["Upload a statement", Upload], ["Add an investment", Landmark], ["Add an offline account", CirclePlus]] as const;
  return <div ref={menuRef} className={styles.addMenu} role="menu" aria-label="Add an account">
    {choices.map(([label, Icon]) => <button key={label} type="button" role="menuitem" onClick={() => setSelected(label)}>
      <Icon size={17} aria-hidden="true" /><span>{label}{label === "Connect a bank" && statements && <small>Unavailable on your Statements plan</small>}</span>
    </button>)}
    {selected && <p role="status">{selected === "Connect a bank" && statements ? "Bank connection needs a subscription with connected banks." : `${selected} would open next. No account is changed in this example.`}</p>}
    {selected === "Connect a bank" && statements && <button type="button" role="menuitem" onClick={() => setManage(true)}>Manage subscription</button>}
    {manage && <p role="status">Subscription management would open here. No plan is changed.</p>}
    {selected && <button type="button" role="menuitem" onClick={onClose}>Back to accounts</button>}
  </div>;
}
function HomeContext({ onAccounts, hidden }: { onAccounts: () => void; hidden: boolean }) {
  return <section className={styles.detail}>
    <div className={styles.homeGreeting}>
      <span className={styles.avatar} aria-label="Account and settings example"><CircleUserRound size={22} aria-hidden="true" /></span>
      <div><h1>Good morning, Alex</h1><p className={styles.quiet}>Your money at a glance</p></div>
      <button type="button" className={styles.headerAccounts} onClick={onAccounts}><Landmark size={17} aria-hidden="true" />Accounts</button>
    </div>
    <section className={styles.netWorth}><p className={styles.metricLabel}>Left to spend</p><p className={styles.total}><Money value={463.20} hidden={hidden} /></p><p className={styles.subline}>Estimated until payday after planned payments and your buffer.</p></section>
  </section>;
}
function Detail({ account, dark, hidden, onBack }: { account: Account; dark: boolean; hidden: boolean; onBack: () => void }) { const [requested, setRequested] = useState(false); return <main className={`${styles.page} ${dark ? styles.dark : ""}`}><section className={styles.detail}><button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Accounts</button><p className={styles.metricLabel}>{account.provider} · {account.kind}</p><h1>{account.name}</h1><p className={styles.detailValue}><Money value={account.balance} hidden={hidden} /></p><p>{account.connected ? "Last known bank-data time, 2 Nov, 09:40" : account.statement ? "From your latest uploaded statement" : "Added by you"}</p>{account.connected && <><button type="button" className={styles.detailRefresh} onClick={() => setRequested(true)}><RefreshCw size={17} aria-hidden="true" />Refresh this bank detail</button>{requested && <p className={styles.quiet} role="status">This local example would request this connected bank only. The displayed bank-data time remains last known.</p>}</>}<p className={styles.quiet}>This local detail example is independent from the Accounts refresh placement.</p></section></main>; }
