"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Moon, Sun } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import { BalancesHiddenContext } from "@/lib/balancesHidden";
import { PERIOD_LABEL, SCENARIOS, previewAccounts, type PreviewAccount, type ScenarioId } from "./G416Fixtures";
import { AccountRow, BankMark, Events, Figures, FineAccounts, PlanList, Verdict, Working } from "./G416Parts";
import styles from "./preview.module.css";

function Preview({ variant, scenario, mode, initialHidden, initialAccount }: { variant: "a" | "b"; scenario: ScenarioId; mode: "light" | "dark"; initialHidden: boolean; initialAccount: string | null }) {
  const [hidden, setHidden] = useState(initialHidden);
  const [dark, setDark] = useState(mode === "dark");
  const accounts = previewAccounts(scenario);
  const [opened, setOpened] = useState<PreviewAccount | null>(accounts.find(a => a.id === initialAccount) ?? null);
  useEffect(() => {
    const root = document.documentElement, wasDark = root.classList.contains("dark"), previous = root.style.colorScheme;
    root.classList.toggle("dark", dark); root.style.colorScheme = dark ? "dark" : "light";
    return () => { root.classList.toggle("dark", wasDark); root.style.colorScheme = previous; };
  }, [dark]);
  const query = (change: { variant?: "a" | "b"; state?: ScenarioId }) => `?variant=${change.variant ?? variant}&state=${change.state ?? scenario}&mode=${dark ? "dark" : "light"}${hidden ? "&hidden=1" : ""}`;
  const attention = accounts.filter(a => a.signal), fine = accounts.filter(a => !a.signal);
  const close = () => setOpened(null);
  const list = <>{!attention.length && <p className={styles.allClear}>Every account covers its payments and linked plans.</p>}{attention.map(account => <AccountRow key={account.id} account={account} onOpen={setOpened} />)}<FineAccounts accounts={fine} onOpen={setOpened} /><p className={styles.listNote}>Tap an account for its working.</p></>;
  return <BalancesHiddenContext.Provider value={hidden}><div className={styles.preview} data-g416-ready data-variant={variant}>
    <a href="#account-preview" className={styles.skipLink}>Skip to account preview</a>
    <header className={styles.toolbar}><div className={styles.toolbarInner}>
      <div className={styles.toolbarTop}><Link href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design rounds</Link><button type="button" aria-label={`Use ${dark ? "light" : "dark"} theme`} className={styles.iconButton} onClick={() => setDark(!dark)}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button></div>
      <h1>Upcoming, account by account</h1><p className={styles.intro}>Two ways to make account availability and suggested moves easier to read. Invented examples. Tap any account to open its sheet.</p>
      <nav aria-label="Design variants" className={styles.variants}><Link href={query({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined} className={styles.variantLink}>A · A clearer account list</Link><Link href={query({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined} className={styles.variantLink}>B · Follow the dates</Link></nav>
      <nav aria-label="Example states" className={styles.scenarios}>{SCENARIOS.map(item => <Link key={item.id} href={query({ state: item.id })} aria-current={scenario === item.id ? "page" : undefined} className={styles.scenarioLink}>{item.label}</Link>)}</nav>
    </div></header>
    <main id="account-preview" className={styles.reviewCanvas}><div className={styles.surface}><h2 className={styles.pageTitle}>Upcoming</h2><p className={styles.period}>This pay period · 4 to 19 Nov</p><button type="button" data-hide-balances aria-pressed={hidden} className={styles.privacy} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}{hidden ? "Show balances" : "Hide balances"}</button>
      {variant === "a" ? <section className={styles.boundedList} aria-labelledby="by-account-a"><div className={styles.listHeading}><h2 id="by-account-a">By account</h2><p className={styles.period}>{PERIOD_LABEL}</p></div>{list}</section> : <section aria-labelledby="by-account-b"><div className={styles.canvasHeading}><h2 id="by-account-b">By account</h2><p className={styles.period}>{PERIOD_LABEL}</p></div><div className={styles.canvasList}>{list}</div></section>}
    </div><section aria-label="About this variant" className={styles.reviewNote}><h2>{variant === "a" ? "A clearer account list" : "Follow the dates"}</h2><p>{variant === "a" ? "One bounded list keeps the accounts together. Inside each sheet, Spend from leads, followed by the payment forecast, working and dated activity." : "Accounts sit directly on the canvas. Inside each sheet, the two headline figures sit together, then the dated payments and suggested moves lead into the working."}</p><p>In both: whole-pound availability, caution icons on rows and a quiet fold for accounts that are fine. Pence stay in the working.</p><p>The proposed move is dated 5 Nov, ahead of the payment shortfall. It appears on Barclays and NatWest with a Suggested label. No money moves in this preview.</p></section></main>
    {opened && <SheetFrame title={opened.bank} description={opened.name} leading={<BankMark account={opened} />} onClose={close} bodyClassName="px-5 py-5" footer={({ close: closeSheet }) => <button type="button" className={styles.done} onClick={closeSheet}>Done</button>}><div data-account-sheet={opened.id} className={styles.sheetBody}>
      <Figures account={opened} paired={variant === "b"} /><Verdict account={opened} />{variant === "b" ? <><Events account={opened} timeline /><Working account={opened} /><PlanList account={opened} /></> : <><Working account={opened} /><PlanList account={opened} /><Events account={opened} /></>}
    </div></SheetFrame>}
  </div></BalancesHiddenContext.Provider>;
}
export default function PreviewClient() {
  const params = useSearchParams(), variant = params.get("variant") === "b" ? "b" : "a", scenario = SCENARIOS.find(item => item.id === params.get("state"))?.id ?? "mixed", mode = params.get("mode") === "dark" ? "dark" : "light", hidden = params.get("hidden") === "1";
  return <Preview key={`${variant}:${scenario}:${mode}:${hidden}`} variant={variant} scenario={scenario} mode={mode} initialHidden={hidden} initialAccount={params.get("account")} />;
}
