import type { FeatureId } from "../ProductionProof";

export type Direction = "receipt" | "friday" | "calendar";

export type CampaignDirection = {
  id: Direction;
  title: string;
  description: string;
  rationale: string;
  feature: FeatureId;
};

export const directions: readonly CampaignDirection[] = [
  {
    id: "receipt",
    title: "The calculation",
    description: "A printed calculation makes the estimate tangible.",
    rationale: "A receipt turns an abstract balance into an auditable sequence of inputs.",
    feature: "safe-to-spend",
  },
  {
    id: "friday",
    title: "Friday plans",
    description: "A small everyday decision starts with a clear amount.",
    rationale: "Plain editorial type holds the question while the production card provides the answer.",
    feature: "safe-to-spend",
  },
  {
    id: "calendar",
    title: "October, in view",
    description: "The month gives upcoming payments their real place in time.",
    rationale: "A calendar is the evidence itself, so nothing needs to float or pretend to be an app screen.",
    feature: "upcoming",
  },
] as const;

export const campaignDirection = (id: Direction): CampaignDirection => directions.find((direction) => direction.id === id) ?? directions[0];
