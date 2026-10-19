"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import { CelebrationCard, MoveCard, UnfundedMoveCard } from "@/components/HomeBrief";
import {
  COVERED_ITEM, COVER_MOVE_ITEM, LONG_COVERED_ITEM, MASKED_COVERED_ITEM, MASKED_TIP,
  MISSING_BODY_COVERED_ITEM, TIP, UNFUNDED_MOVE_ITEM,
} from "./fixtures";
import styles from "./home-covered-anatomy.module.css";

type Variant = "a" | "b" | "c";
type State = "covered" | "family" | "long" | "masked" | "missing-body";
type Mode = "light" | "dark";

type LocalRouter = {
  push: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  replace: (href: string) => void;
  prefetch: (href: string) => Promise<void>;
};
const variants: { key: Variant; label: string; description: string }[] = [
  { key: "a", label: "A · inline mark", description: "One small confirmation mark, then a full-width reading column." },
  { key: "b", label: "B · retained tile", description: "One tile confirmation; all evidence follows its text column." },
  { key: "c", label: "C · words only", description: "No icon treatment. Covered is the only success signal." },
];
const states: { key: State; label: string }[] = [
  { key: "covered", label: "Covered" }, { key: "family", label: "Family" }, { key: "long", label: "Long" }, { key: "masked", label: "Masked" }, { key: "missing-body", label: "No detail" },
];

function hrefFor(variant: Variant, state: State, mode: Mode, masked: boolean) {
  return `?variant=${variant}&state=${state}&mode=${mode}${masked ? "&masked=1" : ""}`;
}

function PreviewCard({ kind, children }: { kind: "covered" | "cover" | "move" | "tip"; children: React.ReactNode }) {
  return <div data-g292-card={kind} className={styles.card}>{children}</div>;
}

export default function HomeCoveredAnatomyClient() {
  const params = useSearchParams();
  return <PreviewState key={params.toString()} params={params} />;
}

