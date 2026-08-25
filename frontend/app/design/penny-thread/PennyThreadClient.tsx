"use client";

// TEMPORARY PREVIEW — delete after design review.
//
// Three variants answering one tester complaint about Penny's conversation
// thread (components/PennyConversation.tsx): "The contrast of the layout
// for the questions vs the answers feels a bit weird to me. Maybe it's
// because it's different from the chat/messenger type of UX."
//
// Diagnosis (two design reviews): the asymmetry itself is right — the
// verdict must lead, symmetric bubbles would demote the answer — but it's
// under-executed. At 13px/slate-500 with no container the user's own words
// read as a timestamp, not speech, and a uniform space-y-3 means nothing
// visually pairs a question with its own answer once a session has several
// turns. None of the three variants below reintroduce chat bubbles. Each
// changes exactly three things versus production: user-line presence,
// question-to-answer pairing rhythm, and the loading affordance.
//
// NONE of the three use the three-bouncing-dots animation production still
// has (see PennyConversation.tsx's BouncingDots). That's the iMessage/
// WhatsApp typing indicator, the single strongest chat signifier there is —
// removing it is deliberate, not an oversight.
//
// Deep-linkable: /design/penny-thread?mode=light|dark&v=a|b|c
// Omitting `v` renders all three, stacked, for a side-by-side compare.
//
// Read-only references (not edited): components/PennyConversation.tsx (the
// production anatomy this replaces), components/MoneyText.tsx (Money Is
// Mono rule), components/ChatMarkdown.tsx (tax answer body), lib/brand.ts
// (BRAND_GRADIENT, Penny-identity mark only).
//
// Reduced motion: every animate-pulse shimmer/skeleton below is a CSS
// `animation`, already collapsed to ~0ms by the blanket
// `@media (prefers-reduced-motion: reduce)` rule in app/globals.css
// (search "Accessibility: honour reduced-motion") — nothing extra needed
// here.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import PennyMark from "@/components/PennyMark";
import MoneyText from "@/components/MoneyText";
import ChatMarkdown from "@/components/ChatMarkdown";
import { BRAND_GRADIENT } from "@/lib/brand";
import { THREAD, PENDING_QUESTION, PREVIEW_NOTE, type Exchange } from "./fixtures";

type Mode = "light" | "dark";
type VariantKey = "a" | "b" | "c";

const VARIANT_META: { key: VariantKey; title: string; description: string }[] = [
  {
    key: "a",
    title: "A: Quiet label",
    description:
      "Conservative fix: the user line grows to 14px slate-600 and stays right-aligned with no container. Pairing comes from rhythm alone, tight gap to its own answer, wide gap before the next question.",
  },
  {
    key: "b",
    title: "B: Anchored question",
    description:
      "The question moves left-aligned and hugs its card under a quiet YOU ASKED eyebrow, so question and answer read as one titled block.",
  },
  {
    key: "c",
    title: "C: Inset question",
    description:
      "The most anti-chat option: no orphan question line at all, the question sits as an inset caption inside the top of the answer card itself, above a hairline divider.",
  },
];

function isVariantKey(v: string | null): v is VariantKey {
  return v === "a" || v === "b" || v === "c";
}

/** Penny gradient mark — brand identity only, never elsewhere on the page. */
function PennyTile({ size = 28, iconSize = 13 }: { size?: number; iconSize?: number }) {
  return (
    <span
      className="rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: BRAND_GRADIENT, width: size, height: size }}
    >
      <PennyMark size={iconSize} className="text-white" />
    </span>
  );
}

/** Indigo offer pill, identical anatomy to production's VerdictCard offer chip. */
function OfferChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="mt-3 min-h-[44px] inline-flex items-center text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 rounded-full px-4 py-2 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <MoneyText text={label} />
    </button>
  );
}

/** The answer content itself — identical across all three variants. Only
 * the card shell, question presentation, and loading affordance around
 * this differ per variant. */
function AnswerBody({ exchange }: { exchange: Exchange }) {
  if (exchange.kind === "tax") {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">
          Tax
        </p>
        <div className="text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
          <ChatMarkdown>{exchange.body}</ChatMarkdown>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[16px] font-bold leading-snug text-slate-900 dark:text-slate-100">
        <MoneyText text={exchange.headline} />
      </p>
      <div className="mt-2 space-y-1">
        {exchange.facts.map((f, i) => (
          <p key={i} className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
            <MoneyText text={f} />
          </p>
        ))}
      </div>
      {exchange.offer && <OfferChip label={exchange.offer} />}
    </div>
  );
}

const CARD_CLASS = "glass-card rounded-2xl p-4 w-full";

// ── Variant A — Quiet label ────────────────────────────────────────────────

function UserLineA({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] text-[14px] text-slate-600 dark:text-slate-300 text-right leading-snug">
        <MoneyText text={text} />
      </p>
    </div>
  );
}

