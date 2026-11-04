"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, Eye, EyeOff, Moon, Sun } from "lucide-react";
import UpcomingFlowSheet from "@/components/UpcomingFlowSheet";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { AccountDetails, AccountList, Badge, RecordDetails, type Variant, type View } from "./Parts";
import { fixtureFor, SCENARIOS, type Scenario } from "./fixtures";
import styles from "./preview.module.css";

function Round({ variant, scenario, mode, initiallyHidden }: { variant: Variant; scenario: Scenario; mode: "light" | "dark"; initiallyHidden: boolean }) {
  const fixture = useMemo(() => fixtureFor(scenario), [scenario]);
  const [status, setStatus] = useState(fixture.status), [hidden, setHidden] = useState(initiallyHidden), [view, setView] = useState<View | null>(null), [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    const root = document.documentElement, priorDark = root.classList.contains("dark"), priorScheme = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode;
    return () => { root.classList.toggle("dark", priorDark); root.style.colorScheme = priorScheme; };
  }, [mode]);
  const query = (next: { variant?: Variant; state?: Scenario; mode?: "light" | "dark" }) => `?variant=${next.variant ?? variant}&state=${next.state ?? scenario}&mode=${next.mode ?? mode}${hidden ? "&hidden=1" : ""}`;
  return <BalancesHiddenContext.Provider value={hidden}>
    <div data-preview-ready={ready} className={styles.page} inert={view !== null} aria-hidden={view ? true : undefined}>
      <a href="#preview" className={styles.skip}>Skip to preview</a>
      <header className={styles.reviewHeader}><div className={styles.reviewInner}><div className={styles.reviewTop}><Link href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link><span className={styles.roundLabel}>G417</span><Link href={query({ mode: mode === "dark" ? "light" : "dark" })} className={styles.theme} aria-label={`Use ${mode === "dark" ? "light" : "dark"} theme`}>{mode === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Link></div>
        <h1>Upcoming · shortfall first</h1><nav className={styles.variantNav} aria-label="Design alternatives"><Link href={query({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · One list</Link><Link href={query({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Separate the actions</Link></nav>
        <div className={styles.reviewControls}><details className={styles.scenarios}><summary><span>Example: {SCENARIOS.find(item => item.id === scenario)?.label}</span><ChevronDown size={16} aria-hidden="true" /></summary><nav aria-label="Example scenarios">{SCENARIOS.map(item => <Link key={item.id} href={query({ state: item.id })} aria-current={scenario === item.id ? "page" : undefined}>{item.label}</Link>)}</nav></details><button type="button" data-privacy onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label={hidden ? "Show balances" : "Hide balances"} className={styles.privacy}>{hidden ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}</button></div>
      </div></header>
      <main id="preview" className={styles.main}><div className={styles.previewColumn}><AccountList accounts={fixture.accounts} status={status} variant={variant} onOpen={account => setView({ kind: "account", accountId: account.id })} retry={() => setStatus("ready")} /></div><section aria-label="About this direction" className={styles.about}><h2>{variant === "a" ? "A · Read the gap, then the move" : "B · Separate the two jobs"}</h2><p>{variant === "a" ? "One bounded account list. Each shortfall comes first, with the suggested move and its result directly underneath." : "Accounts needing money come first. The account funding a suggested move has its own place, so a source’s positive balance cannot be mistaken for a covered gap."}</p><p>Tap an account to see its result before any suggested move, then what the move would change. Exact pence stay in the working.</p><p className={styles.demoNote}>Fictional examples only. Both directions are proposals for Upcoming. Your Home and Accounts views are unchanged.</p></section></main>
    </div>
    {view && <UpcomingFlowSheet<View> initialView={view} onClose={() => setView(null)} renderView={(current, navigation) => {
      const account = fixture.accounts.find(item => item.id === current.accountId)!;
      const record = current.kind === "event" ? account.events.find(event => event.id === current.id) : current.kind === "plan" ? account.plans.find(plan => plan.id === current.id) : null;
      return { title: current.kind === "account" ? account.bank : record?.name ?? account.bank, subtitle: current.kind === "account" ? account.name : "Example record", leading: current.kind === "account" ? <Badge account={account} /> : undefined,
        body: current.kind === "account" ? <AccountDetails account={account} status={status} variant={variant} navigation={navigation} /> : <RecordDetails account={account} view={current} />,
        footer: <button type="button" className={styles.done} onClick={navigation.close}>Done</button> };
    }} />}
  </BalancesHiddenContext.Provider>;
}
export default function Preview() {
  const params = useSearchParams(), variant = params.get("variant") === "b" ? "b" : "a", scenario = SCENARIOS.find(item => item.id === params.get("state"))?.id ?? "mixed", mode = params.get("mode") === "dark" ? "dark" : "light", hidden = params.get("hidden") === "1";
  return <Round key={`${variant}-${scenario}-${mode}-${hidden}`} variant={variant} scenario={scenario} mode={mode} initiallyHidden={hidden} />;
}
