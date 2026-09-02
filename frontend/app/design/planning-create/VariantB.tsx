"use client";

// Variant B — "One door, progressive: derive the shape, never name it."
// Same single "+ Set money aside" door as Variant A, but the sheet never
// shows the user a taxonomy. It asks the minimal universal questions first
// (what's it for, how much), then ONE follow-up ("By when?") whose answer
// silently picks the shape (and, now, the rhythm) behind the scenes.
//
// Owner correction, 2026-08-29 (verbatim: "an allocation isn't necessarily
// every month, it can be just once"): the "by when?" question gains a
// fourth answer for a once-envelope. Because B never shows the word
// "envelope" or "allocation" in the first place, the fourth answer costs
// nothing extra to fit in, it is worded to sit clearly apart from the
// existing "single payment on a date" answer (see the mapping table below)
// rather than reusing the word "once" next to "one-off".

import { useState } from "react";
import {
  PageShell,
  SectionLabel,
  GoalCardMock,
  AllocationCardMock,
  OneOffRowMock,
  InlineSheet,
  FieldLabel,
  TextField,
  AccountRow,
  CheckDot,
  SeriesRow,
  PrimaryButton,
  Annotation,
} from "./shared";
import { accounts, goal, allocation, allocationOnce, oneOff, fillCandidates, fillCandidatesOnce, accountById } from "./fixtures";

type Answer = "date" | "period" | "just-once" | "single";

const ANSWERS: { id: Answer; label: string }[] = [
  { id: "date", label: "By a target date, saving up to it" },
  { id: "period", label: "Every pay period, ongoing" },
  { id: "just-once", label: "Just this one pay period, then done" },
  { id: "single", label: "It's a single payment leaving on a date" },
];

