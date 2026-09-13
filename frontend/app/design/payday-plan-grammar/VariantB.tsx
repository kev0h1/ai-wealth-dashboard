import { useRouter } from "next/navigation";
import PaydayPlanCard from "@/components/PaydayPlanCard";
import type { PaydayScenario } from "./fixtures";
import { paydayPlanItem } from "./fixtures";
import { PreviewHeading } from "./shared";

export default function VariantB({ scenario }: { scenario: PaydayScenario }) {
  const router = useRouter();
  return <section aria-label="Variant B, allocation ledger"><PreviewHeading title="B · Allocation ledger" copy="Every allocation stays visible: the clearest audit trail from expected pay to each account." /><PaydayPlanCard item={paydayPlanItem(scenario)} router={router} hideNetWorth={false} maskAmounts={(text) => text} /></section>;
}
