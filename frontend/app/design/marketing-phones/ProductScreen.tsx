"use client";

import { useState } from "react";
import BottomNavRail from "@/components/navigation/BottomNavRail";
import MoneyText from "@/components/MoneyText";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import { MoveCard } from "@/components/HomeBrief";
import { ProposalConfirmCard, UserBubble, VerdictBubble } from "@/components/PennyConversation";
import { SCENARIO, STORIES, type PhoneTheme, type StoryId } from "./catalog";
import { C22_COVER, C22_EVERYDAY_ACCOUNT, C22_GOAL_PROPOSAL, C22_GOAL_REPLY, C22_PLANS, C22_SAFE_TO_SPEND, C22_SCHEDULE_PROPOSAL, C22_SCHEDULE_REPLY, C22_SPEND_FROM, C22_UPCOMING, C22_UPCOMING_ACCOUNTS } from "./fixtures";
import SpendScreen from "./SpendScreen";
import UpcomingScreen from "./UpcomingScreen";
import PurposeScreen from "./PurposeScreen";
import styles from "./product.module.css";

const noOp = () => {};

function ProductNav({ active }: { active: string }) {
  const activeTab = active === "Home" ? "home" : active === "Spend" ? "spend" : active === "Upcoming" ? "upcoming" : active === "Planning" ? "planning" : undefined;
  return <div className={styles.nav} data-c22-navigation><BottomNavRail appearance="ink" resolved activeTab={activeTab} pennyActive={active === "Penny"} pennyOpen={false} pennyCurrent={active === "Penny"} paydayActive={false} atRiskCount={active === "Upcoming" ? 1 : 0} onPennyClick={noOp} /></div>;
}

function PennyPlan({ schedule = false }: { schedule?: boolean }) {
  const [status, setStatus] = useState<"pending" | "done" | "cancelled">("pending");
  const reply = schedule ? C22_SCHEDULE_REPLY : C22_GOAL_REPLY;
  const proposal = { ...(schedule ? C22_SCHEDULE_PROPOSAL : C22_GOAL_PROPOSAL), status };
  const question = schedule ? "Change my Boiler service from £90 on 24 Nov to £95 on 26 Nov." : "Plan £200 from Everyday on each of my next three paydays for car insurance.";
  const card = <ProposalConfirmCard msg={proposal} onConfirm={() => setStatus("done")} onCancel={() => setStatus("cancelled")} onOpenDone={noOp} {...(!schedule ? { scheduledGoalAccountOptions: [C22_EVERYDAY_ACCOUNT], onRevise: async () => {} } : {})} />;
  return schedule ? <div className={styles.chat} data-c22-proposal="schedule"><UserBubble text={question} /><VerdictBubble msg={reply} onOfferTap={noOp} />{card}</div> : <div className={styles.chat} data-c22-proposal="goal">{card}</div>;
}

export default function ProductScreen({ story, theme }: { story: StoryId; theme: PhoneTheme }) {
  const meta = STORIES[story];
  const content = story === "amount" ? <SafeToSpendCard data={C22_SAFE_TO_SPEND} previewBalancesVisible spendFrom={C22_SPEND_FROM} />
    : story === "upcoming" || story === "upcoming-accounts" ? <div className={styles.stack}><p className={styles.context}><MoneyText text="£321 due before payday · £312 left after your plan and buffer" /></p><UpcomingScreen view={story === "upcoming" ? "payments" : "accounts"} rows={C22_UPCOMING} accounts={C22_UPCOMING_ACCOUNTS} plans={C22_PLANS} periodLabel="Payments through Sun 29 Nov" todayIso={SCENARIO.asOf} /></div>
    : story === "cover" ? <MoveCard item={C22_COVER} hideNetWorth={false} maskAmounts={(value) => value} previewMode dismissible onHomeDismiss={noOp} />
    : story === "spend" ? <SpendScreen />
    : story === "aside" ? <PurposeScreen />
    : <PennyPlan schedule={story === "schedule"} />;

  return <section data-c22-product={story} data-c22-story={story} className={`${styles.screen} ${theme === "dark" ? `${styles.dark} dark` : ""}`}>
    {story !== "spend" && <header className={styles.header} data-c22-product-header><div><h1>{meta.screenTitle}</h1><p>{story === "amount" ? "17 November · 13 days to payday" : story === "upcoming" || story === "upcoming-accounts" ? SCENARIO.periodLabel : "Your money, in view"}</p></div></header>}
    <main className={styles.content} data-c22-content={story}>{content}</main>
    <ProductNav active={meta.tab} />
  </section>;
}
