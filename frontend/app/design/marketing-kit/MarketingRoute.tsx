"use client";
import { useSearchParams } from "next/navigation";
import CampaignWorlds from "./CampaignWorlds";
import MarketingKit from "./MarketingKit";
import CraftedGallery from "./crafted/CraftedGallery";

export default function MarketingRoute() {
  const params = useSearchParams();
  const library = params.get("library") === "1" || params.has("feature") || params.has("export") || params.has("plate");
  const worlds = params.get("round") === "worlds" || ["c", "d", "e"].includes(params.get("campaign") ?? params.get("variant") ?? "");
  return library ? <MarketingKit /> : worlds ? <CampaignWorlds /> : <CraftedGallery />;
}
