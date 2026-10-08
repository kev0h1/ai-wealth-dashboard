export const MARKETING_FPS = 30;

export type MarketingFilmId = "safe-to-spend" | "upcoming" | "penny" | "overview" | "app-preview";
export type MarketingTheme = "light" | "dark";

export type FilmDefinition = {
  id: MarketingFilmId;
  width: number;
  height: number;
  durationInFrames: number;
  fps: number;
  label: string;
};

const fifteenSeconds = MARKETING_FPS * 15;
const thirtySeconds = MARKETING_FPS * 30;

// These dimensions are deliberately data, rather than composition-specific
// constants, so the command line export and the in-app Player cannot drift.
export const filmDefinitions: Record<MarketingFilmId, FilmDefinition> = {
  "safe-to-spend": { id: "safe-to-spend", label: "Safe to Spend", width: 1080, height: 1920, durationInFrames: fifteenSeconds, fps: MARKETING_FPS },
  upcoming: { id: "upcoming", label: "Upcoming", width: 1080, height: 1920, durationInFrames: fifteenSeconds, fps: MARKETING_FPS },
  penny: { id: "penny", label: "Penny", width: 1080, height: 1920, durationInFrames: fifteenSeconds, fps: MARKETING_FPS },
  overview: { id: "overview", label: "Sorted overview", width: 1080, height: 1920, durationInFrames: thirtySeconds, fps: MARKETING_FPS },
  "app-preview": { id: "app-preview", label: "App Store editorial preview", width: 886, height: 1920, durationInFrames: thirtySeconds, fps: MARKETING_FPS },
};

export const MARKETING_SAFE = { top: 160, bottom: 360, left: 72, right: 130 };

export const featureIds = ["connect", "safe-to-spend", "upcoming", "suggestions", "payday", "investments", "penny"] as const;
export type FeatureId = (typeof featureIds)[number];

export const proofSrc = (feature: FeatureId, theme: MarketingTheme) =>
  `design-media/c22/proof-${feature}-${theme}.png`;
