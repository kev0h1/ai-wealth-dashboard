"use client";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import CampaignWorlds from "./CampaignWorlds";
import MarketingKit from "./MarketingKit";
import CraftedGallery from "./crafted/CraftedGallery";
import CampaignGallery from "./next/CampaignGallery";
import type { ProofKind } from "./next/ProofScene";
import { PROOF_KINDS, type FeatureProofKind } from "./features/catalog";
import StoreCanvas from "./store/StoreCanvas";
import { isStoreId, isStorePlatform } from "./store/catalog";

// Export fixtures use their own date in the browser. Avoid server-time copy in
// those isolated scenes while the real product retains its normal rendering.
const ProofScene = dynamic(() => import("./next/ProofScene"), { ssr: false });
const FeatureProofScene = dynamic(() => import("./features/FeatureProofScene"), { ssr: false });

export default function MarketingRoute() {
  const params = useSearchParams();
  const storeArt = params.get("store-art");
  const platform = params.get("platform");
  if (isStoreId(storeArt)) return <StoreCanvas id={storeArt} platform={isStorePlatform(platform) ? platform : "apple-medium"} theme={params.get("mode") === "dark" ? "dark" : "light"} />;
  const library = params.get("library") === "1" || params.has("feature") || params.has("export") || params.has("plate");
  const worlds = params.get("round") === "worlds" || ["c", "d", "e"].includes(params.get("campaign") ?? params.get("variant") ?? "");
  const crafted = params.get("round") === "crafted" || params.has("crafted-proof") || ["receipt", "friday", "calendar"].includes(params.get("direction") ?? params.get("variant") ?? "");
  const proof = params.get("media-proof");
  const featureProof = params.get("feature-proof");
  if (featureProof && PROOF_KINDS.includes(featureProof as FeatureProofKind)) return <FeatureProofScene kind={featureProof as FeatureProofKind} theme={params.get("mode") === "dark" ? "dark" : "light"} />;
  if (proof && ["safe", "ledger", "working", "accounts", "payment"].includes(proof)) return <ProofScene kind={proof as ProofKind} theme={params.get("mode") === "dark" ? "dark" : "light"} />;
  return library ? <MarketingKit /> : worlds ? <CampaignWorlds /> : crafted ? <CraftedGallery /> : <CampaignGallery />;
}
