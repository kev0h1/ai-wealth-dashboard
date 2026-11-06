"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SheetFrame } from "@/components/SheetFrame";
import UpcomingAccountDetails from "@/components/upcoming/UpcomingAccountDetails";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { displayAccountName } from "@/lib/accountName";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import AccountRowsPreview from "./AccountRowsPreview";
import { EXAMPLE_STATES, exampleAccounts, examplePlansStatus, PERIOD, SOURCE_BANKS } from "./fixtures";
import { previewHref, type PreviewParams } from "./previewParams";
import styles from "./preview.module.css";

const variants = [
  { value: "a", label: "A · Aligned summary", description: "The headline stays beside the account. Status gets a clear line below, followed by the explanation and indented sources." },
  { value: "b", label: "B · Reading line", description: "The account name has the header to itself. Status and the headline share a separate line, with all amounts aligned." },
  { value: "current", label: "Current layout", description: "The current component, on the same example data, for comparison." },
] as const;

export default function AccountRowsClient(params: PreviewParams) {
  const { variant, mode, state, hidden } = params;
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const previousScheme = root.style.colorScheme;
    const apply = () => {
      if (root.classList.contains("dark") !== (mode === "dark")) root.classList.toggle("dark", mode === "dark");
      root.style.colorScheme = mode;
    };
    apply();
    // App preferences can settle after this preview hydrates. Its explicit mode wins while open.
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => { observer.disconnect(); root.classList.toggle("dark", wasDark); root.style.colorScheme = previousScheme; };
  }, [mode]);
  const accounts = useMemo(() => exampleAccounts(state), [state]);
  const plansStatus = examplePlansStatus(state);
  const [selected, setSelected] = useState<UpcomingAccountSummary | null>(null);
  const href = (change: Partial<PreviewParams>) => previewHref({ ...params, ...change });
  const retry = () => window.location.assign(href({ state: "moves" }));
  const direction = variants.find(item => item.value === variant)!;
  return <div className={`${styles.shell} ${mode === "dark" ? "dark" : ""}`} data-mode={mode}>
    <main className={styles.page}>
      <header className={styles.reviewHeader}>
        <Link href="/design" prefetch={false} className={styles.back}>Back to design previews</Link>
        <h1>By account layouts</h1>
        <p>Compare how the account reading and suggested sources sit together. Fictional accounts and example figures only.</p>
        <nav className={styles.variantControls} aria-label="Layout options">{variants.map(item => <Link key={item.value} href={href({ variant: item.value })} prefetch={false} aria-current={variant === item.value ? "page" : undefined}>{item.label}</Link>)}</nav>
        <div className={styles.controls}>
          <nav aria-label="Preview theme" className={styles.themeControls}>{(["light", "dark"] as const).map(value => <Link key={value} href={href({ mode: value })} prefetch={false} aria-current={mode === value ? "page" : undefined}>{value === "light" ? "Light" : "Dark"}</Link>)}</nav>
          <button type="button" aria-pressed={hidden} onClick={() => window.location.assign(href({ hidden: !hidden }))}>Hide balances</button>
          <label htmlFor="g429-example">Example<select id="g429-example" value={state} onChange={event => window.location.assign(href({ state: event.target.value as PreviewParams["state"] }))}>{EXAMPLE_STATES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </header>
      <section className={styles.direction} aria-labelledby="g429-direction"><h2 id="g429-direction">{direction.label}</h2><p>{direction.description}</p></section>
      <BalancesHiddenContext.Provider value={hidden}>
        <div className={styles.stage} data-g429-stage>
          {variant === "current" ? <UpcomingAccountsCard accounts={accounts} periodLabel={PERIOD} plans={[]} plansStatus={plansStatus} onOpen={setSelected} onRetry={retry} /> : <AccountRowsPreview accounts={accounts} periodLabel={PERIOD} plansStatus={plansStatus} variant={variant} sourceBanks={SOURCE_BANKS} onOpen={setSelected} onRetry={retry} />}
        </div>
        {state === "empty" && <p className={styles.emptyExample}>The By account card is absent when there are no accounts to list.</p>}
        {selected && <SheetFrame title={selected.bank} description={displayAccountName(selected.name)} themeClass={mode === "dark" ? "dark" : ""} onClose={() => setSelected(null)} footer={({ close }) => <button type="button" className={styles.done} onClick={close}>Done</button>}>
          <UpcomingAccountDetails account={selected} periodLabel={PERIOD} plans={[]} plansStatus={plansStatus} />
        </SheetFrame>}
      </BalancesHiddenContext.Provider>
    </main>
  </div>;
}