export default function VariantB() {
  const [answer, setAnswer] = useState<Answer>("date");
  const savingsAccount = accountById("acc-18")!;
  const currentAccount = accountById("acc-1")!;

  return (
    <PageShell>
      {/* ── Entry treatment — same single door as Variant A ─────────────── */}
      <div>
        <SectionLabel>Your plans</SectionLabel>
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              + Set money aside
            </div>
          </div>
          <GoalCardMock c={goal} />
          <AllocationCardMock a={allocation} accounts={accounts} recurrence="every_period" />
          <AllocationCardMock a={allocationOnce} accounts={accounts} recurrence="once" />
          <OneOffRowMock name={oneOff.name} amount={oneOff.amount} dateLabel={oneOff.dateLabel} account={accountById(oneOff.accountId)} />
        </div>
      </div>

      {/* ── Create flow — three steps, stacked here for review. Step 3
          changes live with the "By when?" answer picked in step 2. ──────── */}
      <div className="space-y-3">
        <SectionLabel sub="Tap an answer in step 2 to see step 3 update. The word envelope, allocation, goal or one-off never appears anywhere in this sheet.">
          Create flow
        </SectionLabel>

        <InlineSheet title="Set money aside" subtitle="Step 1 of 3, what it is and how much">
          <div>
            <FieldLabel>What's it for?</FieldLabel>
            <TextField value="House deposit" />
          </div>
          <div>
            <FieldLabel>How much, in total or each time?</FieldLabel>
            <TextField value="£150" />
          </div>
        </InlineSheet>

        <InlineSheet title="Set money aside" subtitle="Step 2 of 3, by when?" onBack={() => {}}>
          <div className="space-y-2">
            {ANSWERS.map((a) => {
              const active = answer === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setAnswer(a.id)}
                  className={`w-full min-h-[44px] flex items-center px-3.5 py-3 rounded-2xl border text-left transition-colors active:scale-[0.98] ${
                    active
                      ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-500/60 text-slate-900 dark:text-slate-100"
                      : "border-slate-200/70 dark:border-white/[0.08] bg-slate-50/60 dark:bg-white/[0.03] text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <span className="text-sm font-medium">{a.label}</span>
                </button>
              );
            })}
          </div>
        </InlineSheet>

        {answer === "date" && (
          <InlineSheet title="Set money aside" subtitle="Step 3 of 3, the details" onBack={() => {}}>
            <div>
              <FieldLabel>Target month</FieldLabel>
              <TextField value="" placeholder="Jan 2027" />
            </div>
            <div>
              <FieldLabel>Which pot?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                <div className="w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5">
                  <CheckDot selected />
                  <span className="flex-1 text-sm font-medium text-slate-900 dark:text-slate-100">{savingsAccount.name}</span>
                </div>
              </div>
            </div>
            <PrimaryButton>Save</PrimaryButton>
          </InlineSheet>
        )}

        {answer === "period" && (
          <InlineSheet title="Set money aside" subtitle="Step 3 of 3, the details" onBack={() => {}}>
            <div>
              <FieldLabel>Which account?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                <AccountRow account={savingsAccount} selected />
              </div>
            </div>
            <div>
              <FieldLabel>Which payment fills it?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                {fillCandidates.map((c, i) => (
                  <SeriesRow key={c.series_key} displayName={c.display_name} lastAmount={c.last_amount} occurrences={c.occurrences_90d} selected={i === 0} />
                ))}
              </div>
            </div>
            <PrimaryButton>Save</PrimaryButton>
          </InlineSheet>
        )}

        {answer === "just-once" && (
          <InlineSheet title="Set money aside" subtitle="Step 3 of 3, the details" onBack={() => {}}>
            <div>
              <FieldLabel>Which account?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                <AccountRow account={currentAccount} selected />
              </div>
            </div>
            <div>
              <FieldLabel>Which payment fills it?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                {fillCandidatesOnce.map((c) => (
                  <SeriesRow key={c.series_key} displayName={c.display_name} lastAmount={c.last_amount} occurrences={c.occurrences_90d} selected />
                ))}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                No ongoing commitment, this covers this pay period only.
              </p>
            </div>
            <PrimaryButton>Save, this period only</PrimaryButton>
          </InlineSheet>
        )}

        {answer === "single" && (
          <InlineSheet title="Set money aside" subtitle="Step 3 of 3, the details" onBack={() => {}}>
            <div>
              <FieldLabel>Date</FieldLabel>
              <TextField value="" placeholder="4 Sep 2026" />
            </div>
            <div>
              <FieldLabel>Which account will it leave from?</FieldLabel>
              <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.08] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
                <AccountRow account={currentAccount} selected />
              </div>
            </div>
            <PrimaryButton>Save</PrimaryButton>
          </InlineSheet>
        )}
      </div>

      <Annotation
        variant="B"
        position={`One door, no taxonomy: the sheet asks "what's it for" and "how much" up front, then a single plain-English follow-up, "by when?" The words goal, envelope and one-off never surface; the shape AND recurrence are both inferred from the answer.`}
        shapes={[
          { label: "Big expense", flow: "3 screens (what/how much, by when, then target month + pot)" },
          { label: "Envelope, every period", flow: "3 screens (what/how much, by when, then account + which-payment)" },
          { label: "Envelope, just once", flow: "3 screens, same shape as the row above, a different by-when answer" },
          { label: "One-off", flow: "3 screens (what/how much, by when, then date + account)" },
        ]}
        mapping={[
          { answer: "By a target date, saving up to it", resolvesTo: "a goal (target month + funding pots)" },
          { answer: "Every pay period, ongoing", resolvesTo: "an envelope, recurrence: every_period" },
          { answer: "Just this one pay period, then done", resolvesTo: "an envelope, recurrence: once" },
          { answer: "It's a single payment leaving on a date", resolvesTo: "a one-off (a dated bill, not an envelope)" },
        ]}
        principle={`Design-taste brief inference: read the user's actual question, "I want to set money aside for something", rather than the engineering shape underneath it. The taxonomy (goal / envelope / one-off) and now the recurrence (every_period / once) both stay out of the UI entirely, at the cost of one extra screen versus Variant A on every path. Because the answer wording is chosen by us rather than borrowed from the data model, the once-envelope answer ("just this one pay period, then done") can be worded to share no vocabulary at all with the one-off answer ("a single payment leaving on a date"), which is the naming-collision risk this correction introduces and Variant B is structurally immune to.`}
        doors='"+ Plan a big expense", "+ Allocation" and "+ Plan a one-off" are all removed from Planning, same single "+ Set money aside" door as Variant A. Resulting cards are unchanged, except the envelope card now also carries an "Every pay period" or "This period only" tag.'
      />
    </PageShell>
  );
}
