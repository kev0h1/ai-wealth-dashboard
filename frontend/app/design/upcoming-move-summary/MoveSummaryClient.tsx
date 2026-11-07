"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SheetFrame } from "@/components/SheetFrame";
import UpcomingAccountDetails from "@/components/upcoming/UpcomingAccountDetails";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { displayAccountName } from "@/lib/accountName";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import AccountSummaryPreview from "./AccountSummaryPreview";
import { exampleAccounts, examplePlans, examplePlansStatus, PERIOD, SOURCE_BANKS } from "./fixtures";
import { EXAMPLES, previewHref, type PreviewParams } from "./previewParams";
import styles from "./preview.module.css";

const VARIANTS = [
  { value: "a", label: "A · Account-aligned", description: "The summary follows the account name’s reading edge, keeping the existing row structure." },
  { value: "b", label: "B · Full-width", description: "The summary uses the row’s full width, giving amounts, dates and uncovered balances more room." },
  { value: "current", label: "Current", description: "The current By account card on the same fictional accounts, for comparison." },
] as const;

export default function MoveSummaryClient(params: PreviewParams) {
  const { variant, mode, state, hidden } = params;
  useEffect(() => {
    const root = document.documentElement, previousDark = root.classList.contains("dark"), previousScheme = root.style.colorScheme;
    const apply = () => { if (root.classList.contains("dark") !== (mode === "dark")) root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode; };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); root.classList.toggle("dark", previousDark); root.style.colorScheme = previousScheme; };
  }, [mode]);
  const accounts = useMemo(() => exampleAccounts(state), [state]);
  const plans = useMemo(() => examplePlans(state), [state]);
  const plansStatus = examplePlansStatus(state);
  const [selected, setSelected] = useState<UpcomingAccountSummary | null>(null);
  const href = (change: Partial<PreviewParams>) => previewHref({ ...params, ...change });
  const retry = () => window.location.assign(href({ state: "moves" }));
  const direction = VARIANTS.find(item => item.value === variant)!;
  return <div data-mode={mode} className={`${styles.shell} ${mode === "dark" ? "dark" : ""}`}>
    <main className={styles.page} inert={!!selected}>
      <a href="#g430-stage" className={styles.skip}>Skip to account example</a>
      <header className={styles.reviewHeader}>
        <Link href="/design" prefetch={false} className={styles.back}>Back to design previews</Link>
        <h1>Move summaries</h1>
        <p>Keep By account to a short summary. Open an account for the full detail. Fictional accounts and example figures.</p>
        <nav className={styles.variantControls} aria-label="Summary layout">{VARIANTS.map(item => <Link key={item.value} href={href({ variant: item.value })} prefetch={false} aria-current={variant === item.value ? "page" : undefined}>{item.label}</Link>)}</nav>
        <div className={styles.controls}>
          <nav className={styles.themeControls} aria-label="Preview theme">{(["light", "dark"] as const).map(value => <Link key={value} href={href({ mode: value })} prefetch={false} aria-current={mode === value ? "page" : undefined}>{value === "light" ? "Light" : "Dark"}</Link>)}</nav>
          <button type="button" aria-pressed={hidden} onClick={() => window.location.assign(href({ hidden: !hidden }))}>Hide balances</button>
          <label htmlFor="g430-example">Example<select id="g430-example" name="example" value={state} onChange={event => window.location.assign(href({ state: event.target.value as PreviewParams["state"] }))}>{EXAMPLES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </header>
      <section className={styles.direction} aria-labelledby="g430-direction"><h2 id="g430-direction">{direction.label}</h2><p>{direction.description}</p></section>
      <BalancesHiddenContext.Provider value={hidden}>
        <div id="g430-stage" tabIndex={-1} className={styles.stage} data-g430-stage>{variant === "current" ? <UpcomingAccountsCard accounts={accounts} sourceBanks={SOURCE_BANKS} periodLabel={PERIOD} plans={plans} plansStatus={plansStatus} onOpen={setSelected} onRetry={retry} /> : <AccountSummaryPreview accounts={accounts} periodLabel={PERIOD} plans={plans} plansStatus={plansStatus} variant={variant} onOpen={setSelected} onRetry={retry} />}</div>
        {state === "empty" && <p className={styles.emptyExample}>There is no By account card when there are no accounts to list.</p>}
      </BalancesHiddenContext.Provider>
    </main>
    <BalancesHiddenContext.Provider value={hidden}>{selected && <SheetFrame title={selected.bank} description={displayAccountName(selected.name)} themeClass={mode === "dark" ? "dark" : ""} onClose={() => setSelected(null)} footer={({ close }) => <button type="button" className={styles.done} onClick={close}>Done</button>}>
      <UpcomingAccountDetails account={selected} periodLabel={PERIOD} plans={plans} plansStatus={plansStatus} />
    </SheetFrame>}</BalancesHiddenContext.Provider>
  </div>;
}
