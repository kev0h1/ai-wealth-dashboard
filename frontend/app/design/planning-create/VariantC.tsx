"use client";

// Variant C — "Two doors, not three." The taste-skill brief inference and
// impeccable's "one thought, one door" both point the same way for the
// goal/envelope pair (same underlying thought, "am I setting money aside"),
// so they share one door with an inline shape toggle. A one-off stays its
// own fast door, on the argument that it's a categorically different
// thought: a known transaction you're recording, not a reservation of
// money against the future.
//
// Owner correction, 2026-08-29 (verbatim: "an allocation isn't necessarily
// every month, it can be just once"): the toggle gains a third position,
// "Just once", so the envelope's two rhythms (every_period / once) are both
// first-class, one tap apart, inside the same one-screen sheet. This is
// also the correction that most tests this variant's central bet, see the
// annotation's re-argued "one-off door" entry below: my honest read is
// that it weakens the two-door case rather than strengthening it.

import { useState } from "react";
import { Target, Repeat, CircleDot } from "lucide-react";
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

type Shape = "date" | "period" | "once";

const SHAPES: { id: Shape; label: string; icon: typeof Target }[] = [
  { id: "date", label: "By a date", icon: Target },
  { id: "period", label: "Every period", icon: Repeat },
  { id: "once", label: "Just once", icon: CircleDot },
];

export default function VariantC() {
  const [shape, setShape] = useState<Shape>("date");
  const savingsAccount = accountById("acc-18")!;
  const currentAccount = accountById("acc-1")!;

  return (
    <PageShell>
      {/* ── Entry treatment — two doors ──────────────────────────────────── */}
      <div>
        <SectionLabel>Your plans</SectionLabel>
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              + Save toward something
            </div>
          </div>
          <GoalCardMock c={goal} />
          <AllocationCardMock a={allocation} accounts={accounts} recurrence="every_period" />
          <AllocationCardMock a={allocationOnce} accounts={accounts} recurrence="once" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex justify-end">
            <div className="min-h-[44px] flex items-center px-2 -my-2.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              + Plan a one-off
            </div>
          </div>
          <OneOffRowMock name={oneOff.name} amount={oneOff.amount} dateLabel={oneOff.dateLabel} account={accountById(oneOff.accountId)} />
        </div>
      </div>

      {/* ── Create flow — two doors, two independent flows. "Save toward
          something" never leaves its one screen: the toggle below swaps
          the fields under it in place, live. ───────────────────────────── */}
      <div className="space-y-3">
        <SectionLabel sub="Tap the toggle inside the first sheet to see the fields swap in place. Nothing here ever pushes a second screen, including the new 'Just once' rhythm.">
          Create flow
        </SectionLabel>

        <InlineSheet title="Save toward something" subtitle="One screen, start to finish">
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextField value="" placeholder="House deposit" />
          </div>
          <div>
            <FieldLabel>Amount</FieldLabel>
            <TextField value="" placeholder="0.00" prefix="£" />
          </div>

          <div>
            <FieldLabel>Shape</FieldLabel>
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-700/60 p-1">
              {SHAPES.map((s) => {
                const Icon = s.icon;
                const active = shape === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setShape(s.id)}
                    className={`flex-1 min-h-[40px] flex items-center justify-center gap-1 rounded-lg text-[12px] font-semibold transition-colors px-1 ${
                      active ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <Icon size={13} /> {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {shape === "date" && (
            <>
              <div>
                <FieldLabel>By when?</FieldLabel>
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
            </>
          )}

          {shape === "period" && (
            <>
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
            </>
          )}

          {shape === "once" && (
            <>
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
            </>
          )}

          <PrimaryButton>{shape === "once" ? "Save, this period only" : "Save"}</PrimaryButton>
        </InlineSheet>

        <InlineSheet title="Plan a one-off" subtitle="A payment you know is coming, unchanged">
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextField value="" placeholder="Car service" />
          </div>
          <div>
            <FieldLabel>Amount</FieldLabel>
            <TextField value="" placeholder="0.00" prefix="£" />
          </div>
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
          <PrimaryButton>Plan it</PrimaryButton>
        </InlineSheet>
      </div>

      <Annotation
        variant="C"
        position="Two doors, not three. A goal and an envelope are the same thought wearing a different rhythm, so they share one door and one screen with a three-way inline shape toggle (by a date, every period, just once). A one-off keeps its own fast, unchanged door."
        shapes={[
          { label: "Big expense", flow: "1 screen (fields plus the toggle set to \"By a date\")" },
          { label: "Envelope, every period", flow: "1 screen (fields plus the toggle set to \"Every period\", incl. account then which-payment)" },
          { label: "Envelope, just once", flow: "1 screen (fields plus the toggle set to \"Just once\", same fields as the row above, one tap away)" },
          { label: "One-off", flow: "1 screen, unchanged from today" },
        ]}
        principle="Design-taste brief inference plus impeccable's bias against unnecessary steps: don't force a wizard where an inline toggle does the same job in place, and don't force two genuinely different thoughts through one funnel just to hit a round number of doors."
        doorsLabel="The two doors."
        doors={'"+ Plan a big expense" and "+ Allocation" merge into one "+ Save toward something" door, now covering three rhythms instead of two. "+ Plan a one-off" is untouched: same label, same single-step sheet, same position in the flow. Resulting cards are unchanged; each envelope card carries an "Every pay period" or "This period only" tag.'}
        extra={[
          {
            label: "Does the one-off door still stand",
            text: 'Re-argued honestly, now that "just once" exists inside the envelope. The distinction is real and still holds: a one-off is a dated PAYMENT that leaves an account on a day you name, it sits in the upcoming list as a scheduled outgoing. A once-envelope is a RESERVATION, filled passively by whatever incoming payment you pick, with no date of its own, it never appears in the upcoming list. But the two now share a door-selection risk they did not share before: standing at the entry surface, "Save toward something" and "Plan a one-off" read as near-synonyms for a moment, because both can now mean "just this one time". Two flat doors force the user to resolve that ambiguity themselves before either sheet can help; Variants A and B both defer the same choice until after a clarifying question or field, which is structurally safer. My honest read is this correction weakens Variant C\'s case rather than strengthening it, worth weighing against its real advantage: the shortest flow of the three, one screen for every shape including the two rhythms.',
          },
        ]}
      />
    </PageShell>
  );
}
