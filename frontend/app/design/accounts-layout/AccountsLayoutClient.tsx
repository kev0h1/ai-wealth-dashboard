"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, CircleAlert, Landmark, Plus, RefreshCw, Search, Star, X } from "lucide-react";
import { accounts, bankLogo, kinds, type Bank, type PreviewAccount } from "./fixtures";
import styles from "./preview.module.css";
type Variant = "a" | "b";
type State = "normal" | "empty" | "loading" | "error" | "syncing" | "unknown";
type Filter = "All" | "Pinned";
const states: State[] = ["normal", "empty", "loading", "error", "syncing", "unknown"];
const valid = <T extends string>(value: string | null, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const money = (value: number | undefined, hidden: boolean, exact = false) => value == null ? "Balance pending" : hidden ? `${value < 0 ? "−" : ""}£••••` : `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", { minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 })}`;
export default function AccountsLayoutClient() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const variant = valid(params.get("variant"), ["a", "b"] as const, "a");
    const mode = valid(params.get("mode"), ["light", "dark"] as const, "light");
    const state = valid(params.get("state"), states, "normal");
    const hidden = params.get("hidden") === "1";
    const clean = params.get("clean") === "1";
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("All");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [showDormant, setShowDormant] = useState(false);
    const [detail, setDetail] = useState<PreviewAccount | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [feedback, setFeedback] = useState("");
    const ready = useRef<HTMLElement>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const restoreId = useRef<string | null>(null);
    const restoreScroll = useRef(0);
    const closeDetail = () => { setDetail(null); requestAnimationFrame(() => { window.scrollTo(0, restoreScroll.current); document.querySelector<HTMLElement>(`[data-account-id="${restoreId.current}"]`)?.focus({ preventScroll: true }); }); };
    useEffect(() => { ready.current?.setAttribute("data-g391-ready", "true"); }, [detail]);
    useEffect(() => { if (addOpen)
        requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>("button")?.focus()); const keyboard = (event: KeyboardEvent) => { if (event.key !== "Escape")
        return; if (addOpen) {
        setAddOpen(false);
        requestAnimationFrame(() => addButton.current?.focus());
    } if (detail)
        closeDetail(); }; const outside = (event: PointerEvent) => { if (addOpen && !menu.current?.contains(event.target as Node) && !addButton.current?.contains(event.target as Node))
        setAddOpen(false); }; window.addEventListener("keydown", keyboard); window.addEventListener("pointerdown", outside); return () => { window.removeEventListener("keydown", keyboard); window.removeEventListener("pointerdown", outside); }; }, [addOpen, detail]);
    const update = (patch: Record<string, string | null>) => { const next = new URLSearchParams(params.toString()); Object.entries(patch).forEach(([key, value]) => value == null ? next.delete(key) : next.set(key, value)); router.replace(`${pathname}?${next}`, { scroll: false }); };
    const dataVisible = !["empty", "loading", "error"].includes(state);
    const shown = useMemo(() => !dataVisible ? [] : accounts.filter(account => `${account.bank} ${account.name} ${account.kind}`.toLowerCase().includes(query.toLowerCase()) && (filter === "All" || account.pinned) && (showDormant || !account.dormant)), [dataVisible, filter, query, showDormant]);
    const open = (account: PreviewAccount) => { restoreId.current = account.id; restoreScroll.current = window.scrollY; setDetail(account); };
    if (detail) {
        const detailAccount = state === "unknown" && detail.id === "starling-new"
            ? { ...detail, balance: undefined, available: undefined, payments: undefined, plans: undefined, low: undefined, buffer: undefined }
            : state === "syncing" && detail.id === "starling-everyday"
                ? { ...detail, name: `${detail.name} (last known)` }
                : detail;
        return <Detail account={detailAccount} hidden={hidden} mode={mode} onBack={closeDetail}/>;
    }
    return <main ref={ready} className={`${styles.page} ${mode === "dark" ? styles.dark : ""}`} data-variant={variant} data-state={state}>{!clean && <Controls variant={variant} mode={mode} hidden={hidden} state={state} update={update}/>}<section className={styles.shell}><header className={styles.header}><div><h1>{variant === "a" ? "Find an account" : "Where your money is"}</h1><p>{variant === "a" ? "Search your full account directory." : "Your position, reconciled by bank."}</p></div><Actions addOpen={addOpen} addButton={addButton} menu={menu} setAddOpen={setAddOpen} setFeedback={setFeedback}/></header>{feedback && <p className={styles.feedback} role="status">{feedback}</p>}<Notice state={state}/>{dataVisible && <Tools query={query} setQuery={setQuery} input={input} filter={filter} setFilter={setFilter} showDormant={showDormant} setShowDormant={setShowDormant}/>}{!dataVisible ? <Withheld state={state} retry={() => update({ state: "normal" })}/> : variant === "a" ? <Directory shown={shown} hidden={hidden} state={state} collapsed={collapsed} setCollapsed={setCollapsed} open={open}/> : <Position shown={shown} hidden={hidden} state={state} collapsed={collapsed} setCollapsed={setCollapsed} open={open}/>}</section></main>;
}
function Controls({ variant, mode, hidden, state, update }: {
    variant: Variant;
    mode: string;
    hidden: boolean;
    state: State;
    update: (patch: Record<string, string | null>) => void;
}) { return <section className={styles.review}><Link href="/design"><ArrowLeft size={16}/>Design review</Link><div><strong>G391 Accounts layout</strong><span>Two coded directions with synthetic figures only.</span></div><nav aria-label="Preview controls"><button onClick={() => update({ variant: "a" })} aria-pressed={variant === "a"}>A Directory</button><button onClick={() => update({ variant: "b" })} aria-pressed={variant === "b"}>B Position</button><button onClick={() => update({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light" : "Dark"}</button><button onClick={() => update({ hidden: hidden ? null : "1" })}>{hidden ? "Show" : "Hide"} balances</button>{states.map(value => <button key={value} onClick={() => update({ state: value })} aria-pressed={state === value}>{value}</button>)}</nav></section>; }
function Actions({ addOpen, addButton, menu, setAddOpen, setFeedback }: {
    addOpen: boolean;
    addButton: RefObject<HTMLButtonElement | null>;
    menu: RefObject<HTMLDivElement | null>;
    setAddOpen: Dispatch<SetStateAction<boolean>>;
    setFeedback: Dispatch<SetStateAction<string>>;
}) { const choices = ["Connect a bank", "Upload a statement", "Add an investment", "Add an offline account"]; const move = (event: ReactKeyboardEvent<HTMLDivElement>) => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
    return; const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]; const at = items.indexOf(document.activeElement as HTMLButtonElement); const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; event.preventDefault(); items[next]?.focus(); }; return <div className={styles.actions}><button className={styles.refresh} type="button" onClick={() => setFeedback("Refresh requested. Bank-data times have not changed.")} aria-label="Refresh connected banks"><RefreshCw size={17}/>Refresh</button><div className={styles.addWrap}><button ref={addButton} type="button" className={styles.add} onClick={() => setAddOpen(value => !value)} aria-expanded={addOpen} aria-haspopup="menu"><Plus size={17}/>Add<ChevronDown size={14}/></button>{addOpen && <div ref={menu} onKeyDown={move} className={styles.menu} role="menu" aria-label="Add an account">{choices.map(item => <button key={item} role="menuitem" type="button" onClick={() => { setFeedback(`${item} would open next. No account has changed.`); setAddOpen(false); requestAnimationFrame(() => addButton.current?.focus()); }}>{item}</button>)}</div>}</div></div>; }
function Notice({ state }: {
    state: State;
}) { if (state === "normal")
    return null; const copy: Record<Exclude<State, "normal">, string> = { empty: "No accounts connected yet. Connect a bank or add an offline account to begin.", loading: "Checking your accounts…", error: "We could not load your account list. Try again in a moment.", syncing: "Some balances are updating. Last known bank balances remain visible.", unknown: "One connected account has no bank balance yet. Totals including it are unavailable." }; return <p className={styles.notice} role="status"><CircleAlert size={16}/>{copy[state]}</p>; }
function Withheld({ state, retry }: {
    state: State;
    retry: () => void;
}) { if (state === "empty")
    return <div className={styles.empty}><Landmark size={22}/><h2>No accounts yet</h2><p>Connect a bank, upload a statement, add an investment or add an offline account.</p></div>; if (state === "loading")
    return <div className={styles.skeleton} aria-label="Loading account list"><i /><i /><i /><i /></div>; return <div className={styles.empty}><CircleAlert size={22}/><h2>Accounts are unavailable</h2><p>Check your connection and try again.</p><button type="button" onClick={retry}>Try again</button></div>; }
function Tools({ query, setQuery, input, filter, setFilter, showDormant, setShowDormant }: {
    query: string;
    setQuery: Dispatch<SetStateAction<string>>;
    input: RefObject<HTMLInputElement | null>;
    filter: Filter;
    setFilter: Dispatch<SetStateAction<Filter>>;
    showDormant: boolean;
    setShowDormant: Dispatch<SetStateAction<boolean>>;
}) { return <div className={styles.directoryTools}><label className={styles.search}><Search size={17}/><span className="sr-only">Find an account</span><input ref={input} value={query} onChange={event => setQuery(event.target.value)} type="search" name="account-search" autoComplete="off" spellCheck={false} placeholder="Find an account…"/>{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); requestAnimationFrame(() => input.current?.focus()); }}><X size={15}/></button>}</label><div className={styles.filters}><button onClick={() => setFilter("All")} aria-pressed={filter === "All"}>All</button><button onClick={() => setFilter("Pinned")} aria-pressed={filter === "Pinned"}>Pinned</button><button onClick={() => setShowDormant(value => !value)} aria-pressed={showDormant}>{showDormant ? "Hide dormant" : "Dormant"}</button></div></div>; }
function Directory({ shown, hidden, state, collapsed, setCollapsed, open }: {
    shown: PreviewAccount[];
    hidden: boolean;
    state: State;
    collapsed: Record<string, boolean>;
    setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
    open: (account: PreviewAccount, event: MouseEvent<HTMLButtonElement>) => void;
}) { return <><p className={styles.count}>{shown.length} accounts · Pinned accounts stay in their normal group.</p>{shown.length === 0 ? <EmptySearch /> : kinds.map(kind => { const entries = shown.filter(account => account.kind === kind); if (!entries.length)
    return null; const closed = collapsed[kind]; return <section className={styles.group} key={kind}><button type="button" className={styles.groupButton} onClick={() => setCollapsed(value => ({ ...value, [kind]: !value[kind] }))} aria-expanded={!closed}><span>{kind === "Pot" ? "Pots" : kind}<small>{entries.length} accounts</small></span><ChevronDown size={17} className={closed ? styles.chevronClosed : ""}/></button>{!closed && entries.map(account => <Row key={account.id} account={account} hidden={hidden} state={state} open={open}/>)}</section>; })}</>; }
