"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ChevronDown, ChevronLeft } from "lucide-react";
import { BankIcon } from "@/components/AccountMiniCard";
import ForecastStatusBadge from "@/components/ForecastStatusBadge";
import MoneyText from "@/components/MoneyText";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import DisclosureSet from "./DisclosureSet";
import ExistingLayout from "./ExistingLayout";
import { EXAMPLES, EXAMPLE_IDS } from "./fixtures";
import { COUNTS_INTRO, money, type Example, type Variant } from "./model";
import styles from "./preview.module.css";

function Hero({ example, onNavigate }: { example: Example; onNavigate: (destination: string) => void }) {
  return <div data-g408-hero className={styles.hero}>
    <div className={styles.heading}><h2>{example.headlineLabel}</h2><ForecastStatusBadge status={example.status} /></div>
    {example.headline !== null ? <p className={`${styles.amount} ${example.syncing ? styles.muted : ""}`}><MoneyText text={money(example.headline)} /></p> : <p className={styles.unavailable}>Forecast unavailable</p>}
    {example.syncing && <p className={styles.sync}>Last known amount · updating bank data</p>}
    <p className={styles.support}><MoneyText text={example.support} /></p>
    <p data-sts-counts className={styles.counts}>{COUNTS_INTRO}</p>
    {example.sources.length > 0 && <div data-g408-sources className={styles.sources}>
      <h3>Spend from</h3>
      {example.sources.map(source => <div key={source.account.id} className={styles.source}>
        <BankIcon identity={source.account} size={24} altText="" />
        <span className={styles.sourceName}>{source.account.provider}</span>
        <MoneyText text={`up to ${money(source.limit)}`} className={styles.limit} />
      </div>)}
      <p>{example.syncing ? "Last known account limits. " : ""}{example.sources.length > 1 ? "Each amount is that account’s limit within the estimate. Don’t add them together." : "This account’s limit is within the estimate above."}</p>
    </div>}
    {example.recovery && <button type="button" className={styles.recovery} onClick={() => onNavigate(example.recovery!.destination)}>{example.recovery.label}<ArrowRight size={15} aria-hidden="true" /></button>}
  </div>;
}

export default function Preview() {
  const params = useSearchParams();
  const variant: Variant = params.get("variant") === "c" ? "c" : params.get("variant") === "a" ? "a" : "b";
  const state = EXAMPLE_IDS.includes(params.get("state") ?? "") ? params.get("state")! : "reference";
  const example = EXAMPLES[state];
  const dark = params.get("mode") === "dark";
  const hidden = params.get("hidden") === "1";
  const clean = params.get("clean") === "1";
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const prior = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.g408Ready = "1";
    return () => { document.documentElement.classList.toggle("dark", prior); delete document.documentElement.dataset.g408Ready; };
  }, [dark]);
  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([key, value]) => next.set(key, value));
    return `/design/left-to-spend-disclosures?${next.toString()}`;
  };
  const navigate = (destination: string) => setNotice(destination === "/cards" ? "Preview: opens Your cards." : destination === "/refresh" ? "Preview: retries the forecast." : destination === "/accounts" ? "Preview: opens Your accounts." : "Preview: opens Upcoming.");
  const disclosures = <DisclosureSet key={`${variant}-${state}-${hidden}-${dark}`} example={example} embedded={variant === "a"} onCards={() => navigate("/cards")} />;
  return <div className={dark ? "dark" : ""}><main className={styles.page}>
    {!clean && <header className={styles.controls}>
      <div className={styles.title}><h1>Behind Left to spend</h1><Link href="/design"><ChevronLeft size={15} aria-hidden="true" />Designs</Link></div>
      <p>G408 · Three layouts for the estimate details. Invented figures; production is unchanged.</p>
      <nav aria-label="Design alternatives" className={styles.options}>
        {(["a", "b", "c"] as const).map(id => <Link key={id} aria-current={variant === id ? "page" : undefined} href={href({ variant: id })}>{id === "a" ? "A · Within the estimate" : id === "b" ? "B · One detail card" : "C · Existing layout, refined"}</Link>)}
        <Link className={styles.fullScreen} href={href({ clean: "1" })}>Open full screen<ArrowRight size={14} aria-hidden="true" /></Link>
      </nav>
      <details className={styles.examples}><summary>Examples and display<ChevronDown size={15} aria-hidden="true" /></summary><div>
        {EXAMPLE_IDS.map(id => <Link key={id} aria-current={state === id ? "page" : undefined} href={href({ state: id })}>{EXAMPLES[id].label}</Link>)}
        <Link href={href({ mode: dark ? "light" : "dark" })}>{dark ? "Light theme" : "Dark theme"}</Link>
        <Link href={href({ hidden: hidden ? "0" : "1" })}>{hidden ? "Show balances" : "Hide balances"}</Link>
      </div></details>
    </header>}
    <BalancesHiddenContext.Provider value={hidden}>
      <div data-g408-surface className={styles.surface}>
        {variant === "c" ? <ExistingLayout key={`${state}-${hidden}-${dark}`} example={example} hidden={hidden} onNavigate={navigate} /> : <>
        <section className={styles.heroCard} aria-label="Estimated left to spend">
          <Hero example={example} onNavigate={navigate} />
          {variant === "a" && disclosures}
        </section>
        {variant === "b" && disclosures}
        </>}
        <h2 data-g408-following-section className={styles.following}>Your money</h2>
      </div>
    </BalancesHiddenContext.Provider>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </main></div>;
}
