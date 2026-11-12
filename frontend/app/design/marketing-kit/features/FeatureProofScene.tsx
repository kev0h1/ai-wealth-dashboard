"use client";
import ActionProof, { type ActionProofKind } from "./ActionProof";
import InsightProof, { type InsightProofKind } from "./InsightProof";
import type { FeatureProofKind } from "./catalog";
import PennyProof, { type PennyProofKind } from "../capabilities/PennyProof";
import SpendProof, { type SpendProofKind } from "../capabilities/SpendProof";
import CoverProof, { type CoverProofKind } from "../capabilities/CoverProof";
import PaymentsProof, { type PaymentsProofKind } from "../capabilities/PaymentsProof";

export default function FeatureProofScene({ kind, theme }: { kind: FeatureProofKind; theme: "light" | "dark" }) {
  const action = ["aside-form", "aside-saved"].includes(kind);
  const content = kind.startsWith("penny-") || kind.startsWith("schedule-") ? <PennyProof kind={kind as PennyProofKind} theme={theme} /> :
    ["spend", "spend-insight", "spend-expenses"].includes(kind) ? <SpendProof kind={kind as SpendProofKind} theme={theme} /> :
    ["movement", "movement-sources"].includes(kind) ? <CoverProof kind={kind as CoverProofKind} theme={theme} /> :
    kind.startsWith("upcoming-") ? <PaymentsProof key={kind} kind={kind as PaymentsProofKind} theme={theme} /> :
    action ? <ActionProof kind={kind as ActionProofKind} theme={theme} /> : <InsightProof kind={kind as InsightProofKind} theme={theme} />;
  return <div className={theme === "dark" ? "dark" : ""} style={{ width: 422, padding: 16, background: theme === "dark" ? "#0f172a" : "#f0f2f7" }}>
    <div data-feature-proof={kind} style={{ width: 390 }}>
      {content}
    </div>
  </div>;
}
