"use client";

import { useState } from "react";
import { ProposalConfirmCard, UserBubble, VerdictBubble, type ProposalMsg } from "@/components/PennyConversation";
import { C22_PURPOSE_PROPOSAL, C22_PURPOSE_REPLY } from "./fixtures";

const NO_OP = () => {};

/**
 * A fixture-only pending proposal. It deliberately renders the production
 * confirmation card inside the phone rather than a portal-backed editor.
 * No API call is made from this preview.
 */
/** Real Penny confirmation UI in a deterministic, no-write preview host. */
export default function PurposeScreen() {
  const [status, setStatus] = useState<ProposalMsg["status"]>("pending");
  const proposal = { ...C22_PURPOSE_PROPOSAL, status };

  return <div className="space-y-3" data-c22-purpose-screen data-c22-fixture-only>
    <UserBubble text="Plan a £120 Car service from Everyday on 12 December." />
    <VerdictBubble msg={C22_PURPOSE_REPLY} onOfferTap={NO_OP} />
    <ProposalConfirmCard
      msg={proposal}
      onConfirm={() => setStatus("done")}
      onCancel={() => setStatus("cancelled")}
      onOpenDone={NO_OP}
    />
  </div>;
}
