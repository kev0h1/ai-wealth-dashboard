"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import CompleteCard from "./CompleteCard";
import UpcomingColourReference from "./UpcomingColourReference";
import { SCENARIOS, SCENARIO_ORDER, type Scenario, type Variant } from "./fixtures";
import styles from "./sts-tone.module.css";

export default function StsToneClient() {
  const params = useSearchParams();
  return <StsToneState key={params.toString()} params={params} />;
}

function StsToneState({ params }: { params: { get: (key: string) => string | null } }) {
  const raw = params.get("scenario") ?? params.get("state");
  const scenario: Scenario = SCENARIO_ORDER.includes(raw as Scenario) ? raw as Scenario : "habitual";
  const requestedVariant = params.get("variant");
  const variant: Variant = requestedVariant === "a" || requestedVariant === "b" || requestedVariant === "c" || requestedVariant === "current" ? requestedVariant : "d";
  const paired = variant === "c" || variant === "d" || variant === "current";
  const mode = params.get("mode") === "dark" ? "dark" : "light";
  const masked = params.get("masked") === "1";
  const [ready, setReady] = useState(false);
  const [retried, setRetried] = useState(false);
  const [destination, setDestination] = useState<{ label: string; href: string } | null>(null);
  const displayed = retried && ["error", "empty", "degraded", "stale"].includes(scenario) ? "habitual" : scenario;
  const href = (changes: Record<string, string>) => `?${new URLSearchParams({ variant, state: scenario, mode, masked: masked ? "1" : "0", ...changes })}`;
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.classList.contains("dark");
    const scheme = root.style.colorScheme;
    root.classList.toggle("dark", mode === "dark"); root.style.colorScheme = mode;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => { cancelAnimationFrame(frame); root.classList.toggle("dark", previous); root.style.colorScheme = scheme; };
  }, [mode]);

  return <main data-g287-ready={ready} className={`${styles.shell} ${mode === "dark" ? styles.dark : ""}`}>
    <div className={styles.main}>
      <a className={styles.skipLink} href="#complete-card-proposal">Skip to the card</a>
      <h1>Safe to Spend · calm urgency</h1>
      <p className={styles.intro}>G287 revision. D keeps shortfall figures in ink, with a minus sign and a small amber warning. Compare Home and Upcoming below. Synthetic figures; production is unchanged.</p>
      <nav className={styles.controls} aria-label="Card presentation">
        {([["d", "D · Calm urgency"], ["a", "A · Calmer full card"], ["b", "B · Original layout"], ["c", "C · Shared risk colour"], ["current", "Current production"]] as const).map(([id, label]) => <Link key={id} className={`${styles.control} ${variant === id ? styles.active : ""}`} aria-current={variant === id ? "page" : undefined} href={href({ variant: id })} scroll={false}>{label}</Link>)}
      </nav>
      <details className={styles.examples}>
        <summary>Examples &amp; display <ChevronDown size={15} aria-hidden="true" /></summary>
        <nav className={styles.controls} aria-label="Example states">{SCENARIO_ORDER.map(id => <Link key={id} href={href({ state: id })} scroll={false} className={`${styles.control} ${scenario === id ? styles.active : ""}`} aria-current={scenario === id ? "page" : undefined}>{SCENARIOS[id].label}</Link>)}
          <Link href={href({ mode: mode === "dark" ? "light" : "dark" })} scroll={false} className={styles.control}>{mode === "dark" ? "Light theme" : "Dark theme"}</Link>
        </nav>
      </details>

      <section id="complete-card-proposal" tabIndex={-1} className={`${styles.reviewLayout} ${paired ? styles.pairedLayout : ""}`} aria-label="Complete production-card proposal">
        <div className={styles.cardFrame}>
        {paired && !masked && <h2 className={styles.surfaceTitle}>Home</h2>}
        {masked ? <div className={styles.privacy} role="status"><h2>Preview figures hidden</h2><p>For privacy, this legacy masked link does not mount a card with visible fixture amounts. The production hide-balances behaviour is unchanged.</p><Link href={href({ masked: "0" })} className={styles.control}>Show synthetic example</Link></div>
          // Relative synthetic dates are evaluated in the browser. Keep the
          // real loading card until hydration so cached server fixture times
          // cannot disagree with a fresh client bundle's as-of minute.
          : <CompleteCard scenario={ready ? displayed : "loading"} variant={variant} onRetry={() => setRetried(true)} onDestination={(label, path) => setDestination({ label, href: path })} />}
        </div>
        {!masked && paired && <UpcomingColourReference scenario={ready ? displayed : "loading"} consolidated={variant === "c"} calmUrgency={variant === "d"} onDestination={(label, path) => setDestination({ label, href: path })} />}
        <div className={`${styles.notes} ${paired ? styles.wideNotes : ""}`}>
          <h2>{variant === "d" ? "D · Calm urgency" : variant === "c" ? "C · Shared risk colour" : variant === "a" ? "A · Calmer full card" : variant === "b" ? "B · Original layout" : "Current production"}</h2>
          <p>{variant === "d" ? "A’s compact layout, with Shortfall before payday and a signed ink amount when cash is short. Home’s plans-only shortfall keeps its existing amber amount and wording. The small Short chip and Upcoming’s short qualifier use warm amber; negative calculation amounts stay signed in ink. The quiet calculation row leaves See what’s due and Your accounts easy to find. On track, Tight, card-check and stale figures keep their existing meaning." : variant === "c" ? "Use Upcoming’s rose family for genuine cash-risk figures, Short status and risk totals on both cards. A deeper rose in light mode and a lighter rose in dark mode keep small status labels readable too. One shared colour per theme; the same card sizes, words, calculations and actions. The calculation disclosure has no filled highlight." : variant === "a" ? "The complete card in a more compact treatment: a 30px cash figure in ink when short, a quieter calculation disclosure and less rounded corners. All existing content and actions stay." : variant === "b" ? "The original size and layout. Only a genuine cash-shortfall hero figure changes from red to ink. Its existing risk status and every other colour remain." : "The unchanged production colours, using the same examples. Compare Home’s red with Upcoming’s rose, or try the earlier A, B and C proposals."}</p>
          {paired && <p>Safe to Spend uses the lowest cash forecast before payday, less its buffer and reserves. Upcoming shows the balance at payday. Their amounts can differ; matching the presentation does not merge the calculations. Plans-only, Tight, card-check and On track states keep their existing meaning.</p>}
          {!masked && <p>{SCENARIOS[displayed].note}</p>}
          <p>Try “See your cards” and “Review card bill” above to see both card actions. Your accounts stays in the footer. In this preview only, navigation is intercepted and the destination is shown below.</p>
          <p role="status" data-preview-destination={destination?.href ?? ""} className={styles.destination}>{destination ? `${destination.label} opens ${destination.href === "/accounts" ? "Accounts" : destination.href === "/cards" ? "Cards" : destination.href.startsWith("/planning") ? "Planning" : "Upcoming"} (${destination.href}) in production. No live page was opened here.` : "Navigation preview: no destination selected."}</p>
        </div>
      </section>
    </div>
  </main>;
}
