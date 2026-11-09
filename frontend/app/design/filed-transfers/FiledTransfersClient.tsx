"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Info, Search, Settings2 } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { FILED_TRANSFERS, PAGE_SIZE, PERIOD, shortDate, transferViews, type FiledTransfer, type FiledScope, type FilingFilter } from "./fixtures";
import { SeriesRows } from "./SeriesRows";
import styles from "./preview.module.css";

type Source = "spend" | "menu" | "review";
type Scenario = "ready" | "empty" | "loading" | "error" | "stale" | "undo-error" | "refresh-error" | "preferences-loading" | "long";
type Config = { variant: "a" | "b"; source: Source; state: Scenario; mode: "light" | "dark"; hidden: boolean; entry: boolean; page: number };
const SCENARIOS: Scenario[] = ["ready", "empty", "loading", "error", "stale", "undo-error", "refresh-error", "preferences-loading", "long"];
const currency = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
const sum = (values: { total: number }[]) => Math.round(values.reduce((total, row) => total + row.total, 0) * 100) / 100;

export default function FiledTransfersClient() {
  const params = useSearchParams();
  const source = params.get("source");
  const state = params.get("state") as Scenario;
  const config: Config = {
    variant: params.get("variant") === "b" ? "b" : "a",
    source: source === "menu" || source === "review" ? source : "spend",
    state: SCENARIOS.includes(state) ? state : "ready",
    mode: params.get("mode") === "dark" ? "dark" : "light",
    hidden: params.get("hidden") === "1" || params.get("state") === "hidden",
    entry: params.get("screen") === "entry",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
  return <Preview key={JSON.stringify(config)} config={config} />;
}

function Preview({ config }: { config: Config }) {
  const [scenario, setScenario] = useState<Scenario>(config.state);
  const [hide, setHide] = useState(config.hidden);
  const hidden = hide || scenario === "preferences-loading";
  const initialRows = config.state === "empty" ? [] : FILED_TRANSFERS.map(row => config.state === "long" && row.id === "bills" ? { ...row, toAccount: "Joint household bills, annual subscriptions and shared household commitments account" } : row);
  const [rows, setRows] = useState<FiledTransfer[]>(initialRows);
  const [heroRows, setHeroRows] = useState<FiledTransfer[]>(initialRows);
  const [returned, setReturned] = useState<FiledTransfer[]>([]);
  const [sheet, setSheet] = useState<"filed" | "menu" | "review" | null>(config.entry ? config.source === "spend" ? null : config.source : "filed");
  const [scope, setScope] = useState<FiledScope>(config.source === "spend" ? "period" : "all");
  const [filter, setFilter] = useState<FilingFilter>(config.source === "review" ? "sorted" : "all");
  const [page, setPage] = useState(config.page);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [refreshPending, setRefreshPending] = useState(false);
  const attempted = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", config.mode === "dark");
    return () => { document.documentElement.classList.toggle("dark", wasDark); };
  }, [config.mode]);
  useEffect(() => { if (pendingId) confirmationHeading.current?.focus({ preventScroll: true }); }, [pendingId]);

  function money(amount: number, sign?: "debit" | "credit") {
    const prefix = sign === "debit" || amount < 0 ? "−" : sign === "credit" ? "+" : "";
    return prefix + (hidden ? "£••••" : currency.format(Math.abs(amount)));
  }
  function link(overrides: Record<string, string>) {
    const params = new URLSearchParams({ variant: config.variant, source: config.source, state: config.state, mode: config.mode, ...(hide ? { hidden: "1" } : {}), ...overrides });
    return "/design/filed-transfers?" + params.toString();
  }
  function openFiled(nextScope: FiledScope, nextFilter: FilingFilter) {
    setScope(nextScope); setFilter(nextFilter); setPage(1); setPendingId(null); setSheet("filed"); setNotice("");
  }
  function changeFilter(value: FilingFilter) { setFilter(value); setPage(1); setNotice(""); }
  function refresh() { setScenario("ready"); setHeroRows(rows); setRefreshPending(false); setNotice("List and totals updated."); }
  function finishUndo() {
    const row = rows.find(value => value.id === pendingId);
    if (!row || busyId) return;
    setBusyId(row.id); setErrors({});
    timer.current = setTimeout(() => {
      if (scenario === "undo-error" && !attempted.current.has(row.id)) {
        attempted.current.add(row.id);
        setErrors({ [row.id]: "Couldn’t undo this series. It is still filed. Try again." });
        setBusyId(null);
        return;
      }
      const remaining = rows.filter(value => value.id !== row.id);
      setRows(remaining); setReturned(previous => [...previous, row]);
      setPendingId(null); setBusyId(null);
      const waiting = scenario === "refresh-error";
      setRefreshPending(waiting);
      if (!waiting) setHeroRows(remaining);
      setNotice("Series undone. Its " + row.occurrences.length * 2 + " entries are back in transfer review.");
      queueMicrotask(() => noticeRef.current?.focus({ preventScroll: true }));
    }, 350);
  }
  function confirmAgain(row: FiledTransfer) {
    const next = [...rows, { ...row, source: "confirmed" as const, reason: "You confirmed that these payments are one transfer." }];
    setRows(next); setHeroRows(next); setRefreshPending(false); setReturned(previous => previous.filter(value => value.id !== row.id));
    setNotice("Transfer confirmed and totals updated.");
  }
  const view = transferViews(rows, scope, filter);
  const pages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = view.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const total = sum(transferViews(rows, scope));
  const heroTotal = sum(transferViews(heroRows, "period"));
  const automaticCount = rows.filter(row => row.source !== "confirmed").length;
  const pending = rows.find(row => row.id === pendingId);
  const unknown = scenario === "loading" || scenario === "error";
  const theme = [styles.sheetTheme, config.mode === "dark" ? "dark" : "", config.mode === "dark" ? styles.darkTheme : ""].join(" ");
  const completedEntries = returned.reduce((n, row) => n + row.occurrences.length * 2, 0);

  return <main className={[styles.preview, config.mode === "dark" ? "dark" : ""].join(" ")}>
    <div className={styles.reviewTools}>
      <Link href="/design" className={styles.back}>Back to design reviews</Link>
      <h1>Transfers Sorted filed</h1>
      <p>G449. Compare the same shared sheet, with fictional data and local actions only.</p>
      <nav aria-label="Design variants" className={styles.variants}>
        <Link href={link({ variant: "a" })} aria-current={config.variant === "a" ? "page" : undefined}>A · Compact history</Link>
        <Link href={link({ variant: "b" })} aria-current={config.variant === "b" ? "page" : undefined}>B · Evidence first</Link>
      </nav>
      <div className={styles.tools}>
        <label>Entry point<select value={config.source} onChange={event => window.location.assign(link({ source: event.target.value, screen: "entry" }))}><option value="spend">Spend amount</option><option value="menu">Pay periods</option><option value="review">Transfer review</option></select></label>
        <label>Scenario<select value={config.state} onChange={event => window.location.assign(link({ state: event.target.value }))}>{SCENARIOS.map(value => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
        <Link href={link({ mode: config.mode === "dark" ? "light" : "dark" })}>{config.mode === "dark" ? "Light theme" : "Dark theme"}</Link>
      </div>
    </div>
    <section className={styles.product} aria-label="Fictional Spend preview">
      <header className={styles.productHeader}><h2>Spending</h2><button type="button" onClick={() => setSheet("menu")} aria-haspopup="dialog">Pay periods <ChevronRight size={16} aria-hidden="true" /></button></header>
      <p className={styles.period}>{PERIOD.label}</p>
      <div className={styles.privacy}><span>{hidden ? "Balances hidden" : "Balances visible"}</span><button type="button" disabled={scenario === "preferences-loading"} onClick={() => setHide(value => !value)}>{hidden ? "Show balances" : "Hide balances"}</button></div>
      {scenario === "preferences-loading" && <p className={styles.quiet}>Waiting for your display preference. Amounts stay hidden.</p>}
      <section className={styles.hero} aria-label="Spend summary">
        <p className={styles.label}>Out this pay period</p><p className={styles.out}><MoneyText text={money(1642.38)} /></p>
        <div className={styles.flowRow}><div><p className={styles.label}>In</p><p><MoneyText text={money(4798)} /></p></div><div><p className={styles.label}>Moved separately</p><button type="button" data-open-filed-period aria-haspopup="dialog" onClick={() => openFiled("period", "all")}><MoneyText text={money(heroTotal)} /><ChevronRight size={16} aria-hidden="true" /></button></div></div>
        <p className={styles.quiet}>Moved money is separate from Out.</p>
        {refreshPending && <p className={styles.quiet}>Using last known totals until the refresh completes.</p>}
      </section>
      <button type="button" className={styles.reviewEntry} aria-haspopup="dialog" onClick={() => { setNotice(""); setSheet("review"); }}><span>Review these transfers</span><span>{completedEntries ? completedEntries + " entries" : "Nothing waiting"}<ChevronRight size={16} aria-hidden="true" /></span></button>
      <p className={styles.example}>Fictional example. Preview actions do not change your accounts.</p>
    </section>

    {sheet === "menu" && <SheetFrame title="Pay periods" description="Fictional example" onClose={() => setSheet(null)} themeClass={theme}>{({ closeThen }) => <div className={styles.menu}>
      <button type="button" onClick={() => closeThen(() => openFiled("period", "all"))}><span>{PERIOD.label}</span><span>Current</span></button>
      <div className={styles.menuDivider} />
      <p><Search size={17} aria-hidden="true" />Search transactions</p>
      <p><Settings2 size={17} aria-hidden="true" />Pay period settings</p>
      <p><Info size={17} aria-hidden="true" />How we categorise your money</p>
      <button type="button" data-open-filed-all onClick={() => closeThen(() => openFiled("all", "all"))}><ArrowLeftRight size={17} aria-hidden="true" /><span>Transfers Sorted filed</span><ChevronRight size={17} aria-hidden="true" /></button>
    </div>}</SheetFrame>}

    {sheet === "review" && <SheetFrame title="Review these transfers" description="Fictional example" themeClass={theme} onClose={() => setSheet(null)} footer={({ close }) => <button type="button" className={styles.primary} onClick={close}>Done</button>}>{({ closeThen }) => <div className={styles.reviewBody}>
      <p role="status">{notice || (returned.length ? "These entries are back for review." : "Nothing waiting for review.")}</p>
      <p className={styles.quiet}>Filed transfers stay available even when this review is clear.</p>
      <button type="button" data-open-filed-sorted className={styles.filedEntry} onClick={() => closeThen(() => openFiled("all", "sorted"))}><span>Filed automatically: {automaticCount} series</span><ChevronRight size={17} aria-hidden="true" /></button>
      {returned.map(row => <article key={row.id} className={styles.returned}><h3>{row.fromBank} to {row.toBank}</h3><p className={styles.quiet}>{row.occurrences.length} payments, with both entries returned.</p>{row.occurrences.map(item => <div key={item.date} className={styles.reviewReceipt}><span>{shortDate(item.date)}</span><span><MoneyText text={money(item.amount, "debit")} /><MoneyText text={money(item.amount, "credit")} /></span></div>)}<button type="button" className={styles.secondary} onClick={() => confirmAgain(row)}>Yes, same transfer</button></article>)}
    </div>}</SheetFrame>}

    {sheet === "filed" && <SheetFrame title={pending ? "Undo this series?" : "Transfers Sorted filed"} description={<span>{scope === "period" ? PERIOD.label : "All time"} · Fictional example</span>} themeClass={theme} onClose={() => { setSheet(null); setPendingId(null); }} dismissDisabled={!!busyId}
      footer={({ close, closeThen }) => pending ? <div className={styles.confirmActions}><button type="button" disabled={!!busyId} className={styles.secondary} onClick={() => { setPendingId(null); setErrors({}); }}>Keep filed</button><button type="button" disabled={!!busyId} className={styles.primary} onClick={finishUndo}>{busyId ? "Undoing…" : "Undo series"}</button></div> : <div className={styles.footer}>
        {!unknown && view.length > 0 && <nav aria-label="Transfer pages" className={styles.pagination}><button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><span>Page {currentPage} of {pages}<small>{(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, view.length)} of {view.length} series</small></span><button type="button" aria-label="Next page" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} aria-hidden="true" /></button></nav>}
        {returned.length > 0 && <button type="button" className={styles.secondary} onClick={() => closeThen(() => { setNotice(""); setSheet("review"); })}>Review returned entries ({completedEntries})</button>}
        <button type="button" className={styles.primary} onClick={close}>Done</button>
      </div>}>
      {pending ? <section className={styles.confirm}>
        <h3 ref={confirmationHeading} tabIndex={-1}>{pending.fromBank} to {pending.toBank}</h3>
        <p>{pending.fromAccount} to {pending.toAccount}</p>
        <p>This undoes the whole series: {pending.occurrences.length} {pending.occurrences.length === 1 ? "payment" : "payments"}, including any outside this pay period. Both entries for each payment will return to transfer review.</p>
        <p>Sorted will stop using this saved match. Undo changes how the entries are filed; it does not move any money.</p>
        {errors[pending.id] && <p className={styles.error} role="alert">{errors[pending.id]}</p>}
        {busyId && <p role="status">Undoing this series and updating totals…</p>}
      </section> : <div className={styles.sheetBody}>
        {!unknown && <><div className={styles.sheetSummary}><p className={styles.count}>{view.length} series</p>{scope === "period" && filter === "all" && <p className={styles.scopeTotal}><MoneyText text={money(total)} /></p>}</div>
          <p className={styles.quiet}>{scope === "period" ? "Moved separately this pay period. Each payment is counted once, not both entries." : "Your filed transfers, newest first. Includes transfers you confirmed."}</p>
          <div className={styles.filters} aria-label="Filing source">{([["all", "All"], ["sorted", "Filed by Sorted"], ["confirmed", "You confirmed"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{label}</button>)}</div></>}
        {notice && <p className={styles.notice} role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
        {refreshPending && <div className={styles.error} role="status"><p>Undo is saved. Spend totals have not refreshed yet.</p><button type="button" className={styles.textAction} onClick={refresh}>Refresh totals</button></div>}
        {scenario === "stale" && <div className={styles.error}><p>Last updated 8 Nov at 18:40. New transfers may be missing.</p><button type="button" className={styles.textAction} onClick={refresh}>Refresh list</button></div>}
        {scenario === "loading" ? <div role="status" aria-label="Loading filed transfers" className={styles.skeleton}><span /><span /><span /><p>Loading filed transfers…</p></div>
          : scenario === "error" ? <div className={styles.empty}><h3>Transfers could not be loaded</h3><p>Your filed transfers have not changed.</p><button type="button" className={styles.secondary} onClick={refresh}>Try again</button></div>
          : view.length === 0 ? <div className={styles.empty}><h3>{filter !== "all" ? "No series match this filter" : scope === "period" ? "No filed transfers in this pay period" : "No filed transfers yet"}</h3><p>{filter !== "all" ? "Choose All to see the other filing sources." : scope === "period" ? "You can still check the transfers filed in other pay periods." : "When a transfer is filed, it will stay available here after review."}</p>{filter !== "all" ? <button type="button" className={styles.secondary} onClick={() => changeFilter("all")}>Show all filing sources</button> : scope === "period" && <button type="button" className={styles.secondary} onClick={() => openFiled("all", "all")}>See all time</button>}</div>
          : <SeriesRows rows={visible} variant={config.variant} formatMoney={money} busyId={busyId} undoingId={pendingId} errors={errors} onAskUndo={setPendingId} />}
      </div>}
    </SheetFrame>}
  </main>;
}