function PreviewState({ params }: { params: { get(key: string): string | null; toString(): string } }) {
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const rawState = params.get("state");
  const state: State = rawState === "family" || rawState === "long" || rawState === "masked" || rawState === "missing-body" ? rawState : "covered";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const [reset, setReset] = useState(0);
  const [status, setStatus] = useState("Preview ready. Controls do not change bank data.");
  const [destination, setDestination] = useState("none");
  const [ready, setReady] = useState(false);
  const masked = state === "masked" || params.get("masked") === "1";
  const covered = state === "long" ? LONG_COVERED_ITEM : state === "masked" ? MASKED_COVERED_ITEM : state === "missing-body" ? MISSING_BODY_COVERED_ITEM : COVERED_ITEM;
  const onDismiss = () => setStatus("Dismissed locally in this preview. Use Reset to show the fixture again.");
  const themeKey = `${mode}:${variant}:${state}`;

  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="color-scheme"]');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const priorDark = root.classList.contains("dark");
    const priorScheme = root.style.colorScheme;
    const priorMeta = meta?.getAttribute("content") ?? null;
    const priorThemeMeta = themeMeta?.getAttribute("content") ?? null;
    const frame = requestAnimationFrame(() => {
      root.classList.toggle("dark", mode === "dark");
      root.style.colorScheme = mode;
      meta?.setAttribute("content", mode === "dark" ? "dark" : "only light");
      themeMeta?.setAttribute("content", mode === "dark" ? "#0f172a" : "#f0f2f7");
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(frame);
      root.classList.toggle("dark", priorDark);
      root.style.colorScheme = priorScheme;
      if (meta) {
        if (priorMeta === null) meta.removeAttribute("content");
        else meta.setAttribute("content", priorMeta);
      }
      if (themeMeta) {
        if (priorThemeMeta === null) themeMeta.removeAttribute("content");
        else themeMeta.setAttribute("content", priorThemeMeta);
      }
    };
  }, [mode]);

  function interceptNavigation(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as Element;
    if (target.closest('button[aria-label="Dismiss insight"]')) {
      setStatus("Tip dismissed locally in this preview. Use Reset to show the fixture again.");
      return;
    }
    if (target.closest('[data-g292-card="tip"] button')) {
      event.preventDefault();
      event.stopPropagation();
      setDestination("transactions?category=Bills&tip=g292-mobile-tip");
      setStatus("Tip navigation intercepted: Transactions, Bills, EE payments.");
      return;
    }
    if (!target.closest("a")) return;
    event.preventDefault();
    event.stopPropagation();
    const href = target.closest("a")?.getAttribute("href") ?? "";
    setDestination(href);
    setStatus(`Navigation intercepted: ${href === "/upcoming" ? "Upcoming" : href}. No customer data changed.`);
  }

  const common = { maskAmounts: (text: string) => masked ? text.replace(/£[\d,]+(?:\.\d+)?/g, "£••••") : text, dismissible: true, onHomeDismiss: onDismiss };
  const previewRouter: LocalRouter = {
    push: href => { setDestination(href); setStatus(`Navigation intercepted: ${href === "/upcoming" ? "Upcoming" : href}.`); },
    back: () => {}, forward: () => {}, refresh: () => {}, replace: () => {}, prefetch: async () => {},
  };
  return (
    <main data-g292-variant={variant} data-g292-state={state} data-g292-ready={ready ? "true" : "false"} className={`${styles.preview} ${styles[variant]} ${mode === "dark" ? "dark" : ""}`} style={{ colorScheme: mode }}>
      <div className={styles.shell}>
        <a href="#g292-preview-cards" className={styles.skip}>Skip to card previews</a>
        <header className={styles.header}>
          <h1>G292 · One signal, one reading column</h1>
          <p>Real Home cards, fixture data and preview-only interactions. The copy and money logic are not a proposal.</p>
        </header>

        <nav aria-label="G292 design controls" className={styles.controls}>
          <div className={styles.controlGroup} aria-label="Variants">{variants.map(item => <a key={item.key} href={hrefFor(item.key, state, mode, masked)} aria-current={variant === item.key ? "page" : undefined}>{item.label}</a>)}</div>
          <div className={styles.controlGroup} aria-label="States">{states.map(item => <a key={item.key} href={hrefFor(variant, item.key, mode, masked)} aria-current={state === item.key ? "page" : undefined}>{item.label}</a>)}</div>
          <a className={styles.mode} href={hrefFor(variant, state, mode === "dark" ? "light" : "dark", masked)}>{mode === "dark" ? "Light" : "Dark"}</a>
          <a className={styles.mode} href={hrefFor(variant, state === "masked" && masked ? "covered" : state, mode, state === "masked" ? false : !masked)}>{masked ? "Show figures" : "Mask figures"}</a>
          <button type="button" onClick={() => { setReset(value => value + 1); setStatus("Fixtures restored locally."); }}>Reset</button>
        </nav>

        <section className={styles.intro} aria-label="Selected direction">
          <strong>{variants.find(item => item.key === variant)?.label}</strong><span>{variants.find(item => item.key === variant)?.description}</span>
        </section>

        <div id="g292-preview-cards" tabIndex={-1} key={`${themeKey}:${reset}`} className={state === "family" ? styles.family : styles.single} onClickCapture={interceptNavigation}>
          <PreviewCard kind="covered"><CelebrationCard item={covered} router={previewRouter as never} {...common} /></PreviewCard>
          {state === "family" && <>
            <p className={styles.independent}>Independent family fixtures: each card describes a separate situation.</p>
            <PreviewCard kind="cover"><MoveCard item={COVER_MOVE_ITEM} hideNetWorth={masked} previewMode {...common} /></PreviewCard>
            <PreviewCard kind="move"><UnfundedMoveCard item={UNFUNDED_MOVE_ITEM} hideNetWorth={masked} previewMode {...common} /></PreviewCard>
            <PreviewCard kind="tip"><HomeInsightSpotlight previewInsight={masked ? MASKED_TIP : TIP} /></PreviewCard>
          </>}
        </div>
        <p data-g292-status={status} data-g292-destination={destination} className={styles.status} role="status">{status}</p>
      </div>
    </main>
  );
}
