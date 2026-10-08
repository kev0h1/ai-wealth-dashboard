"use client";
import { useSearchParams } from "next/navigation";
import CampaignWorlds from "./CampaignWorlds";
import MarketingKit from "./MarketingKit";

export default function MarketingRoute() {
  const params = useSearchParams();
  const library = params.get("library") === "1" || params.has("feature") || params.has("export") || params.has("plate");
  return library ? <MarketingKit /> : <CampaignWorlds />;
}
