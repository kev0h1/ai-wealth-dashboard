// Fixture tips for /design/spend-live, shaped like the live GET /savings-insights
// serializer output. G283 (Kevin, 2026-10-17): tips state facts only, so every
// text here is a fact with a source and a date, and no field carries a saving.
// (These replace the fixtures that lived in the deleted spend-tips preview,
// H113: its round was decided and shipped.)

import type { SavingsInsight } from "@/lib/api";

function tip(over: Partial<SavingsInsight> & Pick<SavingsInsight, "id" | "category" | "app_category" | "icon" | "label" | "title" | "body" | "triggered_by">): SavingsInsight {
  return {
    pinned: false,
    is_new: false,
    refreshed_at: "2026-09-01T19:44:05.000000Z",
    return_reason: null,
    stopped_line: null,
    substituted: false,
    substituted_merchant: null,
    substituted_line: null,
    deadline_at: null,
    claim_valid_until: null,
    content_valid_until: "2026-09-08T19:44:05.000000Z",
    expiry_line: "Researched 3d ago",
    state: "fresh",
    researched_at: "2026-09-01T19:44:05.000000Z",
    user_context: null,
    has_workflow: true,
    app_route: null,
    ...over,
  };
}

export const OPEN_TIPS: SavingsInsight[] = [
  tip({
    id: "mobile-spend-live", category: "mobile", app_category: "Bills", icon: "📱", label: "Mobile",
    title: "You pay EE £57 a month",
    body: "SIM-only plans are listed at £5 to £20 a month. Also listed: Asda Mobile £5 a month, Lebara £5 a month. Checked 1 Sep, source uswitch.com.",
    triggered_by: [{ merchant_key: "ee", display_name: "Ee", monthly_amount: 57.0, occurrences: 1, is_recurring: true }],
  }),
  tip({
    id: "energy-spend-live", category: "energy", app_category: "Bills", icon: "⚡", label: "Energy",
    title: "You pay Octopus Energy £160 a month",
    body: "Fixed tariffs are listed with prices held for 12 months. Checked 1 Sep, source ofgem.gov.uk.",
    triggered_by: [{ merchant_key: "octopus energy", display_name: "Octopus Energy", monthly_amount: 160.0, occurrences: 1, is_recurring: true }],
  }),
  tip({
    id: "gym-spend-live", category: "gym", app_category: "Health", icon: "🏋️", label: "Gym",
    title: "You pay David Lloyd £117 a month",
    body: "Gym memberships are listed at £15 to £22 a month on rolling terms. Also listed: PureGym £15 a month, JD Gyms £22 a month. Checked 1 Sep, source example.com.",
    triggered_by: [{ merchant_key: "david lloyd", display_name: "David Lloyd", monthly_amount: 117.0, occurrences: 1, is_recurring: true }],
  }),
  tip({
    id: "groceries-spend-live", category: "groceries", app_category: "Groceries", icon: "🛒", label: "Groceries",
    title: "You spend about £420 a month on groceries",
    body: "That is based on 12 payments in the last 90 days. Checked 1 Sep.",
    triggered_by: [{ merchant_key: "tesco", display_name: "Tesco", monthly_amount: 420.0, occurrences: 12, is_recurring: false }],
  }),
  tip({
    id: "subscriptions-spend-live", category: "subscriptions", app_category: "Subscriptions", icon: "🔁", label: "Subscriptions",
    title: "You pay £38 a month on subscriptions",
    body: "By merchant: Netflix £11 a month, Spotify £12 a month, Now Tv £15 a month. Checked 1 Sep.",
    triggered_by: [
      { merchant_key: "netflix", display_name: "Netflix", monthly_amount: 11.0, occurrences: 3, is_recurring: true },
      { merchant_key: "spotify", display_name: "Spotify", monthly_amount: 12.0, occurrences: 3, is_recurring: true },
      { merchant_key: "now tv", display_name: "Now Tv", monthly_amount: 15.0, occurrences: 3, is_recurring: true },
    ],
  }),
];
