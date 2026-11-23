"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PlanIcon } from "@/components/upcoming/detailPrimitives";
import { useBalancesHidden } from "@/lib/balancesHidden";
import type { PreviewAccount } from "./types";
import type { PlanPreviewItem, PlansPanelProps } from "./PlanPreview.types";
import { Money, MoneyCopy, accountLabel, bankLabel, containedFocusClass, focusClass, moneyText, quietClass } from "./ui";
import styles from "./plans-panel.module.css";

function sourceCopy(item: PlanPreviewItem, account: PreviewAccount | undefined) {
  if (!item.sourceId && item.kind === "goal") {
    return <span className={styles.choosePayer}>Choose paying account</span>;
  }
  if (!item.sourceId) return <span>Paying account not set</span>;
  if (!account) return <span>Paying account needs checking</span>;

  const identity = `${bankLabel(account)} · ${accountLabel(account)}`;
  if (item.sourceBasis === "chosen") return <span>From {identity}</span>;
  if (item.sourceBasis === "recent-transfers") return <span>From {identity} · estimated from recent transfers</span>;
  return <span>Paying account needs checking</span>;
}

function supportingCopy(item: PlanPreviewItem) {
  if (item.state === "active" && item.filledPence !== null && item.filledPence > 0 && item.periodPence !== null) {
    return <MoneyCopy text={`${moneyText(item.filledPence)} of ${moneyText(item.periodPence)} set aside`} />;
  }
  return null;
}

function amountCopy(item: PlanPreviewItem) {
  if (item.state === "pending") {
    return { amount: null, caption: item.startsLabel ? `Starts ${item.startsLabel}` : "Starts later", status: "Not reserved" };
  }
  if (item.state === "complete") return { amount: item.filledPence, caption: "set aside", status: null };
  if (item.kind === "set-aside") return { amount: item.remainingPence, caption: "still to reserve", status: null };
  return { amount: item.remainingPence, caption: item.sourceId ? "to contribute" : "this period", status: null };
}

function PlanRow({ item, accounts, onOpen }: { item: PlanPreviewItem; accounts: PreviewAccount[]; onOpen: (id: string) => void }) {
  const hidden = useBalancesHidden();
  const account = item.sourceId ? accounts.find((candidate) => candidate.id === item.sourceId) : undefined;
  const figure = amountCopy(item);
  const planKind = item.kind === "set-aside" ? "allocation" : "goal";
  const ariaAmount = figure.status ?? (figure.amount === null ? "Unavailable" : hidden ? "Amount hidden" : moneyText(figure.amount));

  return <li className={styles.rowItem}>
    <button
      type="button"
      className={`${styles.row} ${containedFocusClass}`}
      data-balanced-row={`plan-${item.id}`}
      aria-label={`${item.name}. ${ariaAmount}, ${figure.caption}. Open details.`}
      onClick={() => onOpen(item.id)}
    >
      <span data-row-content className={styles.rowContent}>
        <span aria-hidden="true" className={styles.icon}><PlanIcon kind={planKind} /></span>
        <span className={styles.copy}>
          <span className={styles.name}>{item.name}</span>
          <span className={`${styles.source} ${quietClass}`}>{sourceCopy(item, account)}</span>
          {supportingCopy(item) && <span className={`${styles.supporting} ${quietClass}`}>{supportingCopy(item)}</span>}
        </span>
        <span className={styles.figure}>
          {figure.status ? <span className={styles.notReserved}>{figure.status}</span> : figure.amount === null ? <span className={styles.unavailable}>Unavailable</span> : <Money value={figure.amount} className={styles.amount} />}
          <span className={`${styles.caption} ${quietClass}`}>{figure.caption}</span>
        </span>
        <ChevronRight aria-hidden="true" size={16} className={`${styles.chevron} ${quietClass}`} />
      </span>
    </button>
  </li>;
}

function EmptyKind({ kind }: { kind: PlanPreviewItem["kind"] }) {
  return <p className={`${styles.emptyKind} ${quietClass}`}>{kind === "set-aside" ? "No set-asides for this period." : "No goals to contribute to this period."}</p>;
}

function PlanList({ kind, items, accounts, onOpen }: { kind: PlanPreviewItem["kind"]; items: PlanPreviewItem[]; accounts: PreviewAccount[]; onOpen: (id: string) => void }) {
  return items.length ? <ul className={styles.list}>{items.map((item) => <PlanRow key={item.id} item={item} accounts={accounts} onOpen={onOpen} />)}</ul> : <EmptyKind kind={kind} />;
}

function EmptyInline({ kind, headingId, heading }: { kind: PlanPreviewItem["kind"]; headingId: string; heading: string }) {
  return <div className={styles.emptySection} data-balanced-row={`empty-${kind}`}><div data-row-content className={styles.emptySectionContent}><h3 id={headingId}>{heading}</h3><p className={quietClass}>None yet</p></div></div>;
}

function disclosureCopy(kind: PlanPreviewItem["kind"], items: PlanPreviewItem[]) {
  const noun = kind === "set-aside" ? "set-aside" : "goal";
  const plans = `${items.length} ${noun}${items.length === 1 ? "" : "s"}`;
  const withoutPayer = items.filter((item) => item.state === "active" && !item.sourceId).length;
  return withoutPayer ? `${plans} · ${withoutPayer} ${withoutPayer === 1 ? "needs" : "need"} a paying account` : plans;
}

