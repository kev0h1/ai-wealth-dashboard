// E7: the /ops/health collector sections, in display order. `key` is the
// collector name served by GET /ops/health/collectors/{key}
// (backend/app/services/health). Pinned by scripts/e7-health-page.test.mjs.
// Plain wording lives here so the page and the check agree on it.

export const SECTIONS = [
  { key: "api_latency", title: "API latency" },
  { key: "finexer_sync", title: "Sync health" },
  { key: "worker", title: "Worker queue" },
  { key: "llm_tavily", title: "Spend and Tavily" },
  { key: "mongo", title: "Database" },
  { key: "vps", title: "Server status" },
  { key: "railway", title: "Railway" },
  { key: "vercel", title: "Vercel" },
  { key: "push", title: "Push delivery" },
] as const;

export const TRENDS_TITLE = "Trends";
export const ALERTS_TITLE = "Alerts";

// E8: alert block wording, shared with scripts/e7-health-page.test.mjs.
export const ALERTS_WORDING = {
  off: "Alerts are off. Set ALERTS_ENABLED on the server to turn them on.",
  none: "No open alerts.",
  noHistory: "Nothing in the last 24 hours.",
  testButton: "Send test alert",
  testSent: "Test alert sent.",
  testThrottled: "Test alerts are limited to one a minute. Try again shortly.",
  testFailed: "Couldn't send the test alert.",
} as const;

export const WORDING = {
  notConfigured: "Not configured",
  timedOut: "Timed out",
  omitted: "Not available",
  failed: "Couldn't load",
} as const;
