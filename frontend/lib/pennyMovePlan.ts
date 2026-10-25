// G334: the move-plan card block in Penny's replies. Pure functions, no React.
//
// Built and validated on the server (backend/app/services/penny_move_plan.py):
// 1..8 legs, finite non-negative amounts, plain-text names. The client still
// treats it as untrusted: a malformed block renders nothing, and every string
// is drawn as React text, never as markup. The card describes a route the
// user could take; the app never moves money.

export type PennyMovePlanLeg = {
  name: string;
  bank: string | null;
  provider: string;
  amount: number;
  keeps: number;
};

export type PennyMovePlanSkipReason =
  | "nothing_spare"
  | "set_aside_pot"
  | "savings"
  | "credit_card"
  | "excluded"
  | "no_data"
  | "is_target";

export type PennyMovePlan = {
  kind: "move_plan";
  target: { name: string; bank: string | null; provider: string };
  legs: PennyMovePlanLeg[];
  total: number;
  pool: number | null;
  requested: number | null;
  shortfall: number;
  summary: string;
  skipped: { name: string; reason: PennyMovePlanSkipReason }[];
};

export const MOVE_PLAN_MAX_LEGS = 8;
const REASONS = new Set(["nothing_spare", "set_aside_pot", "savings", "credit_card", "excluded", "no_data", "is_target"]);

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null;
}

function optStr(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  return str(v, max) ?? undefined;
}

function amount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Defensive shape check on a block from the wire or from storage. */
export function normalisePennyMovePlan(raw: unknown): PennyMovePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "move_plan") return null;
  const summary = str(r.summary, 600);
  const total = amount(r.total);
  const shortfall = r.shortfall === undefined || r.shortfall === null ? 0 : amount(r.shortfall);
  if (!summary || total === null || shortfall === null) return null;
  const t = r.target as Record<string, unknown> | undefined;
  const tName = str(t?.name, 80);
  const tBank = optStr(t?.bank, 80);
  const tProvider = optStr(t?.provider, 80);
  if (!tName || tBank === undefined || tProvider === undefined) return null;
  if (!Array.isArray(r.legs) || r.legs.length < 1 || r.legs.length > MOVE_PLAN_MAX_LEGS) return null;
  const legs: PennyMovePlanLeg[] = [];
  for (const l of r.legs as unknown[]) {
    const lr = l as Record<string, unknown>;
    const name = str(lr?.name, 80);
    const bank = optStr(lr?.bank, 80);
    const provider = optStr(lr?.provider, 80);
    const amt = amount(lr?.amount);
    const keeps = amount(lr?.keeps);
    if (!name || bank === undefined || provider === undefined || amt === null || keeps === null) return null;
    legs.push({ name, bank, provider: provider ?? "", amount: amt, keeps });
  }
  const pool = r.pool === null || r.pool === undefined ? null : amount(r.pool);
  const requested = r.requested === null || r.requested === undefined ? null : amount(r.requested);
  if (pool === null && r.pool != null) return null;
  if (requested === null && r.requested != null) return null;
  const skipped: PennyMovePlan["skipped"] = [];
  if (r.skipped !== undefined && r.skipped !== null) {
    if (!Array.isArray(r.skipped) || r.skipped.length > 12) return null;
    for (const s of r.skipped as unknown[]) {
      const sr = s as Record<string, unknown>;
      const name = str(sr?.name, 80);
      if (!name || typeof sr.reason !== "string" || !REASONS.has(sr.reason)) return null;
      skipped.push({ name, reason: sr.reason as PennyMovePlanSkipReason });
    }
  }
  return {
    kind: "move_plan",
    target: { name: tName, bank: tBank, provider: tProvider ?? "" },
    legs,
    total,
    pool,
    requested,
    shortfall,
    summary,
    skipped,
  };
}

/** "£146.00" style; the card shows pence because the answer is exact. */
export function formatMovePlanMoney(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One whisper line for accounts that have nothing spare: at most two names,
 * then "and N more". Returns null when no account was skipped for that reason. */
export function nothingSpareLine(skipped: PennyMovePlan["skipped"]): string | null {
  const names = skipped.filter((s) => s.reason === "nothing_spare").map((s) => s.name);
  if (names.length === 0) return null;
  const shown = names.slice(0, 2);
  const extra = names.length - shown.length;
  const list = extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(" and ");
  const plural = names.length > 1;
  return `${list} ${plural ? "have" : "has"} nothing spare`;
}