function Position({ shown, hidden, state, collapsed, setCollapsed, open }: {
    shown: PreviewAccount[];
    hidden: boolean;
    state: State;
    collapsed: Record<string, boolean>;
    setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
    open: (account: PreviewAccount, event: MouseEvent<HTMLButtonElement>) => void;
}) {
    if (!shown.length)
        return <EmptySearch />;
    const unknown = state === "unknown" && shown.some(account => account.id === "starling-new");
    const assets = shown.reduce((total, account) => total + Math.max(0, account.balance ?? 0), 0);
    const owed = shown.reduce((total, account) => total + Math.min(0, account.balance ?? 0), 0);
    const net = assets + owed;
    const banks = [...new Set(shown.map(account => account.bank))];
    return <>
    <section className={styles.position}>
      <div><p>Net position</p><strong className={`${styles.net} ${styles.money}`}>{unknown ? "Unavailable" : money(net, hidden)}</strong><span>{unknown ? "A balance in these results is pending." : "Assets minus money owed"}</span><span>{shown.length} accounts shown · Totals follow your filters</span></div>
      {!unknown && <dl><div><dt>Assets</dt><dd className={styles.money}>{money(assets, hidden)}</dd></div><div><dt>Owed</dt><dd className={styles.money}>{money(owed, hidden)}</dd></div><div className={styles.reconciled}><dt>Net position</dt><dd className={styles.money}>{money(net, hidden)}</dd></div></dl>}
    </section>
    <section className={styles.bankList}><h2>By bank</h2>{banks.map(bank => {
            const entries = shown.filter(account => account.bank === bank);
            const closed = collapsed[`bank-${bank}`];
            const total = entries.reduce((sum, account) => sum + (account.balance ?? 0), 0);
            const incomplete = state === "unknown" && entries.some(account => account.id === "starling-new");
            return <section key={bank} className={styles.bank}>
        <button className={styles.bankHeader} type="button" onClick={() => setCollapsed(value => ({ ...value, [`bank-${bank}`]: !value[`bank-${bank}`] }))} aria-expanded={!closed}>
          <BankMark bank={bank}/><span><b>{bank}</b><small>{entries.length} accounts</small></span><strong className={styles.money}>{incomplete ? "Net unavailable" : `Net ${money(total, hidden)}`}</strong><ChevronDown size={17} aria-hidden="true" className={closed ? styles.chevronClosed : ""}/>
        </button>
        {!closed && entries.map(account => <Row key={account.id} account={account} hidden={hidden} state={state} open={open} compact/>)}
      </section>;
        })}</section>
  </>;
}
function Row({ account, hidden, state, open, compact = false }: {
    account: PreviewAccount;
    hidden: boolean;
    state: State;
    open: (account: PreviewAccount, event: MouseEvent<HTMLButtonElement>) => void;
    compact?: boolean;
}) { const unknown = state === "unknown" && account.id === "starling-new"; const syncing = state === "syncing" && account.id === "starling-everyday"; const short = account.id === "hsbc-pay"; return <button data-account-id={account.id} type="button" className={`${styles.row} ${compact ? styles.compactRow : ""}`} onClick={event => open(account, event)}><BankMark bank={account.bank}/><span className={styles.rowName}><strong>{account.pinned && <Star size={12} aria-label="Pinned" className={styles.star}/>}{account.name}</strong><small>{account.bank} · {account.kind}{account.dormant ? " · Dormant" : ""}{account.notCounted ? " · Not counted" : ""}{syncing ? " · Updating" : ""}</small>{short && <em className={styles.short}><AlertTriangle size={12}/>Payments need covering</em>}</span><span className={styles.amount}><strong className={`${styles.money} ${account.balance != null && account.balance < 0 ? styles.negative : ""}`}>{unknown ? "Balance pending" : money(account.balance, hidden)}</strong>{syncing && <small>Last known balance</small>}</span><ChevronRight size={17}/></button>; }
function BankMark({ bank }: {
    bank: Bank;
}) { const src = bankLogo[bank]; return <span className={styles.mark}>{src ? <Image src={src} width={28} height={28} alt=""/> : <Landmark size={16}/>}</span>; }
function EmptySearch() { return <div className={styles.empty}><Search size={22}/><h2>No account found</h2><p>Try another name, bank or account type.</p></div>; }
function Detail({ account, hidden, mode, onBack }: {
    account: PreviewAccount;
    hidden: boolean;
    mode: string;
    onBack: () => void;
}) { const heading = useRef<HTMLHeadingElement>(null); const [view, setView] = useState<"Transactions" | "Categories">("Transactions"); const [working, setWorking] = useState(false); const [counted, setCounted] = useState(!account.notCounted); const short = account.id === "hsbc-pay"; const canCount = account.balance != null && (account.kind === "Current" || account.kind === "Savings") && !short; const canExplain = account.available != null && account.payments != null && account.plans != null && account.low != null && account.buffer != null; useEffect(() => { heading.current?.focus(); }, []); return <main className={`${styles.page} ${mode === "dark" ? styles.dark : ""}`}><section className={`${styles.shell} ${styles.detail}`}><button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={17}/>Back to accounts</button><header className={styles.detailHead}><BankMark bank={account.bank}/><div><p>{account.bank} · {account.kind}</p><h1 ref={heading} tabIndex={-1}>{account.name}</h1></div></header><section className={styles.detailBalance}><span>Bank balance</span><strong className={`${styles.money} ${account.balance != null && account.balance < 0 ? styles.negative : ""}`}>{money(account.balance, hidden)}</strong>{account.available != null && <p>Available to spend <b className={styles.money}>{money(account.available, hidden)}</b>{short && <> · Projected shortfall <span className={styles.money}>{money(289, hidden)}</span> after payments</>}</p>}</section>{short && <p className={styles.estimate}>Estimate: payments due may take this account <span className={styles.money}>{money(289, hidden)}</span> below zero. Available is floored at <span className={styles.money}>{money(0, hidden)}</span>.</p>}{canCount ? <label className={styles.toggle}><span><b>Count towards Left to spend</b><small>Include this account in your spending estimate.</small></span><input type="checkbox" checked={counted} onChange={event => setCounted(event.target.checked)}/></label> : short ? <p className={styles.refusal}>This account stays counted while it has payments to cover.</p> : null}<section className={styles.working}><button type="button" onClick={() => setWorking(value => !value)} aria-expanded={working}>Working <ChevronDown size={17} className={working ? "" : styles.chevronClosed}/></button>{working && (canExplain ? <dl><div><dt>Bank balance</dt><dd className={styles.money}>{money(account.balance, hidden, true)}</dd></div><div><dt>Scheduled payments</dt><dd className={styles.money}>{money(-account.payments!, hidden, true)}</dd></div><div><dt>Plans held back</dt><dd className={styles.money}>{money(-account.plans!, hidden, true)}</dd></div><div><dt>Lowest projected balance</dt><dd className={styles.money}>{money(account.low!, hidden, true)}</dd></div><div><dt>Buffer</dt><dd className={styles.money}>{money(-account.buffer!, hidden, true)}</dd></div><div className={styles.availableTotal}><dt>Available to spend</dt><dd className={styles.money}>{money(account.available!, hidden, true)}</dd></div></dl> : <p className={styles.unavailable}>Working is unavailable for this account. No value has been inferred.</p>)}</section><div className={styles.tabs} aria-label="Account information"><button type="button" aria-pressed={view === "Transactions"} onClick={() => setView("Transactions")}>Transactions</button><button type="button" aria-pressed={view === "Categories"} onClick={() => setView("Categories")}>Categories</button></div><section className={styles.tabContent}><h2>{view}</h2><p>{view === "Transactions" ? "Synthetic activity would appear here. This preview does not request bank data." : "Categories are shown only after account activity is available."}</p></section></section></main>; }
