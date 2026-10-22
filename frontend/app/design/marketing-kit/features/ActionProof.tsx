"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MoveCard } from "@/components/HomeBrief";
import { ProposalConfirmCard, UserBubble, type ProposalMsg } from "@/components/PennyConversation";
import SetAsideSheet from "@/components/SetAsideSheet";
import SetAsideList from "@/components/upcoming/SetAsideList";
import {
  ACTION_ACCOUNTS,
  ACTION_PERIOD,
  ANNUAL_COSTS_ALLOCATION,
  ANNUAL_COSTS_SET_ASIDE,
  MOVEMENT_SUGGESTION,
  PENNY_SET_ASIDE_PROPOSAL,
} from "./action-fixtures";

export type ActionProofKind = "movement" | "penny-request" | "penny-proposal" | "penny-done" | "aside-form" | "aside-saved";

const noOp = () => {};

function PennyAction({ done }: { done: boolean }) {
  const [status, setStatus] = useState<ProposalMsg["status"]>(done ? "done" : "pending");
  const message: ProposalMsg = { ...PENNY_SET_ASIDE_PROPOSAL, status };
  return <div className="space-y-3">
    <UserBubble text="Set aside £200 for annual costs." />
    <ProposalConfirmCard
      msg={message}
      onConfirm={() => setStatus("done")}
      onCancel={() => setStatus("cancelled")}
      onOpenDone={noOp}
    />
  </div>;
}

/**
 * Real production components in a deterministic, API-free host. The SetAside
 * sheet is intentionally allowed to use its real portal. Export tooling must
 * capture its portal and set the document dark class for dark mode.
 */
function AsideForm({ theme }: { theme: "light" | "dark" }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    return () => { root.classList.toggle("dark", wasDark); };
  }, [theme]);

  if (saved) return <SetAsideList items={[ANNUAL_COSTS_SET_ASIDE]} onEdit={noOp} />;
  return <>{open && <SetAsideSheet
    accounts={ACTION_ACCOUNTS}
    periodStart={ACTION_PERIOD}
    scope="all"
    onClose={() => setOpen(false)}
    onSelectSingle={noOp}
    onSavedAllocation={() => { setSaved(true); setOpen(false); }}
    operations={{
      createAllocation: async (body) => ({ ...ANNUAL_COSTS_ALLOCATION, ...body }),
      allocationFillCandidates: async () => [],
    }}
  />}</>;
}

export default function ActionProof({ kind, theme }: { kind: ActionProofKind; theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const wrap = (content: ReactNode) => <div
    className={dark ? "dark" : ""}
    data-feature-proof={kind}
    style={{ width: 390, minHeight: 1, color: dark ? "#f1f5f9" : "#0f172a" }}
  >{content}</div>;

  switch (kind) {
    case "movement":
      return wrap(<MoveCard item={MOVEMENT_SUGGESTION} hideNetWorth={false} maskAmounts={(text) => text} previewMode />);
    case "penny-request":
      return wrap(<UserBubble text="Set aside £200 for annual costs." />);
    case "penny-proposal":
      return wrap(<PennyAction done={false} />);
    case "penny-done":
      return wrap(<PennyAction done />);
    case "aside-form":
      return wrap(<AsideForm theme={theme} />);
    case "aside-saved":
      return wrap(<SetAsideList items={[ANNUAL_COSTS_SET_ASIDE]} onEdit={noOp} />);
  }
}