function DisclosureSection({ kind, items, accounts, onOpen, headingId, contentId, heading }: {
  kind: PlanPreviewItem["kind"];
  items: PlanPreviewItem[];
  accounts: PreviewAccount[];
  onOpen: (id: string) => void;
  headingId: string;
  contentId: string;
  heading: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const copy = disclosureCopy(kind, items);

  return <div className={styles.disclosure}>
    <h3 id={headingId} className={styles.disclosureTitle}>
      <button
        type="button"
        className={`${styles.disclosureButton} ${containedFocusClass}`}
        data-balanced-row={`plans-${kind}-disclosure`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span data-row-content className={styles.disclosureContent}>
          <span className={styles.disclosureCopy}>
            <span className={styles.oneTitle}>{heading}</span>
            <span className={`${styles.disclosureMeta} ${quietClass}`}>{copy}</span>
          </span>
          <ChevronDown aria-hidden="true" size={18} className={`${styles.disclosureChevron} ${expanded ? styles.disclosureChevronExpanded : ""}`} />
        </span>
      </button>
    </h3>
    <div id={contentId} className={styles.disclosureChildren} hidden={!expanded}>
      <PlanList kind={kind} items={items} accounts={accounts} onOpen={onOpen} />
    </div>
  </div>;
}

function Section({ kind, items, accounts, onOpen, headingId, heading, onAdd }: {
  kind: PlanPreviewItem["kind"];
  items: PlanPreviewItem[];
  accounts: PreviewAccount[];
  onOpen: (id: string) => void;
  headingId: string;
  heading: string;
  onAdd?: () => void;
}) {
  return <section className={styles.section} aria-labelledby={headingId}>
    <div className={styles.sectionHeading}><h3 id={headingId} className={styles.sectionTitle}>{heading}</h3>{onAdd && <button type="button" onClick={onAdd} className={`${styles.add} ${focusClass}`}>Add</button>}</div>
    <div className={styles.card}><PlanList kind={kind} items={items} accounts={accounts} onOpen={onOpen} /></div>
  </section>;
}

function StatusCard({ status, onRetry }: Pick<PlansPanelProps, "status" | "onRetry">) {
  const error = status === "error";
  return <div className={styles.statusCard} role={error ? "alert" : "status"}>
    <p>{error ? "Plans could not be checked." : "Checking set-asides and goals…"}</p>
    {error && <button type="button" onClick={onRetry} className={`${styles.retry} ${focusClass}`}>Try again</button>}
  </div>;
}

export default function PlansPanel({ variant, items, accounts, status, onOpen, onAdd, onRetry }: PlansPanelProps) {
  const panelId = useId();
  const setAsides = items.filter((item) => item.kind === "set-aside");
  const goals = items.filter((item) => item.kind === "goal");
  const empty = items.length === 0;
  const separateReady = variant === "f" && status === "ready" && !empty;

  return <section className={styles.panel} aria-labelledby="plans-panel-title" data-plans-variant={variant}>
    {!separateReady ? <header className={styles.heading}>
      <h2 id="plans-panel-title">Set-asides and goals</h2>
      <button type="button" onClick={onAdd} className={`${styles.add} ${focusClass}`}>Add</button>
    </header> : <h2 id="plans-panel-title" className="sr-only">Set-asides and goals</h2>}

    {status !== "ready" ? <StatusCard status={status} onRetry={onRetry} /> : empty ? <div className={styles.emptyAll}>
      <p>Start a set-aside or goal for this period.</p>
      <button type="button" onClick={onAdd} className={`${styles.emptyAdd} ${focusClass}`}>Add a plan</button>
    </div> : variant === "e" ? <div className={styles.oneCard}>
      <section className={styles.oneSection} aria-labelledby={`${panelId}-set-asides-heading`}>
        {setAsides.length ? <DisclosureSection kind="set-aside" items={setAsides} accounts={accounts} onOpen={onOpen} headingId={`${panelId}-set-asides-heading`} contentId={`${panelId}-set-asides-content`} heading="Set-asides" /> : <EmptyInline kind="set-aside" headingId={`${panelId}-set-asides-heading`} heading="Set-asides" />}
      </section>
      <section className={styles.oneSection} aria-labelledby={`${panelId}-goals-heading`}>
        {goals.length ? <DisclosureSection kind="goal" items={goals} accounts={accounts} onOpen={onOpen} headingId={`${panelId}-goals-heading`} contentId={`${panelId}-goals-content`} heading="Goals" /> : <EmptyInline kind="goal" headingId={`${panelId}-goals-heading`} heading="Goals" />}
      </section>
    </div> : <div className={styles.matchingCards}>
      <Section kind="set-aside" items={setAsides} accounts={accounts} onOpen={onOpen} headingId="set-asides-heading" heading="Set-asides" onAdd={onAdd} />
      <Section kind="goal" items={goals} accounts={accounts} onOpen={onOpen} headingId="goals-heading" heading="Goals" />
    </div>}
  </section>;
}
