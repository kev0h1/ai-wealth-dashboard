// TEMPORARY PREVIEW INDEX — delete with the preview routes
//
// Static index of the active /design/* preview routes so the owner can
// bookmark one URL on his phone instead of the individual previews.
// No data fetching, no client state — plain links only.

import Link from "next/link";

type PreviewRoute = {
  slug: string;
  name: string;
  description: string;
  states: { label: string; value: string }[];
};

const ROUTES: PreviewRoute[] = [
  {
    slug: "scenario-a",
    name: "scenario-a",
    description: "What-if verdict · Delta-led comparison (now vs with this)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "scenario-b",
    name: "scenario-b",
    description: "What-if verdict · Verdict-led, quietest, one sentence + one fact",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "scenario-c",
    name: "scenario-c",
    description: "What-if verdict · Baseline-led (standing position leads)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "coming-up",
    name: "coming-up",
    description: "Coming up card · 3 variants (ledger / timeline / next three)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-chat",
    name: "penny-chat",
    description: "One Penny · prompt bar + verdict answers",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-thread",
    name: "penny-thread",
    description: "Penny thread · question/answer contrast, 3 variants (quiet label / anchored / inset)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-sheet",
    name: "penny-sheet",
    description: "Penny sheet · bottom sheet over the nav vs full-page, cards vs bubbles grammar (?g=cards|bubbles)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "penny-glyph",
    name: "penny-glyph",
    description: "Sparkle replacement · 3 settle-mark-derived glyph candidates",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "spend-live",
    name: "spend-live",
    description: "Spend page · fixtures reference (real components)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "miscategorised",
    name: "miscategorised",
    description: "Miscategorised-transfers review sheet · range/single/unresolved-account/capped-members/long-name fixtures (real component)",
    states: [{ label: "Everything", value: "everything" }],
  },
  {
    slug: "type",
    name: "type",
    description: "Home hero · 4 typeface treatments (System / Figtree / DM Sans / Figtree+Mono)",
    states: [{ label: "Everything", value: "everything" }],
  },
];

export default function DesignIndexPage() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">
          Design previews
        </h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Temporary review builds. Newest first.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {ROUTES.map((route) => (
            <div key={route.slug} className="glass-card-flat rounded-2xl p-4">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {route.name}
              </div>
              <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                {route.description}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {route.states.map((s) => (
                  <Link
                    key={s.value}
                    href={`/design/${route.slug}?mode=dark&state=${s.value}`}
                    className="inline-flex items-center min-h-[44px] rounded-full px-3.5 py-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15 active:scale-95 transition-transform"
                  >
                    {s.label}
                  </Link>
                ))}
              </div>

              <div className="mt-2">
                <Link
                  href={`/design/${route.slug}?mode=light&state=${route.states[0].value}`}
                  className="text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2"
                >
                  light
                </Link>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
          These routes are deleted after review.
        </p>
      </div>
    </div>
  );
}
