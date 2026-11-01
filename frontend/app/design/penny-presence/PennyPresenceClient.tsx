"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import PennyMark from "@/components/PennyMark";
import { SheetFrame } from "@/components/SheetFrame";
import { BRAND_GRADIENT } from "@/lib/brand";
import PresenceGallery from "./PresenceGallery";
import styles from "./review.module.css";

export type PresenceVariant = "a" | "b" | "c" | "current";
export type PresenceState = "stack" | "card-detail" | "cover-plan" | "payday-plan" | "covered";
const VARIANTS = [
  { id: "a", name: "A · Quiet signature", explanation: "The familiar Penny mark becomes an ink signature. No filled attribution pill; a solid indigo button carries the decision.", gradient: "Only the raised Penny door and adviser header use the gradient.", tradeoff: "Closest to the current app, with much less repeated purple." },
  { id: "b", name: "B · Coin seal", explanation: "A thin circular seal gives the existing penny-drops mark a consistent home. Deeper indigo actions and a round adviser door repeat that shape with purpose.", gradient: "The seal on a card is an outline, not a gradient. The gradient stays on the adviser door and header.", tradeoff: "A stronger identity, with a little more visual presence than A." },
  { id: "c", name: "C · One adviser door", explanation: "Card kinds do the labelling. Penny lives in one recognisable adviser door instead of a badge on every suggestion. Tonal indigo buttons keep the page quieter.", gradient: "A small gradient mark sits only inside the Penny door and adviser header. Ordinary actions have no gradient.", tradeoff: "The quietest Home; individual cards no longer repeat who the adviser is." },
  { id: "current", name: "Current production", explanation: "The actual production cards: filled Penny attribution pills, indigo actions and the raised gradient adviser door. The Covered verdict correctly has no Penny badge.", gradient: "This is the current reference, not a new proposal.", tradeoff: "Compare the same examples without the proposed presentation changes." },
] as const;
const STATES: { id: PresenceState; label: string }[] = [
  { id: "stack", label: "Home stack" }, { id: "card-detail", label: "Card detail" },
  { id: "cover-plan", label: "Cover plan" }, { id: "payday-plan", label: "Payday plan" }, { id: "covered", label: "Covered" },
];

export default function PennyPresenceClient() {
  const params = useSearchParams();
  return <PresenceReview key={params.toString()} params={params} />;
}

function PresenceReview({ params }: { params: { get(key: string): string | null } }) {
  const requested = params.get("variant");
  const variant: PresenceVariant = requested === "b" || requested === "c" || requested === "current" ? requested : "a";
  const rawState = params.get("state");
  const state: PresenceState = STATES.some(item => item.id === rawState) ? rawState as PresenceState : "stack";
  const dark = params.get("mode") === "dark";
  const masked = params.get("masked") === "1";
  const clean = params.get("clean") === "1";
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [pennyOpen, setPennyOpen] = useState(false);
  const selected = VARIANTS.find(item => item.id === variant)!;
  const href = (changes: Record<string, string>) => `?${new URLSearchParams({ variant, state, mode: dark ? "dark" : "light", masked: masked ? "1" : "0", ...(clean ? { clean: "1" } : {}), ...changes })}`;
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const priorScheme = root.style.colorScheme;
    root.classList.toggle("dark", dark); root.style.colorScheme = dark ? "dark" : "light";
    const frame = requestAnimationFrame(() => setReady(true));
    return () => { cancelAnimationFrame(frame); root.classList.toggle("dark", wasDark); root.style.colorScheme = priorScheme; };
  }, [dark]);

  return <main data-g388-ready={ready} data-g388-variant={variant} className={`${styles.shell} ${dark ? styles.dark : ""}`}>
    <div className={`${styles.container} ${clean ? styles.clean : ""}`}>
      {!clean && <header className={styles.controls}>
        <a href="#presence-example" className={styles.skip}>Skip to the example</a>
        <h1>Penny presence</h1>
        <p>G388 design round. Three ways to make Penny and the purple feel more considered. Real cards, synthetic examples. Production is unchanged.</p>
        <nav aria-label="Design variants" className={styles.links}>{VARIANTS.map(item => <Link key={item.id} href={href({ variant: item.id })} scroll={false} aria-current={variant === item.id ? "page" : undefined} className={styles.control}>{item.name}</Link>)}</nav>
        <details className={styles.examples}><summary>Examples and display <ChevronDown size={16} aria-hidden="true" /></summary>
          <nav aria-label="Example states" className={styles.links}>{STATES.map(item => <Link key={item.id} href={href({ state: item.id })} scroll={false} aria-current={state === item.id ? "page" : undefined} className={styles.control}>{item.label}</Link>)}
            <Link href={href({ mode: dark ? "light" : "dark" })} scroll={false} className={styles.control}>{dark ? "Light theme" : "Dark theme"}</Link>
            <Link href={href({ masked: masked ? "0" : "1" })} scroll={false} className={styles.control}>{masked ? "Show example figures" : "Hide example figures"}</Link>
          </nav>
        </details>
      </header>}

      <div className={styles.layout}>
        <section id="presence-example" tabIndex={-1} aria-label="Home presentation" className={styles.example}>
          <h2 className={styles.exampleHeading}>Your briefing</h2>
          <PresenceGallery variant={variant} state={state} masked={masked} onPennyOpen={() => { setNotice(""); setPennyOpen(true); }} onAction={(label, route) => setNotice(`Preview only: ${label}${route ? ` opens ${route} in the app` : " is available in the app"}. No live action was taken.`)} />
        </section>
        {!clean && <section className={styles.notes} aria-label="About this direction">
          <h2>{selected.name}</h2>
          <p>{selected.explanation}</p>
          <h3>Where the gradient goes</h3><p>{selected.gradient}</p>
          <h3>The trade-off</h3><p>{selected.tradeoff}</p>
          <p className={styles.boundary}>Financial figures, warnings, wording and actions are the same in every option. Covered stays a plain verified verdict, not a Penny recommendation.</p>
          <p>Tap the Penny door to see the local adviser-header example. Card actions only show their intended route here.</p>
        </section>}
      </div>
      <p role="status" data-g388-action className={styles.status}>{notice || "Synthetic preview. No account or chat changes."}</p>
    </div>
    {pennyOpen && <SheetFrame title="Penny preview" description="Adviser entry · design preview" themeClass={dark ? "dark" : undefined} onClose={() => setPennyOpen(false)} leading={<span data-presence-entry className={`${styles.demoMark} ${variant === "b" ? styles.roundMark : ""} ${variant === "c" ? styles.tonalMark : ""}`} style={variant === "c" ? undefined : { background: BRAND_GRADIENT }}><span className={variant === "c" ? styles.innerMark : undefined} style={variant === "c" ? { background: BRAND_GRADIENT } : undefined}><PennyMark size={variant === "c" ? 18 : 22} /></span></span>} footer={({ close }) => <button type="button" onClick={close} className={`${styles.demoClose} ${variant === "b" ? styles.deepClose : ""} ${variant === "c" ? styles.tonalClose : ""}`}>Back to the example</button>}>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">This is where Penny opens in the app. This preview does not read your accounts or send a message.</p>
      <p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-300">The card attribution, adviser entry and ordinary action buttons have separate jobs. The gradient identifies the adviser entry only.</p>
    </SheetFrame>}
  </main>;
}
