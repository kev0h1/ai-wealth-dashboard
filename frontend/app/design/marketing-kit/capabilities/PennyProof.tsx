"use client";

import { useState } from "react";
import {
  ProposalConfirmCard,
  UserBubble,
  VerdictBubble,
  type ProposalMsg,
} from "@/components/PennyConversation";
import {
  BOILER_SERVICE_UPDATE_PROPOSAL,
  BOILER_SERVICE_UPDATE_REPLY,
  CAR_INSURANCE_PROPOSAL,
  CAR_INSURANCE_PLAN_REPLY,
  EATING_OUT_REPLY,
  PENNY_FIXTURE_ACCOUNTS,
} from "./penny-fixtures";

/** Production dependencies intentionally used by these proof plates. */
export { PENNY_DEPENDENCY_PATHS } from "./penny-fixtures";
export type PennyProofKind =
  | "penny-request"
  | "penny-chart"
  | "penny-proposal"
  | "penny-done"
  | "penny-cancelled"
  | "schedule-request"
  | "schedule-proposal"
  | "schedule-done";

const noOp = () => {};

function LocalProposal({ proposal, initialStatus = "pending", scheduledGoal }: { proposal: ProposalMsg; initialStatus?: ProposalMsg["status"]; scheduledGoal?: boolean }) {
  const [status, setStatus] = useState<ProposalMsg["status"]>(initialStatus);
  return (
    <ProposalConfirmCard
      msg={{ ...proposal, status }}
      onConfirm={() => setStatus("done")}
      onCancel={() => setStatus("cancelled")}
      onOpenDone={noOp}
      {...(scheduledGoal ? { scheduledGoalAccountOptions: PENNY_FIXTURE_ACCOUNTS, onRevise: async () => {} } : {})}
    />
  );
}

function PlanningProof({ done = false, cancelled = false }: { done?: boolean; cancelled?: boolean }) {
  const initialStatus = cancelled ? "cancelled" : done ? "done" : "pending";
  return (
    <div className="space-y-3">
      <UserBubble text="Plan £200 from Everyday on each of my next three paydays for car insurance." />
      <VerdictBubble msg={CAR_INSURANCE_PLAN_REPLY} onOfferTap={noOp} />
      <LocalProposal proposal={CAR_INSURANCE_PROPOSAL} initialStatus={initialStatus} scheduledGoal />
    </div>
  );
}

function ScheduleProof({ done = false }: { done?: boolean }) {
  return (
    <div className="space-y-3">
      <UserBubble text="Change the Boiler service from £90 on 24 Nov to £95 on 26 Nov." />
      <VerdictBubble msg={BOILER_SERVICE_UPDATE_REPLY} onOfferTap={noOp} />
      <LocalProposal proposal={BOILER_SERVICE_UPDATE_PROPOSAL} initialStatus={done ? "done" : "pending"} />
    </div>
  );
}

/**
 * A 390px, fixture-only host for the real production chat atoms. It contains
 * neither an API provider nor account data, so Confirm and Cancel are local
 * state demonstrations only.
 */
export default function PennyProof({ kind, theme }: { kind: PennyProofKind; theme: "light" | "dark" }) {
  const content = (() => {
    switch (kind) {
      case "penny-request":
        return <UserBubble text="Chart my spending against usual by day 10." />;
      case "penny-chart":
        return <><UserBubble text="Chart my spending against usual by day 10." /><VerdictBubble msg={EATING_OUT_REPLY} onOfferTap={noOp} /></>;
      case "penny-proposal":
        return <PlanningProof />;
      case "penny-done":
        return <PlanningProof done />;
      case "penny-cancelled":
        return <PlanningProof cancelled />;
      case "schedule-request":
        return <UserBubble text="Change the Boiler service from £90 on 24 Nov to £95 on 26 Nov." />;
      case "schedule-proposal":
        return <ScheduleProof />;
      case "schedule-done":
        return <ScheduleProof done />;
    }
  })();
  return (
    <section
      className={theme === "dark" ? "dark" : ""}
      data-penny-proof={kind}
      style={{ width: 390, minHeight: 1, color: theme === "dark" ? "#f1f5f9" : "#0f172a" }}
    >
      <div className="space-y-3">{content}</div>
    </section>
  );
}
