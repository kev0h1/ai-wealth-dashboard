"use client";
import ActionProof, { type ActionProofKind } from "./ActionProof";
import InsightProof, { type InsightProofKind } from "./InsightProof";
import type { FeatureProofKind } from "./catalog";

export default function FeatureProofScene({ kind, theme }: { kind: FeatureProofKind; theme: "light" | "dark" }) {
  const action = ["movement", "penny-request", "penny-proposal", "penny-done", "aside-form", "aside-saved"].includes(kind);
  return <div className={theme === "dark" ? "dark" : ""} style={{ width: 422, padding: 16, background: theme === "dark" ? "#0f172a" : "#f0f2f7" }}>
    <div style={{ width: 390 }}>
      {action ? <ActionProof kind={kind as ActionProofKind} theme={theme} /> : <InsightProof kind={kind as InsightProofKind} theme={theme} />}
    </div>
  </div>;
}
