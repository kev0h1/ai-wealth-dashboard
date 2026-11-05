"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Moon, Sun, X } from "lucide-react";
import PennyAppearanceIcon from "@/components/PennyAppearanceIcon";
import PennyMark from "@/components/PennyMark";
import { BRAND_GRADIENT } from "@/lib/brand";
import { PENNY_APPEARANCES, type PennyAppearance } from "@/lib/pennyAppearance";
import styles from "./preview.module.css";

type Variant = "a" | "b" | "c";
type Tab = "home" | "spend" | "upcoming" | "planning";
type PageName = Tab | "other" | "penny";
type Example = "attention" | "quiet" | "payday" | "pending" | "off-tab";
type Options = {
  variant: Variant;
  appearance: PennyAppearance;
  mode: "light" | "dark";
  state: Example;
  tab: PageName;
  open: boolean;
};

const DIRECTIONS = {
  a: { name: "Quiet rail", description: "A familiar rail, with less to get in your way. A small line anchors the current tab; Penny sits comfortably within it." },
  b: { name: "Soft dock", description: "Rounder and a little more tactile. A circular Penny door and compact icon surrounds give each stop its own space." },
  c: { name: "Open rail", description: "The lightest frame. An edge-to-edge bar lets the icons do the work, with a short marker above the current tab." },
} satisfies Record<Variant, { name: string; description: string }>;

const TABS: { id: Tab; label: string; column: number }[] = [
  { id: "home", label: "Home", column: 1 },
  { id: "spend", label: "Spend", column: 2 },
  { id: "upcoming", label: "Upcoming", column: 4 },
  { id: "planning", label: "Planning", column: 5 },
];
const EXAMPLES: { value: Example; label: string }[] = [
  { value: "attention", label: "A payment needs attention" },
  { value: "quiet", label: "No attention dots" },
  { value: "payday", label: "Payday plan ready" },
  { value: "pending", label: "Penny appearance loading" },
  { value: "off-tab", label: "An account detail page" },
];
const appearanceLabel = (appearance: PennyAppearance) => appearance[0].toUpperCase() + appearance.slice(1);

/** One 24px optical grid and one stroke weight across the four new tab symbols. */
function TabIcon({ tab, selected }: { tab: Tab; selected: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tab === "home" && <>
      {selected && <path d="M5 10.2 12 4l7 6.2v8.1a1.7 1.7 0 0 1-1.7 1.7H6.7A1.7 1.7 0 0 1 5 18.3Z" fill="currentColor" opacity=".12" stroke="none" />}
      <path d="m3.5 10.8 7.2-6.3a2 2 0 0 1 2.6 0l7.2 6.3M5.5 9.3v9.2A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9.3M9.5 20v-6h5v6" />
    </>}
    {tab === "spend" && <>
      {selected && <rect x="3.5" y="7.5" width="17" height="12" rx="3" fill="currentColor" opacity=".12" stroke="none" />}
      <path d="M19.5 8H6a2.5 2.5 0 0 1-.4-5l10.2-1" transform="translate(0 3)" />
      <path d="M3.5 8.5v9A2.5 2.5 0 0 0 6 20h12a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 18 8H6M20.5 12h-4a2 2 0 0 0 0 4h4" />
      <circle cx="16.5" cy="14" r=".65" fill="currentColor" stroke="none" />
    </>}
    {tab === "upcoming" && <>
      {selected && <path d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" fill="currentColor" opacity=".12" stroke="none" />}
      <rect x="4" y="5.5" width="16" height="15" rx="3" />
      <path d="M8 3.5v4M16 3.5v4M4 10.5h16M8.5 14.5h2M8.5 17h5M15 14.5h.5" />
    </>}
    {tab === "planning" && <>
      {selected && <path d="M4 20v-5h5v-5h5V5h5v15Z" fill="currentColor" opacity=".12" stroke="none" />}
      <path d="M4 20v-5h5v-5h5V5h5M9 15v5M14 10v10M3 20h18M16 3h5v5" />
    </>}
  </svg>;
}

function Rail({ options, appearance = options.appearance, label, onTab, onPenny }: {
  options: Options;
  appearance?: PennyAppearance;
  label: string;
  onTab: (tab: Tab) => void;
  onPenny: () => void;
}) {
  const pending = options.state === "pending";
  const attention = options.state === "attention";
  const payday = options.state === "payday";
  const pennyActive = options.open || options.tab === "penny";
  return <nav
    aria-label={label}
    className={styles.rail}
    data-variant={options.variant}
    data-appearance={pending ? "pending" : appearance}
    data-sample-rail
  >
    {TABS.map(tab => <button
      key={tab.id}
      type="button"
      className={styles.tab}
      style={{ gridColumn: tab.column }}
      aria-current={options.tab === tab.id ? "page" : undefined}
      aria-label={tab.id === "upcoming" && attention ? "Upcoming, 1 payment may need funding" : tab.label}
      data-nav-tab={tab.id}
      onClick={() => onTab(tab.id)}
    >
      <span className={styles.tabGlyph}>
        <TabIcon tab={tab.id} selected={options.tab === tab.id} />
        {tab.id === "upcoming" && attention && <span className={styles.attentionDot} aria-hidden="true" />}
      </span>
      <span className={styles.tabLabel}>{tab.label}</span>
    </button>)}
    <button
      type="button"
      className={styles.penny}
      style={appearance === "original" && !pending ? { background: BRAND_GRADIENT } : undefined}
      aria-label={payday ? "Penny, payday plan ready" : "Penny"}
      aria-pressed={options.open}
      aria-current={options.tab === "penny" ? "page" : undefined}
      data-active={pennyActive}
      data-penny-launcher
      onClick={onPenny}
    >
      {!pending && (appearance === "original"
        ? <PennyMark size={26} className={styles.originalMark} />
        : <PennyAppearanceIcon appearance={appearance} size={26} className={styles.pennyGlyph} />)}
      {payday && <span className={styles.paydayDot} aria-hidden="true" />}
    </button>
  </nav>;
}

function initialOptions(initial: Record<string, string>): Options {
  const state = EXAMPLES.some(x => x.value === initial.state) ? initial.state as Example : "attention";
  return {
    variant: initial.variant === "b" || initial.variant === "c" ? initial.variant : "a",
    appearance: PENNY_APPEARANCES.includes(initial.appearance as PennyAppearance) ? initial.appearance as PennyAppearance : "ink",
    mode: initial.mode === "dark" ? "dark" : "light",
    state,
    tab: state === "off-tab" ? "other" : ["home", "spend", "upcoming", "planning", "other", "penny"].includes(initial.tab) ? initial.tab as PageName : "home",
    open: initial.open === "1",
  };
}

const SCREEN: Record<PageName, { title: string; label: string; amount: number; copy: string }> = {
  home: { title: "Good evening, Alex", label: "Estimated left to spend", amount: 418, copy: "After the bills and plans Sorted knows about, through 26 Nov." },
  spend: { title: "Spending", label: "Spent this pay period", amount: 482, copy: "Your spending from 28 Oct to 26 Nov, across connected accounts." },
  upcoming: { title: "Upcoming", label: "Payments still to come", amount: 87, copy: "3 expected payments before payday on 27 Nov." },
  planning: { title: "Planning", label: "Set aside this period", amount: 600, copy: "Across your goals and set-asides for this pay period." },
  other: { title: "Everyday account", label: "Bank balance", amount: 805, copy: "An account detail page has no matching tab in the bar." },
  penny: { title: "Penny", label: "Your payday plan", amount: 300, copy: "A suggested move, ready to review. Sorted never moves your money." },
};
const formatMoney = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);

