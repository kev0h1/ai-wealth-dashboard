// G207 preview: the production HomeInsightSpotlight (via its previewInsight
// prop, no API calls) in a scrollable column of neighbour cards, so the
// swipe-to-dismiss gesture can be exercised in a browser: a vertical scroll
// that starts on the tip card must leave it exactly in line, a horizontal
// swipe past the threshold dismisses. Static fixture, no data fetching.
// Deep-link: /design/home-tip-gesture
import HomeInsightSpotlight from "@/components/HomeInsightSpotlight";
import { INSIGHT_FIXTURES } from "../insights-live/fixtures";

export default function Page() {
  const insight = INSIGHT_FIXTURES.fresh_weekly;
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 py-6 space-y-4 max-w-md mx-auto">
      <p className="px-4 text-xs text-slate-500">G207 gesture check. Scroll with a finger starting on the tip card, then swipe it left.</p>
      {[1, 2].map((n) => (
        <div key={n} className="mx-4 h-28 rounded-2xl glass-card" />
      ))}
      <HomeInsightSpotlight previewInsight={insight} />
      {[3, 4, 5, 6, 7, 8].map((n) => (
        <div key={n} className="mx-4 h-28 rounded-2xl glass-card" />
      ))}
    </main>
  );
}
