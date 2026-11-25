"use client";

import { useState } from "react";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import MoneyText from "@/components/MoneyText";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { MoveCard } from "@/components/HomeBrief";
import SpendVerdictView from "@/components/SpendVerdictView";
import SetAsideList from "@/components/upcoming/SetAsideList";
import UpcomingAttentionDay from "@/components/upcoming/UpcomingAttentionDay";
import { ProposalConfirmCard, UserBubble, VerdictBubble } from "@/components/PennyConversation";
import { CATEGORY_COLOURS } from "@/lib/categories";
import { SCENARIO, STORIES, type PhoneTheme, type StoryId } from "./catalog";
import { C22_ASIDE, C22_COVER, C22_EVERYDAY_ACCOUNT, C22_GOAL_PROPOSAL, C22_GOAL_REPLY, C22_SAFE_TO_SPEND, C22_SCHEDULE_PROPOSAL, C22_SCHEDULE_REPLY, C22_SPEND, C22_UPCOMING } from "./fixtures";
import styles from "./product.module.css";

const noOp = () => {};

function ProductNav({ active }: { active: string }) {
  const activeTab = active === "Home" ? "home" : active === "Spend" ? "spend" : active === "Upcoming" ? "upcoming" : active === "Planning" ? "planning" : undefined;
  return <div className={styles.nav}><BottomNavRail appearance="ink" resolved activeTab={activeTab} pennyActive={active === "Penny"} pennyOpen={false} pennyCurrent={active === "Penny"} paydayActive={false} atRiskCount={active === "Upcoming" ? 1 : 0} onPennyClick={noOp} /></div>;
}

function PennyPlan({ schedule = false }: { schedule?: boolean }) {
  const [status, setStatus] = useState<"pending" | "done" | "cancelled">("pending");
  const reply = schedule ? C22_SCHEDULE_REPLY : C22_GOAL_REPLY;
  const proposal = { ...(schedule ? C22_SCHEDULE_PROPOSAL : C22_GOAL_PROPOSAL), status };
  const question = schedule ? "Change my Boiler service from £90 on 24 Nov to £95 on 26 Nov." : "Plan £200 from Everyday on each of my next three paydays for car insurance.";
  const card = <ProposalConfirmCard msg={proposal} onConfirm={() => setStatus("done")} onCancel={() => setStatus("cancelled")} onOpenDone={noOp} {...(!schedule ? { scheduledGoalAccountOptions: [C22_EVERYDAY_ACCOUNT], onRevise: async () => {} } : {})} />;
  return schedule ? <div className={styles.chat}><UserBubble text={question} /><VerdictBubble msg={reply} onOfferTap={noOp} />{card}</div> : <div className={styles.chat}>{card}</div>;
}

export default function ProductScreen({ story, theme }: { story: StoryId; theme: PhoneTheme }) {
  const meta = STORIES[story];
  const content = story === "amount" ? <SafeToSpendCard data={C22_SAFE_TO_SPEND} previewBalancesVisible spendFrom={{ kind: "account", best: { accountId: "c22-everyday", name: "Everyday account", provider: "Monzo", headroom: 312, account: C22_EVERYDAY_ACCOUNT }, alternative: null }} />
    : story === "upcoming" ? <div className={styles.stack}><p className={styles.context}><MoneyText text="£321 due before payday · £312 left after your plan and buffer" /></p>{C22_UPCOMING.map((row) => <UpcomingAttentionDay key={row.rowKey} dayKeyIso={row.expectedDate} heading={new Date(`${row.expectedDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} rows={[row]} onOpen={noOp} onDismiss={noOp} />)}</div>
    : story === "cover" ? <MoveCard item={C22_COVER} hideNetWorth={false} maskAmounts={(value) => value} previewMode dismissible onHomeDismiss={noOp} />
    : story === "spend" ? <div className={`${styles.stack} ${styles.spendJourney}`}><SpendVerdictView verdict={C22_SPEND} colours={CATEGORY_COLOURS} onOpenCategory={noOp} onIntent={async () => {}} hideReading journey /></div>
    : story === "aside" ? <div className={styles.stack}><p className={styles.context}>Reserved from Everyday this pay period</p><div className={styles.asideAllocation}><SetAsideList items={[C22_ASIDE]} onEdit={noOp} /></div><section className={styles.byDate} aria-labelledby="c22-by-date"><h2 id="c22-by-date">By date</h2>{C22_UPCOMING.map((row) => <UpcomingAttentionDay key={row.rowKey} dayKeyIso={row.expectedDate} heading={new Date(`${row.expectedDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} rows={[row]} onOpen={noOp} onDismiss={noOp} />)}</section></div>
    : <PennyPlan schedule={story === "schedule"} />;

  return <section data-c22-product={story} data-c22-story={story} className={`${styles.screen} ${theme === "dark" ? `${styles.dark} dark` : ""}`}>
    <header className={styles.header}><div><h1>{meta.screenTitle}</h1><p>{story === "amount" ? "17 November · 13 days to payday" : story === "spend" ? `${SCENARIO.periodLabel} · day ${SCENARIO.elapsedDays}` : story === "upcoming" || story === "aside" ? SCENARIO.periodLabel : "Your money, in view"}</p></div></header>
    <main className={styles.content}>{content}</main>
    <ProductNav active={meta.tab} />
  </section>;
}
