"use client";
import UpcomingAccountsCard from "@/components/upcoming/UpcomingAccountsCard";
import ProductionProof from "../ProductionProof";
import { PROOF_PERIOD, PROOF_PERSON, UPCOMING_ACCOUNTS } from "../fixtures";

/** The real paying-account warning, bounded to the account in the calendar. */
export default function CraftedProof({ feature }: { feature: "safe-to-spend" | "upcoming" }) {
  if (feature === "safe-to-spend") return <ProductionProof feature={feature} />;
  return <section data-marketing-proof="upcoming" className="w-[390px]">
    <p className="mb-3 text-xs font-medium text-slate-500 dark:text-slate-400">{PROOF_PERSON} · {PROOF_PERIOD}</p>
    <UpcomingAccountsCard accounts={[UPCOMING_ACCOUNTS[1]]} periodLabel="8–30 October" plans={[]} onOpen={() => {}} />
  </section>;
}
