export const STORE_IDS = ["amount", "account", "spend", "movement", "penny", "plans", "aside", "schedule"] as const;
export type StoreId = (typeof STORE_IDS)[number];
export const STORE_PLATFORMS = ["apple-medium", "apple-large", "apple-classic", "play", "feature"] as const;
export type StorePlatform = (typeof STORE_PLATFORMS)[number];
export type StoreTheme = "light" | "dark";

export const STORE_SIZES: Record<StorePlatform, { width: number; height: number }> = {
  "apple-medium": { width: 1206, height: 2622 },
  "apple-large": { width: 1320, height: 2868 },
  "apple-classic": { width: 1242, height: 2688 },
  play: { width: 1080, height: 1920 },
  feature: { width: 1024, height: 500 },
};

export const STORE_ART: Record<StoreId, { title: string; kicker: string; headline: string; heading: string; caption: string; supporting: string; proof: string; alt: string; qualifier: string }> = {
  "amount": {
    "title": "Left to spend",
    "kicker": "LEFT TO SPEND",
    "headline": "Know what is yours to spend.",
    "supporting": "One clear estimate for the time until payday.",
    "proof": "next/proof-safe",
    "alt": "Left to spend estimate and its paying-account context.",
    "qualifier": "Fictional example · Estimated until 30 October 2026",
    "heading": "Know what is yours to spend.",
    "caption": "One clear estimate for the time until payday."
  },
  "account": {
    "title": "Upcoming payments",
    "kicker": "UPCOMING",
    "headline": "Your payments. Your plan.",
    "supporting": "See what is due, add one-offs and make changes.",
    "proof": "features/proof-upcoming-updated",
    "alt": "Upcoming bills and an updated Boiler service one-off in Sorted.",
    "qualifier": "Fictional example · November 2026",
    "heading": "Your payments. Your plan.",
    "caption": "See what is due, add one-offs and make changes."
  },
  "spend": {
    "title": "Where spending changed",
    "kicker": "SPENDING",
    "headline": "See where you are spending more.",
    "supporting": "Compare expenses with your usual pace at the same point in the period.",
    "proof": "features/proof-spend-insight",
    "alt": "Eating Out spending of £240 compared with £120 usual by day 10.",
    "qualifier": "Fictional example · Same pay period, through day 10",
    "heading": "See where you are spending more.",
    "caption": "Compare expenses with your usual pace at the same point in the period."
  },
  "movement": {
    "title": "Cover from multiple accounts",
    "kicker": "MONEY MOVEMENTS",
    "headline": "One bill. More than one account.",
    "supporting": "Review the suggested contributions, then use your bank.",
    "proof": "features/proof-movement-sources",
    "alt": "Suggested £80 and £40 contributions cover a £120 payment gap.",
    "qualifier": "Fictional example · You make transfers in your bank",
    "heading": "One bill. More than one account.",
    "caption": "Review the suggested contributions, then use your bank."
  },
  "penny": {
    "title": "Penny charts",
    "kicker": "ASK PENNY",
    "headline": "Ask a question. See it clearly.",
    "supporting": "Visualise spending against the same point in your usual pay period.",
    "proof": "features/proof-penny-chart",
    "alt": "Penny charts category spending against usual by day 10.",
    "qualifier": "Fictional example · Spending comparison, not a forecast",
    "heading": "Ask a question. See it clearly.",
    "caption": "Visualise spending against the same point in your usual pay period."
  },
  "plans": {
    "title": "Penny plans",
    "kicker": "PLAN WITH PENNY",
    "headline": "A clear goal. A contribution plan.",
    "supporting": "Three planned contributions build a £600 car-insurance goal.",
    "proof": "features/proof-penny-proposal",
    "alt": "Penny proposes a £600 goal with three £200 contributions before confirmation.",
    "qualifier": "Fictional example · Your confirmation creates the goal",
    "heading": "A clear goal. A contribution plan.",
    "caption": "Three planned contributions build a £600 car-insurance goal."
  },
  "aside": {
    "title": "Set money aside",
    "kicker": "SET MONEY ASIDE",
    "headline": "Give everyday spending its own plan.",
    "supporting": "Set aside £250 for groceries each pay period.",
    "proof": "features/proof-aside-form",
    "alt": "Review a £250 grocery set-aside, its source and tracking before saving.",
    "qualifier": "Fictional example · A plan you control",
    "heading": "Give everyday spending its own plan.",
    "caption": "Set aside £250 for groceries each pay period."
  },
  "schedule": {
    "title": "Payment changes in chat",
    "kicker": "PAYMENT PLANS",
    "headline": "Change a payment plan in chat.",
    "supporting": "Review the new amount and date before confirming.",
    "proof": "features/proof-schedule-proposal",
    "alt": "Penny proposes changing Boiler service from £90 on 24 Nov to £95 on 26 Nov.",
    "qualifier": "Fictional example · Bank payments stay with your bank",
    "heading": "Change a payment plan in chat.",
    "caption": "Review the new amount and date before confirming."
  }
};

export const isStoreId = (value: string | null): value is StoreId => STORE_IDS.includes(value as StoreId);
export const isStorePlatform = (value: string | null): value is StorePlatform => STORE_PLATFORMS.includes(value as StorePlatform);

/** The direct download filename used by the gallery and store upload pack. */
export const storeAssetName = (platform: StorePlatform, id: StoreId, theme: StoreTheme) =>
  platform === "feature" ? `feature-${id}-${theme}.png` : `${id}-${theme}-${platform}.png`;

export const STORE_ITEMS = STORE_ART;
export const STORE_FORMATS = Object.fromEntries(STORE_PLATFORMS.map(id => [id, { id, label: id.replace("apple-", "Apple ").replace("play", "Google Play").replace("feature", "Play feature graphic"), ...STORE_SIZES[id] }])) as Record<StorePlatform, { id: StorePlatform; label: string; width: number; height: number }>;