function VariantAThread() {
  return (
    <div aria-live="polite" role="log">
      {THREAD.map((ex, i) => (
        <div key={i} className={i === 0 ? "" : "mt-6"}>
          <UserLineA text={ex.question} />
          <div className={`${CARD_CLASS} mt-1.5`}>
            <AnswerBody exchange={ex} />
          </div>
        </div>
      ))}
      {/* In-flight turn — demonstrates variant A's loading affordance: a
          slim shimmer bar inside the same glass-card shell the answer will
          occupy, so nothing jumps in size once it lands. */}
      <div className="mt-6">
        <UserLineA text={PENDING_QUESTION} />
        <div className={`${CARD_CLASS} mt-1.5`}>
          <span className="sr-only">Checking your numbers</span>
          <div aria-hidden className="h-4 w-2/3 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// ── Variant B — Anchored question ──────────────────────────────────────────

function AnchoredQuestion({ text }: { text: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        You asked
      </p>
      <p className="mt-0.5 text-[14px] text-slate-600 dark:text-slate-300 leading-snug">
        <MoneyText text={text} />
      </p>
    </div>
  );
}

function VariantBThread() {
  return (
    <div aria-live="polite" role="log">
      {THREAD.map((ex, i) => (
        <div key={i} className={i === 0 ? "" : "mt-6"}>
          <AnchoredQuestion text={ex.question} />
          <div className={`${CARD_CLASS} mt-1`}>
            <AnswerBody exchange={ex} />
          </div>
        </div>
      ))}
      {/* In-flight turn — demonstrates variant B's loading affordance: a
          single slow pulsing dot beside "Checking your numbers", inside the
          same anchored block as an answered turn. */}
      <div className="mt-6">
        <AnchoredQuestion text={PENDING_QUESTION} />
        <div className={`${CARD_CLASS} mt-1 flex items-center gap-2`}>
          <span aria-hidden className="w-2 h-2 rounded-full bg-indigo-400 dark:bg-indigo-500 animate-pulse flex-shrink-0" />
          <span className="text-[13px] text-slate-500 dark:text-slate-400">Checking your numbers</span>
        </div>
      </div>
    </div>
  );
}

// ── Variant C — Inset question ─────────────────────────────────────────────

function VariantCCard({ ex }: { ex: Exchange }) {
  return (
    <div className={CARD_CLASS}>
      <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
        <MoneyText text={ex.question} />
      </p>
      <div className="mt-2 border-t border-slate-200/70 dark:border-slate-700" />
      <div className="mt-3">
        <AnswerBody exchange={ex} />
      </div>
    </div>
  );
}

function VariantCThread() {
  return (
    <div aria-live="polite" role="log" className="space-y-3">
      {THREAD.map((ex, i) => (
        <VariantCCard key={i} ex={ex} />
      ))}
      {/* In-flight turn — demonstrates variant C's loading affordance: the
          card renders immediately with the question already inset, and a
          shimmering skeleton stands in for the headline and facts. */}
      <div className={CARD_CLASS}>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
          <MoneyText text={PENDING_QUESTION} />
        </p>
        <div className="mt-2 border-t border-slate-200/70 dark:border-slate-700" />
        <div className="mt-3 space-y-2">
          <span className="sr-only">Checking your numbers</span>
          <div aria-hidden className="h-4 w-1/2 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
          <div aria-hidden className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div aria-hidden className="h-3 w-2/3 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

const VARIANT_THREAD: Record<VariantKey, () => React.JSX.Element> = {
  a: VariantAThread,
  b: VariantBThread,
  c: VariantCThread,
};

// ── Page shell ──────────────────────────────────────────────────────────

/** min-h-44px pill link — matches the design index's own link styling. */
function PillLink({ href, children, tone = "quiet" }: { href: string; children: React.ReactNode; tone?: "quiet" | "brand" }) {
  const cls =
    tone === "brand"
      ? "inline-flex items-center min-h-[44px] rounded-full px-3.5 py-2 text-[11px] font-semibold text-indigo-600 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-500/15 active:scale-95 transition-transform"
      : "inline-flex items-center min-h-[44px] text-[11px] font-medium text-slate-400 dark:text-slate-500 underline underline-offset-2";
  return (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

export default function PennyThreadClient() {
  const searchParams = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "dark" ? "dark" : "light";
  const vParam = searchParams.get("v");
  const activeVariant = isVariantKey(vParam) ? vParam : null;

  // Theme toggle — same pattern as sibling /design/* routes.
  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  const otherMode: Mode = mode === "dark" ? "light" : "dark";
  const baseHref = (m: Mode, v: VariantKey | null) => `/design/penny-thread?mode=${m}${v ? `&v=${v}` : ""}`;

  const variantsToShow = activeVariant ? VARIANT_META.filter((v) => v.key === activeVariant) : VARIANT_META;

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
        <div className="mx-auto w-full max-w-[430px] px-4 py-8">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{PREVIEW_NOTE}</p>

          <div className="mt-3 flex items-center gap-2.5">
            <PennyTile />
            <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Penny thread: A/B/C</h1>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
            Tester feedback: the question-vs-answer contrast reads oddly, like a chat UX gone wrong. We're keeping the
            asymmetry (the verdict must lead), just executing it better. All three variants render the exact same
            four-exchange thread below, plus a fifth in-flight turn so each variant's own loading affordance is visible
            without needing to tap anything.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
            None of the three use a three-dot typing indicator. That's the strongest chat/messenger signifier there is,
            and removing it is deliberate.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <PillLink href={baseHref(otherMode, activeVariant)} tone="brand">
              {otherMode === "dark" ? "Dark" : "Light"}
            </PillLink>
            {activeVariant && (
              <PillLink href={baseHref(mode, null)} tone="quiet">
                ‹ All three variants
              </PillLink>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-10">
            {variantsToShow.map((v) => {
              const Thread = VARIANT_THREAD[v.key];
              return (
                <section key={v.key}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{v.title}</h2>
                      <p className="mt-1 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {v.description}
                      </p>
                    </div>
                    {!activeVariant && (
                      <PillLink href={baseHref(mode, v.key)} tone="quiet">
                        Open ›
                      </PillLink>
                    )}
                  </div>
                  <div className="mt-4">
                    <Thread />
                  </div>
                </section>
              );
            })}
          </div>

          <p className="mt-10 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 text-center">
            This route is deleted after review.
          </p>
        </div>
      </div>
    </div>
  );
}
