export const FEATURE_IDS = ["movement", "month", "spend", "split", "penny", "aside", "upcoming", "plans", "schedule"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export const isFeature = (value: string | null): value is FeatureId => FEATURE_IDS.includes(value as FeatureId);

export type FeatureDefinition = { title: string; heading: string; caption: string; proof: string; legal: string };

export const FEATURES: Record<FeatureId, FeatureDefinition> = {
  movement: { title: "Money movements", heading: "Cover the gap.\nKeep control.", caption: "Sorted suggests £80 from Everyday and £40 from Joint to cover a £188 bill from an account holding £68. You make any transfer in your bank.", proof: "movement-sources-still", legal: "Fictional example · You make any transfer in your bank" },
  month: { title: "Month in review", heading: "Your month.\nThe whole picture.", caption: "September: £2,400 came in, £1,800 was spent and £400 moved to savings, leaving £200.", proof: "month-spending", legal: "Fictional example · 1–30 September 2026" },
  spend: { title: "Spend", heading: "See what changed.\nSee where.", caption: "£860 is out by day 10 against a usual £740. Eating Out is £240, £120 above its usual spend at this point.", proof: "spend-insight-still", legal: "Fictional example · 8–30 November 2026, through day 10" },
  split: { title: "50/30/20", heading: "A guide.\nNot a grade.", caption: "Compare actual Fixed, Free and Moved amounts with an adapted 50/30/20 reference. It does not set your budget.", proof: "split-rows", legal: "Fictional example · Adapted reference, not a target" },
  penny: { title: "Penny charts", heading: "Ask Penny.\nSee the picture.", caption: "Ask a question, then see the chart behind the answer. Penny explains the data, while you keep the final say.", proof: "penny-chart-still", legal: "Fictional example · Penny explains, you decide" },
  aside: { title: "Set money aside", heading: "Groceries.\nAlready allowed for.", caption: "Set aside £250 every pay period for groceries. This changes the plan, not the money in your bank.", proof: "aside-saved", legal: "Fictional example · A plan, not a bank transfer" },
  upcoming: { title: "Upcoming payments", heading: "Change a payment.\nKeep it current.", caption: "See a £90 boiler service due 24 November, create it, then update it to £95 due 26 November.", proof: "upcoming-updated-still", legal: "Fictional example · Review upcoming payments in one place" },
  plans: { title: "Penny plans", heading: "Break it down.\nKeep the dates.", caption: "Penny proposes £600 car insurance across three £200 paydays: 30 November, 30 December and 30 January. You confirm before it is scheduled.", proof: "penny-done-still", legal: "Fictional example · Your confirmation schedules the plan" },
  schedule: { title: "Payment schedule", heading: "Update the plan.\nKeep the context.", caption: "Change a planned boiler payment in chat from £90 to £95 and move it from 24 to 26 November, then confirm the update.", proof: "schedule-proposal-still", legal: "Fictional example · Your confirmation updates the schedule" },
};

/** Existing capture names stay valid while the new capability stories land. */
export const PROOF_KINDS = [
  "movement", "movement-sources", "penny-request", "penny-proposal", "penny-done", "penny-chart", "penny-cancelled",
  "aside-form", "aside-saved", "month-title", "month-spending", "month-categories", "spend", "spend-detail", "spend-insight", "spend-expenses",
  "shape", "split", "split-card", "split-rows", "upcoming-list", "upcoming-create", "upcoming-saved", "upcoming-edit", "upcoming-updated",
  "schedule-request", "schedule-proposal", "schedule-done",
] as const;
export type FeatureProofKind = (typeof PROOF_KINDS)[number];
