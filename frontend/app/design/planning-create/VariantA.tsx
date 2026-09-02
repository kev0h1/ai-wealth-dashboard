"use client";

// Variant A — "One door, one sheet, kind chosen inside."
// A single "+ Set money aside" door replaces all three existing affordances
// ("+ Plan a big expense", "+ Allocation", "+ Plan a one-off"). Its sheet
// opens on a first step of three clear shape cards, then swaps to the
// fields for whichever shape was tapped. The taxonomy is shown, but shown
// ONCE, up front, as three named cards rather than three scattered buttons.
//
// Owner correction, 2026-08-29 (verbatim: "an allocation isn't necessarily
// every month, it can be just once"): the envelope shape's card is reworded
// from "Every period" to "An envelope" so it no longer claims a rhythm it
// doesn't always have, and its step-2 fields gain a rhythm toggle (every
// pay period / just this period) rather than adding a fourth top-level
// card. Judgement call: nesting the rhythm inside the envelope door, rather
// than surfacing "just this period" as its own sibling card next to "one
// payment", keeps the top-level choice to a stable, unambiguous three
// ("saving toward a date", "an envelope", "a single payment leaving") and
// avoids the one-off/once naming collision that a flat fourth card would
// invite — see the annotation's Skill principle for the fuller reasoning.

import { useState } from "react";
import { Target, Wallet, Receipt } from "lucide-react";
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
  RhythmToggle,
  PrimaryButton,
  Annotation,
} from "./shared";
import { accounts, goal, allocation, allocationOnce, oneOff, fillCandidates, accountById } from "./fixtures";

type Kind = "date" | "envelope" | "single";
type Rhythm = "every_period" | "once";

const KINDS: { id: Kind; title: string; sub: string; icon: typeof Target }[] = [
  { id: "date", title: "By a date", sub: "Save toward a target, a bit each pay period", icon: Target },
  { id: "envelope", title: "An envelope", sub: "Set aside an amount, every pay period or just this one", icon: Wallet },
  { id: "single", title: "One payment", sub: "A single payment you know is coming", icon: Receipt },
];

export default function VariantA() {
  const [kind, setKind] = useState<Kind>("date");
  const [rhythm, setRhythm] = useState<Rhythm>("every_period");
  const savingsAccount = accountById("acc-18")!;
  const currentAccount = accountById("acc-1")!;

  return (
    <PageShell>
      {/* ── Entry treatment — Planning's mid-section, one door ──────────── */}
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

      {/* ── Create flow — two steps, stacked here for review; in the live
          sheet, step 2 replaces step 1 in place once a card is tapped. ── */}
      <div className="space-y-3">
        <SectionLabel sub="Tap a shape card below to see step 2 update, both steps live in the same sheet. Inside the envelope shape, the rhythm toggle is a field, not a new screen.">
          Create flow
        </SectionLabel>

        <InlineSheet title="Set money aside" subtitle="Step 1 of 2, what shape is this?">
          <div className="space-y-2">
            {KINDS.map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-3 rounded-2xl border text-left transition-colors active:scale-[0.98] ${
                    active
                      ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-500/60"
                      : "border-slate-200/70 dark:border-white/[0.08] bg-slate-50/60 dark:bg-white/[0.03]"
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      active ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{k.title}</span>
                    <span className="block text-[12px] text-slate-500 dark:text-slate-400 leading-snug">{k.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </InlineSheet>

        {kind === "date" && (
          <InlineSheet title="By a date" subtitle="Step 2 of 2, a goal to save toward" onBack={() => {}}>
            <div>
              <FieldLabel>Name</FieldLabel>
              <TextField value="" placeholder="House deposit" />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <TextField value="" placeholder="0.00" prefix="£" />
            </div>
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
            <PrimaryButton>Save goal</PrimaryButton>
          </InlineSheet>
        )}

        {kind === "envelope" && (
          <InlineSheet title="An envelope" subtitle="Step 2 of 2, set money aside" onBack={() => {}}>
            <div>
              <FieldLabel>Name</FieldLabel>
              <TextField value="" placeholder="House deposit top-up" />
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <TextField value="" placeholder="0.00" prefix="£" />
            </div>
            <div>
              <FieldLabel>How often?</FieldLabel>
              <RhythmToggle value={rhythm} onChange={setRhythm} />
            </div>
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
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Only this payment counts toward the envelope, not everything landing in the account.
              </p>
            </div>
            <PrimaryButton>{rhythm === "once" ? "Save, this period only" : "Save envelope"}</PrimaryButton>
          </InlineSheet>
        )}

        {kind === "single" && (
          <InlineSheet title="One payment" subtitle="Step 2 of 2, a payment you know is coming" onBack={() => {}}>
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
        )}
      </div>

      <Annotation
        variant="A"
        position='One door, one sheet: "+ Set money aside" replaces all three add buttons. The taxonomy is not hidden, it is shown once, as three legible cards, then never asked again. The envelope card no longer claims a rhythm it does not always have: its title reads "An envelope", not "Every period", and the rhythm (every pay period, or just this one) is a field inside it.'
        shapes={[
          { label: "Big expense", flow: "2 screens (pick shape, then goal fields)" },
          { label: "Envelope, every period", flow: "2 screens (pick shape, then envelope fields with the rhythm toggle left on its default, plus the account then which-payment picker)" },
          { label: "Envelope, just once", flow: "2 screens, identical to the row above, the only difference is one tap on the rhythm toggle. Recurrence never costs a screen." },
          { label: "One-off", flow: "2 screens (pick shape, then payment fields)" },
        ]}
        principle='Impeccable: "one thought, one door." Three creation flows that all answer "set money aside for something" collapse into one entry point, with the real difference (shape) surfaced as a single, honest choice rather than three separate mental models scattered down the page. Now that an envelope can be "just once", it would be tempting to add a fourth top-level card for it, but that puts "just this period" and "one payment" side by side as two competing doors before the user has typed anything, exactly the ambiguity this correction introduces. Nesting the rhythm inside the envelope card avoids that: the top-level choice stays about WHAT the money is doing (reserved for a date, reserved on a rhythm, or leaving as a payment), never about the word "once" competing with the word "one-off".'
        doors='"+ Plan a big expense", "+ Allocation" and "+ Plan a one-off" are all removed from Planning. One "+ Set money aside" link sits above the goal/envelope cards; the resulting cards (goal, envelope, one-off row) are unchanged in shape or position, and each envelope card now carries a small "Every pay period" or "This period only" tag so the two rhythms read as clearly distinct at rest, not just inside the sheet.'
      />
    </PageShell>
  );
}
