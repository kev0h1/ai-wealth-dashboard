import type { ActiveAim, CompletedAim, MirrorTrait } from "@/lib/api";
import { aimPace } from "@/lib/aimPace";

export const SCENARIOS = ["all", "active", "completed", "kept", "loading", "error", "save-error", "hidden", "long", "single", "hygiene-clear", "empty", "insufficient"] as const;
export type Scenario = typeof SCENARIOS[number];
export const EXPLANATION = "Each trait has its own choice. Coaching stays off until you choose change. Kept traits receive no coaching.";
export const COMPUTED_AT = "2026-10-20T09:00:00Z";

// Synthetic portrait observations, not a customer snapshot or API rewrite.
// The stable IDs, kinds and category are the production contract. UI titles
// can be plain English without altering the legacy API title/category parser.
const TRAITS: MirrorTrait[] = [
  { id: "saving_habit", kind: "habit", choice: null, title: "Regular saving", narrative: "You put money into savings often.", evidence: ["277 deposits over 179 days", "£1,358 put into savings across this window"] },
  { id: "orchestrator", kind: "structure", choice: null, title: "Moving money between accounts", narrative: "You move money between 15 accounts regularly.", evidence: ["15 accounts actively used for transfers", "About £15,790 in transfers a month"] },
  { id: "signature_pleasure", kind: "pleasure", ref_category: "Eating Out", choice: null, title: "Eating out is a regular spend", narrative: "Eating Out is your most frequent category for optional spending.", evidence: ["154 payments over 179 days · about 26 times a month", "£2,731 in Eating Out across this window"] },
  { id: "hygiene", kind: "hygiene", choice: null, title: "Returned payments or late fees", narrative: "Some bank descriptions mention returned payments or late fees. A matching description alone does not prove a missed payment.", evidence: [observationCount(4, "returned payment or late fee", "returned payments or late fees")] },
  { id: "front_loader", kind: "structure", choice: null, title: "More spending in the first week", narrative: "A larger share of your spending falls in the first week of the month.", evidence: ["48% of monthly spending in days 1 to 7", "£980 average early-month spend"] },
  { id: "credit_switch", kind: "structure", choice: null, title: "More card spending after week one", narrative: "A larger share of your spending goes on credit cards after the first week.", evidence: ["Credit card share: 22% in week one, 49% after week one"] },
];

export function fixtureTraits(scenario: Scenario): MirrorTrait[] {
  if (scenario === "empty" || scenario === "insufficient") return [];
  const traits = structuredClone(TRAITS);
  if (scenario === "hygiene-clear") return [{ id: "hygiene", kind: "hygiene", choice: null, title: "No matching payment issues found", narrative: "No returned-payment, late-fee, buy-now-pay-later or gambling descriptions were found in this window. That does not confirm every payment was made.", evidence: ["179 days of recorded transactions checked"] }];
  if (["active", "completed", "loading", "error"].includes(scenario)) traits.find(trait => trait.id === "signature_pleasure")!.choice = "change";
  if (scenario === "kept") traits.forEach(trait => { trait.choice = "keep"; });
  if (scenario === "long") {
    traits[1].title = "Moving money between several everyday and household accounts";
    traits[1].narrative = "You make regular transfers between your everyday, household and savings accounts. These transfers move money between accounts, rather than showing how much you have spent.";
  }
  return scenario === "single" ? traits.filter(trait => trait.id === "signature_pleasure") : traits;
}

export const ACTIVE: ActiveAim = {
  id: "g302-current", ref: "Eating Out", aim_amount: 100.25, spent_so_far: 82.12,
  days_left: 10, on_track: false, period_start: "2026-10-03", period_end: "2026-10-30",
  pace: { state: "likely", phrase: "likely to pass your aim", period_days: 28, elapsed_fraction: 18 / 28, pace_today: 64.45, projected: 127.74, spent_fraction: 82.12 / 100.25 },
};
export const COMPLETED: CompletedAim = { id: "g302-closed", ref: "Eating Out", aim_amount: 100, result_amount: 82, period_start: "2026-09-05", period_end: "2026-10-02", status: "met", resolved_at: "2026-10-03T10:00:00Z" };

/** Local fixture edits use the existing pace fallback, never an API write. */
export function fixtureAim(amount: number): ActiveAim {
  const value = { ...ACTIVE, aim_amount: amount, pace: undefined };
  const pace = aimPace(value, 28);
  return { ...value, on_track: pace.state === "on" || pace.state === "under", pace: {
    state: pace.state, phrase: pace.phrase, period_days: 28,
    elapsed_fraction: pace.elapsedFraction, pace_today: Math.round(pace.paceToday * 100) / 100,
    projected: Math.round(value.spent_so_far / pace.elapsedFraction * 100) / 100,
    spent_fraction: pace.spentFraction,
  } };
}

export function observationCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
