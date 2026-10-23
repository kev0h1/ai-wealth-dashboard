export const FEATURE_IDS = ["movement", "month", "spend", "split", "penny", "aside"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export const isFeature = (value: string | null): value is FeatureId => FEATURE_IDS.includes(value as FeatureId);

export const FEATURES: Record<FeatureId, { title: string; heading: string; caption: string; proof: string; legal: string }> = {
  movement: { title: "Money movements", heading: "Right amount.\nRight account.", caption: "A suggested £120 move covers a £188 payment from an account holding £68. You make the transfer in your bank.", proof: "movement", legal: "Fictional example · You make any transfer in your bank" },
  month: { title: "Month in review", heading: "Your month.\nThe whole picture.", caption: "September: £2,400 came in, £1,800 was spent and £400 moved to savings, leaving £200.", proof: "month-spending", legal: "Fictional example · 1–30 September 2026" },
  spend: { title: "Spend", heading: "Know where\nit goes.", caption: "See £860 of spending and £400 moved separately, alongside your pace for the current pay period.", proof: "spend", legal: "Fictional example · 8–30 October 2026" },
  split: { title: "50/30/20", heading: "A guide.\nNot a grade.", caption: "Compare actual Fixed, Free and Moved amounts with an adapted 50/30/20 reference. It does not set your budget.", proof: "split-card", legal: "Fictional example · Adapted reference, not a target" },
  penny: { title: "Penny actions", heading: "Ask Penny.\nKeep the final say.", caption: "Ask Penny to create a £200 annual-costs envelope. Review the proposal and confirm before the plan is saved.", proof: "penny-proposal", legal: "Fictional example · Your confirmation creates the plan" },
  aside: { title: "Set money aside", heading: "Future costs.\nAlready in the plan.", caption: "Create a £200 envelope for annual costs, choose its source and how to track it, then review and save.", proof: "aside-saved", legal: "Fictional example · A plan, not a bank transfer" },
};

export const PROOF_KINDS = ["movement", "penny-request", "penny-proposal", "penny-done", "aside-form", "aside-saved", "month-title", "month-spending", "month-categories", "spend", "spend-detail", "shape", "split", "split-card"] as const;
export type FeatureProofKind = (typeof PROOF_KINDS)[number];