export default function NavBarPreview({ initial }: { initial: Record<string, string> }) {
  const [options, setOptions] = useState(() => initialOptions(initial));
  const root = useRef<HTMLElement>(null);
  const primaryLauncher = useRef<HTMLDivElement>(null);
  const pennyClose = useRef<HTMLButtonElement>(null);
  const lastLauncher = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (root.current) root.current.dataset.ready = "true"; }, []);

  const update = (patch: Partial<Options>) => {
    const next = { ...options, ...patch };
    if (next.state === "off-tab" && next.tab !== "other") next.state = "quiet";
    setOptions(next);
    const params = new URLSearchParams({
      variant: next.variant, appearance: next.appearance, mode: next.mode,
      state: next.state, tab: next.tab, open: next.open ? "1" : "0",
    });
    window.history.replaceState(null, "", `?${params}`);
  };
  const href = (variant: Variant) => `?${new URLSearchParams({ ...options, variant, open: options.open ? "1" : "0" })}`;
  const selectTab = (tab: Tab) => update({ tab, open: false });
  const togglePenny = () => {
    if (!options.open) lastLauncher.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    update({ open: !options.open });
  };
  const closePenny = () => {
    update({ open: false });
    (lastLauncher.current ?? primaryLauncher.current?.querySelector<HTMLButtonElement>("[data-penny-launcher]"))?.focus();
  };
  useEffect(() => {
    if (options.open) pennyClose.current?.focus();
  }, [options.open]);
  const screen = SCREEN[options.tab];
  const current = DIRECTIONS[options.variant];

  return <main ref={root} className={styles.page} data-mode={options.mode} data-nav-preview onKeyDown={event => {
    if (event.key === "Escape" && options.open) { event.preventDefault(); closePenny(); }
  }}>
    <a href="#nav-sample" className={styles.skip}>Skip to the navigation preview</a>
    <div className={styles.reviewShell}>
      <header className={styles.header}>
        <a href="/design" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
        <div className={styles.titleRow}><h1>Bottom navigation</h1><span className={styles.ticket}>G423</span></div>
        <p>Three directions. One look that follows your Penny icon.</p>
        <nav className={styles.directions} aria-label="Navigation proposals">
          {(Object.keys(DIRECTIONS) as Variant[]).map(variant => <a key={variant} href={href(variant)} aria-current={variant === options.variant ? "page" : undefined}>
            <span className={styles.directionLetter}>{variant.toUpperCase()}</span>{DIRECTIONS[variant].name}
          </a>)}
        </nav>
        <div className={styles.displayControls}>
          <fieldset className={styles.appearanceChoices}>
            <legend>Penny icon <span>(preview only)</span></legend>
            <div>{(["ink", "outline", "original"] as const).map(appearance => <label key={appearance}>
              <input type="radio" name="penny-preview" value={appearance} checked={options.appearance === appearance} onChange={() => update({ appearance })} />
              <span>{appearanceLabel(appearance)}</span>
            </label>)}</div>
          </fieldset>
          <button type="button" className={styles.themeButton} onClick={() => update({ mode: options.mode === "light" ? "dark" : "light" })}>
            {options.mode === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            {options.mode === "light" ? "Dark theme" : "Light theme"}
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.previewColumn} aria-label="Interactive phone preview">
          <div className={styles.previewCaption}><span>{options.variant.toUpperCase()} · {current.name}</span><span>{appearanceLabel(options.appearance)}</span></div>
          <div className={styles.phone}>
            <div className={styles.sampleHeader}><span className={styles.avatar} aria-hidden="true">A</span><span>Sorted</span><span className={styles.sampleTag}>Example</span></div>
            <div className={styles.screenContent} aria-live="polite" aria-atomic="true">
              <h2>{screen.title}</h2>
              <section className={styles.moneyCard} aria-label={screen.label}>
                <p className={styles.figureLabel}>{screen.label}</p>
                <p className={styles.figure}>{formatMoney(screen.amount)}</p>
                <p className={styles.figureCopy}>{screen.copy}</p>
                <span className={styles.covered}><Check size={13} aria-hidden="true" />Synthetic example</span>
              </section>
              <section className={styles.paymentCard}>
                <div className={styles.paymentHeading}><h3>Your next step</h3>{options.state === "attention" && <span className={styles.inlineDot} aria-hidden="true" />}</div>
                <p>{options.state === "attention" ? "One upcoming payment may need funding. Review it before it is due." : options.state === "payday" ? "Your payday plan is ready to review with Penny." : "Check your upcoming payments before payday."}</p>
                <button type="button" className={styles.sampleAction} onClick={() => selectTab("upcoming")} data-sample-action>See what’s due<ArrowUpRight size={16} aria-hidden="true" /></button>
              </section>
            </div>

            {options.open && <section className={styles.pennySample} aria-label="Penny open example" data-penny-open>
              <div><h3>Penny is open</h3><button ref={pennyClose} type="button" onClick={closePenny} aria-label="Close Penny example"><X size={18} aria-hidden="true" /></button></div>
              <p>This shows the launcher’s open state. In Sorted, Penny opens your conversation.</p>
            </section>}

            <div id="nav-sample" ref={primaryLauncher} className={styles.primaryDock} data-primary-dock tabIndex={-1}>
              <Rail options={options} label="Example primary navigation" onTab={selectTab} onPenny={togglePenny} />
            </div>
          </div>
          <p className={styles.mobileNote}>Tap the tabs and Penny. These examples use no account data.</p>
        </section>

        <section className={styles.details} aria-label="About this proposal">
          <h2>{options.variant.toUpperCase()} · {current.name}</h2>
          <p className={styles.directionCopy}>{current.description}</p>
          <div className={styles.comparisons}>
            <h3>The same bar, your Penny</h3>
            {(["ink", "outline", "original"] as const).map(appearance => <section key={appearance} className={styles.comparison} aria-label={`${appearanceLabel(appearance)} comparison`}>
              <div className={styles.comparisonHeading}><h4>{appearanceLabel(appearance)}{appearance === "ink" && <span>Default</span>}</h4><p>{appearance === "ink" ? "Ink and a small marker" : appearance === "outline" ? "A fine outline around the current tab" : "An indigo accent, with Penny’s gradient"}</p></div>
              <Rail options={options} appearance={appearance} label={`${appearanceLabel(appearance)} example navigation`} onTab={selectTab} onPenny={togglePenny} />
            </section>)}
          </div>
          <details className={styles.exampleControls}>
            <summary>Try other states<ChevronRight size={17} aria-hidden="true" /></summary>
            <label htmlFor="nav-example">Example</label>
            <select id="nav-example" name="nav-example" value={options.state} onChange={event => {
              const state = event.target.value as Example;
              update({ state, tab: state === "off-tab" ? "other" : options.tab === "other" ? "home" : options.tab });
            }}>{EXAMPLES.map(example => <option key={example.value} value={example.value}>{example.label}</option>)}</select>
            <label htmlFor="nav-page">Page</label>
            <select id="nav-page" name="nav-page" value={options.tab} onChange={event => update({ tab: event.target.value as PageName, open: false })}>
              {TABS.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
              <option value="other">Account detail</option><option value="penny">Penny page</option>
            </select>
            <p>Upcoming’s amber dot means a payment may need funding. Penny’s dot means a payday plan is ready. Loading keeps Penny’s mark hidden until the saved choice is known.</p>
          </details>
          <p className={styles.scopeNote}>A design comparison only. Your saved Penny choice stays as it is. Choose A, B or C on G423 once you have compared both themes.</p>
        </section>
      </div>
    </div>
  </main>;
}
