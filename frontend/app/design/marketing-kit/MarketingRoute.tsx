"use client";
import { useSearchParams } from "next/navigation";
import CampaignWorlds from "./CampaignWorlds";
import MarketingKit from "./MarketingKit";
import CraftedGallery from "./crafted/CraftedGallery";
import CampaignGallery from "./next/CampaignGallery";
import ProofScene, { type ProofKind } from "./next/ProofScene";
import FeatureProofScene from "./features/FeatureProofScene";
import { PROOF_KINDS, type FeatureProofKind } from "./features/catalog";

export default function MarketingRoute() {
  const params = useSearchParams();
  const library = params.get("library") === "1" || params.has("feature") || params.has("export") || params.has("plate");
  const worlds = params.get("round") === "worlds" || ["c", "d", "e"].includes(params.get("campaign") ?? params.get("variant") ?? "");
  const crafted = params.get("round") === "crafted" || params.has("crafted-proof") || ["receipt", "friday", "calendar"].includes(params.get("direction") ?? params.get("variant") ?? "");
  const proof = params.get("media-proof");
  const featureProof = params.get("feature-proof");
  if (featureProof && PROOF_KINDS.includes(featureProof as FeatureProofKind)) return <FeatureProofScene kind={featureProof as FeatureProofKind} theme={params.get("mode") === "dark" ? "dark" : "light"} />;
  if (proof && ["safe", "ledger", "working", "accounts", "payment"].includes(proof)) return <ProofScene kind={proof as ProofKind} theme={params.get("mode") === "dark" ? "dark" : "light"} />;
  return library ? <MarketingKit /> : worlds ? <CampaignWorlds /> : crafted ? <CraftedGallery /> : <CampaignGallery />;
}
