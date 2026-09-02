"use client";

// TEMPORARY PREVIEW — delete after design review.
// Renders the REAL StoryPlayer against a hardcoded fixture CycleStory, so
// design review sees the exact rendered truth (motion, spotlight glow,
// category icons, credit-card copy) with zero auth and zero network calls.
// StoryPlayer itself is intrinsically dark (a full-bleed night-mode
// overlay); there's no light variant to toggle.
//
// Three glow variants (2026-08-28, owner undecided on the spotlight glow
// after phone review) wired onto StoryPlayer's own spotlight/align props —
// see the doc comment above StoryPlayer's export for what each does and
// why the real /month/story route is unaffected. Deep-linkable per variant:
//   /design/month-story?variant=a   anchored spotlight, today's layout (control)
//   /design/month-story?variant=b   no spotlight, content centred
//   /design/month-story?variant=c   tight spotlight hugging the subject, content centred
// Defaults to "a" when the param is missing or unrecognised, following the
// same "?state=" pattern the other /design/* routes use (see
// spend-verdict-a/SpendVerdictAClient.tsx's STATES/hrefFor convention).

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import StoryPlayer from "@/app/month/story/StoryPlayer";
import { MONTH_STORY_FIXTURE } from "./fixtures";

const VARIANTS = ["a", "b", "c"] as const;
type Variant = (typeof VARIANTS)[number];

const VARIANT_LABEL: Record<Variant, string> = {
  a: "A · anchored",
  b: "B · no glow",
  c: "C · tight",
};

const VARIANT_PROPS: Record<Variant, { spotlight: "anchored" | "none" | "tight"; align: "default" | "center" }> = {
  a: { spotlight: "anchored", align: "default" },
  b: { spotlight: "none", align: "center" },
  c: { spotlight: "tight", align: "center" },
};

// Small floating pill row so the owner can flick between variants on his
// phone without retyping the URL. Sits above StoryPlayer's own z-50 overlay
// and its own tap zones (z-10/z-20/z-30), so it needs the highest z-index
// in the stack; each link is a real 44px target per the house rule.
function VariantSwitch({ active }: { active: Variant }) {
  return (
    <div
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 14px)" }}
    >
      <div className="pointer-events-auto flex gap-1 rounded-full border border-white/15 bg-slate-900/90 p-1 shadow-xl">
        {VARIANTS.map((v) => (
          <Link
            key={v}
            href={`?variant=${v}`}
            scroll={false}
            className={`flex min-h-[44px] items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors active:scale-95 ${
              v === active ? "bg-indigo-600 text-white" : "text-slate-400"
            }`}
          >
            {VARIANT_LABEL[v]}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Inner() {
  const params = useSearchParams();
  const raw = params.get("variant");
  const variant: Variant = (VARIANTS as readonly string[]).includes(raw ?? "") ? (raw as Variant) : "a";
  const { spotlight, align } = VARIANT_PROPS[variant];

  return (
    <>
      <StoryPlayer fixtureStory={MONTH_STORY_FIXTURE} spotlight={spotlight} align={align} />
      <VariantSwitch active={variant} />
    </>
  );
}

export default function MonthStoryClient() {
  return (
    <div style={{ colorScheme: "dark" }}>
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    </div>
  );
}
