"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, ChevronDown, ChevronRight, CircleUserRound, Home, Landmark, PieChart, Plus, Target, Settings, X, type LucideIcon } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import styles from "./preview.module.css";

type Variant = "a" | "b" | "c";
type State = "one" | "many" | "empty" | "loading" | "error";
type View = "home" | "accounts" | "account" | "add" | "spend" | "upcoming" | "planning" | "settings";
type Href = (view: View, extra?: Record<string, string>) => string;
type Account = { id: string; name: string; type: string; balance: number };
const accounts: Account[] = [
  { id: "current", name: "The Number One", type: "Current account", balance: 2148.63 },
  { id: "saver", name: "Everyday Saver", type: "Savings", balance: 842.14 },
  { id: "card", name: "Reward Credit Card", type: "Credit card", balance: -91.03 },
];
const directions = { a: "A · A named door", b: "B · In the journey", c: "C · A primary destination" };
const states = { one: "One bank", many: "Several accounts", empty: "No accounts", loading: "Loading", error: "Failed refresh" };
const valid = <T extends string>(v: string | null, choices: readonly T[], fallback: T) => choices.includes(v as T) ? v as T : fallback;
const rows = (state: State) => state === "many" ? accounts : state === "one" || state === "error" ? [accounts[0]] : [];
const cash = (n: number, hidden: boolean) => `${n < 0 ? "−" : ""}£${hidden ? "••••" : Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Money({ value, hidden }: { value: number; hidden: boolean }) {
  return <span className={styles.mono} aria-label={hidden ? (value < 0 ? "Negative amount hidden" : "Amount hidden") : undefined}>{cash(value, hidden)}</span>;
}

export default function Preview() {
  const search = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const variant = valid(search.get("variant"), ["a", "b", "c"] as const, "a");
  const state = valid(search.get("state"), ["one", "many", "empty", "loading", "error"] as const, "one");
  const view = valid(search.get("view"), ["home", "accounts", "account", "add", "spend", "upcoming", "planning", "settings"] as const, "home");
  const hidden = search.get("hidden") === "1";
  const dark = search.get("mode") === "dark";
  const clean = search.get("clean") === "1";
  const [pennyOpen, setPennyOpen] = useState(false);
  const previousView = useRef(view);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const href: Href = (next, extra = {}) => {
    const params = new URLSearchParams(search.toString());
    params.set("view", next);
    Object.entries(extra).forEach(([key, value]) => params.set(key, value));
    return `${path}?${params}`;
  };
  function set(key: string, value: string) {
    const params = new URLSearchParams(search.toString());
    params.set(key, value);
    router.replace(`${path}?${params}`, { scroll: false });
  }
  useEffect(() => {
    if (previousView.current !== view) {
      (document.querySelector("[data-preview-heading]") as HTMLElement | null)?.focus();
      previousView.current = view;
    }
  }, [view]);
  const closePenny = useCallback(() => {
    setPennyOpen(false);
    // The launcher is inert until the native modal has unmounted.
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  const openPenny = (event: React.MouseEvent<HTMLButtonElement>) => { trigger.current = event.currentTarget; setPennyOpen(true); };
  const account = accounts.find(a => a.id === search.get("account")) ?? accounts[0];

  return <main className={`${styles.page} ${dark ? styles.dark : ""}`} data-g389-ready data-variant={variant} data-view={view}>
    <a className={styles.skip} href="#prototype-content">Skip to example</a>
    {clean ? <Link className={styles.cleanReturn} href={href(view, { clean: "0" })}>Show review controls</Link> : <section className={styles.review} aria-label="Design review controls">
      <Link className={styles.back} href="/design"><ArrowLeft size={16} aria-hidden="true" /> Design review</Link>
      <h1>Finding Accounts from Home</h1>
      <p>{variant === "a" ? "A · A named door. Recommended: Accounts sits beside the greeting, ready before the figures load." : variant === "b" ? "B · In the journey. A clear Accounts row follows the verdict, at the cost of more scrolling." : "C · A primary destination. Accounts replaces Planning in the mobile bar. Goals and plans moves to Home."}</p>
      <details><summary>Compare directions and examples <ChevronDown size={16} aria-hidden="true" /></summary>
        <div className={styles.controls}>
          <fieldset><legend>Direction</legend>{(Object.keys(directions) as Variant[]).map(v => <button key={v} type="button" aria-pressed={v === variant} onClick={() => set("variant", v)}>{directions[v]}</button>)}</fieldset>
          <fieldset><legend>Example</legend>{(Object.keys(states) as State[]).map(s => <button key={s} type="button" aria-pressed={s === state} onClick={() => set("state", s)}>{states[s]}</button>)}</fieldset>
          <button type="button" aria-pressed={dark} onClick={() => set("mode", dark ? "light" : "dark")}>Dark theme</button>
          <button type="button" aria-pressed={hidden} onClick={() => set("hidden", hidden ? "0" : "1")}>Hide figures</button>
          <Link href={href("home")}>Start on Home</Link>
        </div>
      </details>
      <p className={styles.fixture}>Synthetic example. Home is abbreviated to compare navigation; other journeys are outside this preview. No bank data or saved preferences are used.</p>
    </section>}
    <div className={styles.app}>
      <Sidebar variant={variant} view={view} href={href} openPenny={openPenny} />
      <div className={styles.content} id="prototype-content" tabIndex={-1}>
        {view === "home" ? <HomeView {...{ variant, state, hidden, href }} /> : view === "accounts" ? <AccountsView {...{ state, hidden, href }} /> : view === "account" ? <AccountView {...{ account, state, hidden, href }} /> : view === "add" ? <Add href={href} /> : <Other view={view} href={href} />}
      </div>
    </div>
    <MobileNav {...{ variant, view, href, openPenny }} />
    {pennyOpen && <Penny close={closePenny} />}
  </main>;
}

function AccountsDoor({ href, compact = false, count }: { href: string; compact?: boolean; count?: number }) {
  return <Link href={href} data-accounts-door className={compact ? styles.headerAccounts : styles.destination}>
    <Landmark size={18} aria-hidden="true" /><span><strong>Accounts</strong>{!compact && <small>{count === 0 ? "Connect a bank or add a statement" : count === 1 ? "Your bank account and connection" : "Balances and bank connections"}</small>}</span><ChevronRight size={16} aria-hidden="true" />
  </Link>;
}
function HomeView({ variant, state, hidden, href }: { variant: Variant; state: State; hidden: boolean; href: Href }) {
  const loading = state === "loading", empty = state === "empty", error = state === "error";
  const known = !loading && !empty;
  return <section className={styles.scene}>
    <header className={styles.homeHeader}>
      <Link className={styles.avatar} href={href("settings")} aria-label="Account and settings"><CircleUserRound size={24} aria-hidden="true" /></Link>
      <div className={styles.greeting}><h1 data-preview-heading tabIndex={-1}>Good morning, Alex</h1><p>Your money at a glance</p></div>
      {variant === "a" && <AccountsDoor compact href={href("accounts")} />}
    </header>
    <div className={styles.homeColumns}>
      <div>
        <section className={styles.hero} aria-label="Left to spend example">
          <div className={styles.heroTop}><h2>Left to spend</h2>{known && !error && <span className={styles.good}><Check size={13} aria-hidden="true" />Looks on track</span>}</div>
          {loading ? <><p className={styles.noFigure}>No figure yet</p><p role="status">Checking your bank data…</p></> : empty ? <><p className={styles.noFigure}>No figure yet</p><p>Connect a bank to see your estimated left to spend.</p><Link className={styles.primary} href={href("add")}>Connect a bank</Link></> : <>
            <p className={`${styles.heroMoney} ${error ? styles.lastKnown : ""}`}><Money value={463.2} hidden={hidden} /></p>
            {error ? <><p>Last known amount · 1 Nov, 09:00</p><p>We could not update your forecast.</p><Link className={styles.action} href={href("home", { state: "one" })}>Try again</Link></> : <p>Estimated cash left until payday on 27 November, after payments, plans and your buffer.</p>}
            <div className={styles.spendFrom}><h3>Spend from</h3><div><span className={styles.bank} aria-hidden="true">N</span><span>NatWest</span><span>up to <Money value={463.2} hidden={hidden} /></span></div><p>Showing your top account. See all in Your accounts.</p></div>
            <Link className={styles.heroAccounts} href={href("accounts")}>Your accounts <ChevronRight size={15} aria-hidden="true" /></Link>
          </>}
        </section>
        {variant === "b" && <AccountsDoor href={href("accounts")} count={loading ? undefined : rows(state).length} />}
        {variant === "c" && <Link className={styles.goalDoor} href={href("planning")}><Target size={18} aria-hidden="true" /><span><strong>Goals and plans</strong><small>Save towards a future goal</small></span><ChevronRight size={16} aria-hidden="true" /></Link>}
        {known && <details className={styles.estimate}><summary>What this estimate counts <ChevronDown size={16} aria-hidden="true" /></summary><p>Example only: <Money value={2148.63} hidden={hidden} /> cash, less <Money value={1285.43} hidden={hidden} /> payments, <Money value={300} hidden={hidden} /> plans and a <Money value={100} hidden={hidden} /> buffer leaves <Money value={463.2} hidden={hidden} />. It is not the bank balance.</p></details>}
        <section className={styles.section}><h2>Your money</h2>{!known ? <p className={styles.quiet}>{loading ? "Checking spending history…" : "Your spending summary appears after a bank connects."}</p> : <Link className={styles.moneyRow} href={href("spend")}><span>Spending this pay period{error && <small>Last known · 1 Nov, 09:00</small>}</span><strong><Money value={382.41} hidden={hidden} /></strong><ChevronRight size={16} aria-hidden="true" /></Link>}</section>
        <section className={styles.section}><h2>{variant === "b" ? "Your accounts" : "Your estate"}</h2>{loading ? <p className={styles.quiet}>Loading your accounts…</p> : empty ? <Link className={styles.action} href={href("accounts")}>Other ways to add accounts <ChevronRight size={16} aria-hidden="true" /></Link> : <>{error && <p className={styles.quiet}>Last known balances · 1 Nov, 09:00</p>}<div className={styles.list}>{rows(state).map(a => <AccountRow key={a.id} account={a} hidden={hidden} href={href("account", { account: a.id })} />)}<Link className={styles.listFooter} href={href("accounts")}>{rows(state).length === 1 ? "See your account" : `All ${rows(state).length} accounts`}<ChevronRight size={15} aria-hidden="true" /></Link></div></>}</section>
      </div>
      <section className={`${styles.section} ${styles.recent}`}><h2>Recent activity</h2>{known ? <><p className={styles.quiet}>{error ? "Last known activity" : "Latest booked payments"}</p><div className={styles.list}><div className={styles.moneyRow}><span>Groceries<small>1 November</small></span><strong><Money value={-42.6} hidden={hidden} /></strong></div><div className={styles.moneyRow}><span>Salary<small>30 October</small></span><strong><Money value={2400} hidden={hidden} /></strong></div></div><Link className={styles.action} href={href("spend")}>See spending <ChevronRight size={16} aria-hidden="true" /></Link></> : <p className={styles.quiet}>{loading ? "Checking recent activity…" : "Activity will appear here once your bank has synced."}</p>}</section>
    </div>
  </section>;
}
function AccountRow({ account, hidden, href }: { account: Account; hidden: boolean; href: string }) {
  return <Link className={styles.accountRow} href={href}><span className={styles.bank} aria-hidden="true">N</span><span><strong>{account.name}</strong><small>NatWest · {account.type}</small></span><strong><Money value={account.balance} hidden={hidden} /></strong><ChevronRight size={16} aria-hidden="true" /></Link>;
}
function Back({ href, children }: { href: string; children: React.ReactNode }) { return <Link className={styles.back} href={href}><ArrowLeft size={18} aria-hidden="true" />{children}</Link>; }
function AccountsView({ state, hidden, href }: { state: State; hidden: boolean; href: Href }) {
  const list = rows(state);
  return <section className={styles.scene}><Back href={href("home")}>Home</Back><h1 data-preview-heading tabIndex={-1}>Accounts</h1><p className={styles.intro}>Your balances and bank connections.</p>
    <section className={styles.netWorth}><div><h2>Net worth</h2><Link className={styles.action} href={href("add")}><Plus size={17} aria-hidden="true" />Add</Link></div>{list.length ? <p className={styles.heroMoney}><Money value={list.reduce((total, a) => total + a.balance, 0)} hidden={hidden} /></p> : <p className={styles.noFigure}>{state === "loading" ? "Not available yet" : "No accounts yet"}</p>}<p>{state === "loading" ? "Waiting for your accounts" : `Across ${list.length} ${list.length === 1 ? "account" : "accounts"}`}</p>{state === "error" && <p>Last known balances · 1 Nov, 09:00. <Link className={styles.action} href={href("accounts", { state: "one" })}>Try again</Link></p>}</section>
    {state === "loading" ? <p role="status" className={styles.quiet}>Loading connected accounts…</p> : state === "empty" ? <Link className={styles.primary} href={href("add")}>Add your first account</Link> : <section className={styles.section}><h2>Connected accounts</h2><div className={styles.list}>{list.map(a => <AccountRow key={a.id} account={a} hidden={hidden} href={href("account", { account: a.id })} />)}</div></section>}
  </section>;
}
function AccountView({ account, state, hidden, href }: { account: Account; state: State; hidden: boolean; href: Href }) {
  const known = state !== "empty" && state !== "loading";
  return <section className={styles.scene}><Back href={href("accounts")}>Accounts</Back><h1 data-preview-heading tabIndex={-1}>{account.name}</h1><p className={styles.intro}>NatWest · {account.type}</p><section className={styles.netWorth}><h2>Bank balance</h2>{known ? <><p className={styles.heroMoney}><Money value={account.balance} hidden={hidden} /></p><p>{state === "error" ? "Last known balance · 1 Nov, 09:00" : "As of 1 Nov, 09:00"}</p>{account.id === "current" && <p>Available in this example: <Money value={463.2} hidden={hidden} /></p>}</> : <p className={styles.noFigure}>Not available yet</p>}</section><p className={styles.quiet}>Account detail is abbreviated in this navigation prototype.</p><Link className={styles.action} href={href("home")}>Return Home</Link></section>;
}
function Add({ href }: { href: Href }) {
  const [choice, setChoice] = useState<string | null>(null);
  return <section className={styles.scene}><Back href={href("accounts")}>Accounts</Back><h1 data-preview-heading tabIndex={-1}>Add an account</h1><p className={styles.intro}>This navigation preview stops before bank authorisation or file upload.</p><div className={styles.addChoices}>{["Connect a bank", "Upload a statement", "Add an investment", "Add an offline account"].map(label => <button type="button" key={label} aria-pressed={choice === label} onClick={() => setChoice(label)}>{label}<ChevronRight size={16} aria-hidden="true" /></button>)}</div>{choice && <p className={styles.quiet} role="status">Selected: {choice}. No account is added in this preview. Use Accounts above to return.</p>}</section>;
}
function Other({ view, href }: { view: Exclude<View, "home" | "accounts" | "account" | "add">; href: Href }) {
  return <section className={styles.scene}><Back href={href("home")}>Home</Back><h1 data-preview-heading tabIndex={-1}>{{ spend: "Spend", upcoming: "Upcoming", planning: "Goals and plans", settings: "Account and settings" }[view]}</h1><p className={styles.intro}>This destination is a navigation example. Use the same Home or Accounts route to continue the task.</p>{view === "settings" && <Link className={styles.action} href={href("accounts")}>View connected accounts <ChevronRight size={16} aria-hidden="true" /></Link>}</section>;
}
function MobileNav({ variant, view, href, openPenny }: { variant: Variant; view: View; href: Href; openPenny: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const items: [View, string, LucideIcon][] = [["home", "Home", Home], ["spend", "Spend", PieChart], ["upcoming", "Upcoming", CalendarClock], variant === "c" ? ["accounts", "Accounts", Landmark] : ["planning", "Planning", Target]];
  const active = view === "account" || view === "add" ? "accounts" : view;
  const item = ([id, label, Icon]: typeof items[number]) => <Link key={id} href={href(id)} aria-current={active === id ? "page" : undefined}><Icon size={22} aria-hidden="true" /><span>{label}</span></Link>;
  return <nav className={styles.mobileNav} aria-label="Primary">{items.slice(0, 2).map(item)}<button type="button" className={styles.penny} onClick={openPenny} aria-label="Ask Penny" aria-haspopup="dialog"><PennyMark size={22} /></button>{items.slice(2).map(item)}</nav>;
}
function Sidebar({ variant, view, href, openPenny }: { variant: Variant; view: View; href: Href; openPenny: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  const items: [View, string, LucideIcon][] = [["home", "Home", Home], ["spend", "Spend", PieChart], ["upcoming", "Upcoming", CalendarClock], ["planning", "Planning", Target], ...(variant === "c" ? [["accounts", "Accounts", Landmark] as [View, string, LucideIcon]] : []), ["settings", "Settings", Settings]];
  const active = view === "account" || view === "add" ? "accounts" : view;
  return <div className={styles.sidebar} role="complementary" aria-label="Example navigation"><span className={styles.brand}>sorted</span><nav aria-label="Desktop primary">{items.map(([id, label, Icon]) => <Link key={id} href={href(id)} aria-current={active === id ? "page" : undefined}><Icon size={20} aria-hidden="true" />{label}</Link>)}</nav><button type="button" className={styles.adviser} onClick={openPenny} aria-haspopup="dialog"><span><PennyMark size={20} /></span>Ask Penny</button></div>;
}
function Penny({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [answer, setAnswer] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} className={styles.pennyPanel} aria-labelledby="penny-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header><span className={styles.adviserMark}><PennyMark size={22} /></span><h2 id="penny-title">Ask Penny</h2><button type="button" aria-label="Close Penny" onClick={close}><X size={20} aria-hidden="true" /></button></header>
    <p>This is a local example, with no advice service connected.</p><button type="button" className={styles.question} onClick={() => setAnswer(true)}>What is the difference between these figures?</button>
    {answer && <p role="status">Bank balance is the money recorded at your bank. Left to spend is an estimate after expected payments, plans and your buffer. Check your bank for its latest balance.</p>}
    <button type="button" className={styles.primary} onClick={close}>Back to the example</button>
  </dialog>;
}
