"use client";

import { useEffect, useRef } from "react";
import SafeToSpendCard from "@/components/SafeToSpendCard";
import PennyChart from "@/components/PennyChart";
import { PROOF_ACCOUNTS, SAFE_TO_SPEND } from "../marketing-kit/fixtures";
import { EATING_OUT_CHART } from "../marketing-kit/capabilities/penny-fixtures";
import type { Theme } from "./catalog";
import styles from "./creative.module.css";

/** Current shipped components, the approved C22 fictional scenarios, no API operations. */
export default function CreativeProof({ kind, theme }: { kind: "amount" | "penny"; theme: Theme }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    host.current?.setAttribute("data-c41-ready", "true");
  }, [theme]);
  return <div
    data-c41-proof
    ref={host}
    data-c41-ready="false"
    className={`${styles.proofHost} ${theme === "dark" ? "dark" : ""}`}
    style={{ width: kind === "amount" ? 390 : 480, padding: kind === "penny" ? 16 : 0, background: theme === "dark" ? "#0f172a" : "#f0f2f7", color: theme === "dark" ? "#f1f5f9" : "#0f172a" }}
  >
    {kind === "amount" ? <SafeToSpendCard
      data={SAFE_TO_SPEND}
      previewBalancesVisible
      spendFrom={{ kind: "account", best: { accountId: PROOF_ACCOUNTS[0].id, name: "Everyday account", provider: "Monzo", headroom: 312, account: PROOF_ACCOUNTS[0] }, alternative: null }}
    /> : <PennyChart chart={EATING_OUT_CHART} />}
  </div>;
}
