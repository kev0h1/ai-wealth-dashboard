"use client";

import { useEffect, useRef } from "react";
import { MoveCard } from "@/components/HomeBrief";
import { COVER_SUGGESTION } from "./payment-fixtures";

export type CoverProofKind = "movement" | "movement-sources";

/**
 * A production MoveCard with frozen, reconciled source evidence alongside it.
 * The evidence deliberately calls out safe headroom instead of calling a bank
 * balance available money. Sorted suggests the route; Alex makes it in their bank.
 */
export default function CoverProof({ kind, theme }: { kind: CoverProofKind; theme: "light" | "dark" }) {
  const ref = useRef<HTMLDivElement>(null);
  const sourcesOpen = kind === "movement-sources";

  useEffect(() => {
    ref.current?.querySelector("details[data-source-disclosure]")?.toggleAttribute("open", sourcesOpen);
  }, [sourcesOpen]);

  return (
    <div
      ref={ref}
      className={theme === "dark" ? "dark" : ""}
      data-capability-proof={kind}
      style={{ width: 390, color: theme === "dark" ? "#f1f5f9" : "#0f172a" }}
    >
      <MoveCard item={COVER_SUGGESTION} hideNetWorth={false} maskAmounts={(text) => text} previewMode />
    </div>
  );
}
