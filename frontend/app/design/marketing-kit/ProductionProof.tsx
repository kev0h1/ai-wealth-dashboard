"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BankResults, ConnectionNotice } from "@/components/bank-connect/BankConnectionParts";
import CoverPlanSourcesCard from "@/components/CoverPlanSourcesCard";
import { MoveCard } from "@/components/HomeBrief";
import InvestmentMiniCard from "@/components/InvestmentMiniCard";
import { ConsentCard, ProposalConfirmCard } from "@/components/PennyConversation";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import UpcomingHeroCard from "@/components/upcoming/UpcomingHeroCard";
import {
  INVESTMENT,
  MOVE_SUGGESTION,
  PAYDAY_PLAN,
  PENNY_CONSENT,
  PENNY_PROPOSAL,
  PROOF_ACCOUNTS,
  PROOF_BANKS,
  PROOF_PERIOD,
  PROOF_PERSON,
  SAFE_TO_SPEND,
  UPCOMING_ACCOUNTS,
  UPCOMING_HERO,
} from "./fixtures";

export type FeatureId = "connect" | "safe-to-spend" | "upcoming" | "suggestions" | "payday" | "investments" | "penny";

export const PROOF_SOURCES: Record<FeatureId, readonly string[]> = {
  connect: ["@/components/bank-connect/BankConnectionParts: BankResults, ConnectionNotice"],
  "safe-to-spend": ["@/components/SafeToSpendCard: default"],
  upcoming: ["@/components/upcoming/UpcomingHeroCard: default", "@/components/upcoming/UpcomingAccountsCard: default"],
  suggestions: ["@/components/HomeBrief: MoveCard", "@/components/CoverPlanSourcesCard: default"],
  payday: ["@/components/PaydayPlanCard: default"],
  investments: ["@/components/InvestmentMiniCard: default"],
  penny: ["@/components/PennyConversation: ConsentCard, ProposalConfirmCard"],
};

const noOp = () => {};

function ProofMeta() {
  return <p className="mb-3 text-xs font-medium text-slate-500 dark:text-slate-400">{PROOF_PERSON} · {PROOF_PERIOD}</p>;
}

function ConnectProof({ expanded }: { expanded: boolean }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
    <BankResults banks={PROOF_BANKS} query={query} setQuery={setQuery} searchRef={searchRef} selected={null} onChoose={noOp} />
    {expanded && <div className="border-t border-slate-200 dark:border-slate-700"><ConnectionNotice /></div>}
  </div>;
}

export default function ProductionProof({ feature, expanded = false }: { feature: FeatureId; expanded?: boolean }) {
  const router = useRouter();
  const wrap = (content: ReactNode) => <section data-marketing-proof={feature} className={`w-full max-w-[390px] ${expanded ? "space-y-4" : ""}`}><ProofMeta />{content}</section>;

  switch (feature) {
    case "connect": return wrap(<ConnectProof expanded={expanded} />);
    case "safe-to-spend": return wrap(<SafeToSpendCard data={SAFE_TO_SPEND} spendFrom={{ kind: "unavailable", reason: "loading" }} previewBalancesVisible />);
    case "upcoming": return wrap(<div className="space-y-3"><UpcomingHeroCard {...UPCOMING_HERO} /><UpcomingAccountsCard accounts={UPCOMING_ACCOUNTS} periodLabel="8–30 October" plans={[]} onOpen={noOp} /></div>);
    case "suggestions": return wrap(<div className="space-y-3"><MoveCard item={MOVE_SUGGESTION} hideNetWorth={false} maskAmounts={(text) => text} previewMode />{expanded && <CoverPlanSourcesCard accounts={PROOF_ACCOUNTS} excludedIds={new Set()} onToggle={noOp} />}</div>);
    case "payday": return wrap(<PaydayPlanCard item={PAYDAY_PLAN} router={router} hideNetWorth={false} maskAmounts={(text) => text} onClose={noOp} />);
    case "investments": return wrap(<InvestmentMiniCard account={INVESTMENT} calm glass grid />);
    case "penny": return wrap(<div className="space-y-3"><div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-3 text-sm leading-relaxed text-white">Could you set aside £40 for my rainy day fund?</div>{expanded && <ConsentCard msg={PENNY_CONSENT} onAccept={noOp} onDecline={noOp} />}<ProposalConfirmCard msg={PENNY_PROPOSAL} onConfirm={noOp} onCancel={noOp} onOpenDone={noOp} /></div>);
  }
}
