// G269 (A Tail, Kevin 2026-10-15): the one pay-split bar. Shared by
// components/SpendShapeCard.tsx and app/spend/shape/MoneyShapeHero.tsx, so the
// card and the hero it opens can never draw the instrument differently. One
// bar scaled to the larger of take-home and outgoings, a slate tick where
// take-home ends and, when spending went past it, a striped tail with an amber
// hairline beneath. Under take-home it is the plain four-segment bar with Left.
// Colours arrive as props (JOB_COLOR lives in MoneyShapeHero, which imports
// this file).
//
// Rules held here (DESIGN.md): figures are ink, amber lives in the signifier
// (a hairline, a dot, a ring), never in text; red is never used because going
// past take-home is not a payment at risk. Facts come from the engine
// (total_out, beyond, beyond_source, card_growth); nothing is computed or
// guessed in the browser beyond scaling the bar.
import MoneyText from "@/components/MoneyText";
import type { MoneyShapeJob } from "@/lib/api";

export type BeyondSource = "cards" | "savings" | "cards_and_savings" | null;

export type BeyondFigures = {
  takeHome: number;
  totalOut: number;
  beyond: number;
  source: BeyondSource;
  cardGrowth: number;
  savingsDrawdown: number;
  moved: number;
  /** An averaged window has no single period to attribute, so no source. */
  average: boolean;
};

type Entry = {
  take_home: number;
  overspent: number;
  total_out?: number;
  beyond?: number;
  beyond_source?: BeyondSource;
  card_growth?: number;
  savings_drawdown?: number;
  jobs: MoneyShapeJob[] | null | undefined;
};

/** The engine's own figures, with the older payload (no total_out/beyond)
 *  falling back to what its jobs and overspent already say. */
export function beyondFigures(entry: Entry, average = false): BeyondFigures {
  const amountOf = (id: MoneyShapeJob["id"]) => entry.jobs?.find((j) => j.id === id)?.amount ?? 0;
  const moved = amountOf("moved");
  const totalOut = entry.total_out ?? amountOf("fixed") + moved + amountOf("free");
  const beyond = entry.beyond ?? entry.overspent ?? 0;
  return {
    takeHome: entry.take_home,
    totalOut,
    beyond,
    source: entry.beyond_source ?? null,
    cardGrowth: entry.card_growth ?? 0,
    savingsDrawdown: entry.savings_drawdown ?? 0,
    moved,
    average,
  };
}

export const gbp = (n: number) => `£${Math.round(Math.abs(n)).toLocaleString("en-GB")}`;

/** The plain sentence. Names the source only when the engine knows it. */
export function beyondSentence(f: BeyondFigures, money: (n: number) => string = gbp): string | null {
  if (f.beyond < 1) return null;
  const lead = `You spent ${money(f.beyond)} more than came in.`;
  if (f.average) return `${lead.slice(0, -1)} on average.`;
  if (f.source === "cards") return `${lead} It came from your cards.`;
  if (f.source === "savings") return `${lead} It came from your savings.`;
  if (f.source === "cards_and_savings") return `${lead} It came from your savings and your cards.`;
  return `${lead} Your accounts do not show where it came from.`;
}

/** BEHAVIOURS.md Layer 3, calm: only for a user who chose "change" on the
 *  saving habit in the Mirror (the consent flag), one observation, a
 *  structural redirect and no accusation. */
export function paradoxLine(f: BeyondFigures, consent: boolean, money: (n: number) => string = gbp): string | null {
  if (!consent || f.average || f.beyond < 1 || f.moved < 1) return null;
  if ((f.source === "cards" || f.source === "cards_and_savings") && f.cardGrowth >= 1) {
    return `You moved ${money(f.moved)} while your cards grew by ${money(f.cardGrowth)}. Point that at the card and the gap closes itself.`;
  }
  if (f.source === "savings") {
    return f.savingsDrawdown >= 1
      ? `You moved ${money(f.moved)} to savings and drew ${money(f.savingsDrawdown)} back out in the same period.`
      : null;
  }
  return `You moved ${money(f.moved)} to savings in a period that went past what came in. The habit is yours to keep.`;
}

type Seg = { id: string; bg: string; amount: number };

const STRIPES =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 5px)";

function pct(n: number, scale: number) {
  return scale > 0 ? Math.max(0, (n / scale) * 100) : 0;
}

function Segments({ segs, scale }: { segs: Seg[]; scale: number }) {
  return (
    <>
      {segs.map((s) => (
        <div key={s.id} className={s.bg} style={{ width: `${pct(s.amount, scale)}%` }} />
      ))}
    </>
  );
}

const TRACK = "bg-slate-100 dark:bg-slate-800";
const TICK = "bg-slate-900 dark:bg-slate-100";

export function PaySplitBar({
  segs,
  figures,
  size,
  money = gbp,
}: {
  segs: Seg[];
  figures: BeyondFigures;
  size: "card" | "hero";
  money?: (n: number) => string;
}) {
  const { takeHome, totalOut, beyond } = figures;
  const hasBeyond = beyond >= 1;
  const scale = Math.max(takeHome, totalOut);
  const tick = pct(takeHome, scale);
  const tailPct = 100 - tick;
  const h = size === "card" ? "h-2.5" : "h-3";
  // Overspent: Left has no width, so it is dropped and the tail shows the
  // overshoot. Otherwise Left is a segment like the others (the four-segment
  // bar of old), through this same component.
  const drawn = hasBeyond ? segs.filter((s) => s.id !== "left") : segs;

  return (
    <div className={size === "card" ? "mt-2" : "mt-3"}>
      <div aria-hidden="true" className="relative pb-1">
        <div className={`relative flex w-full overflow-hidden rounded-full ${TRACK} ${h}`}>
          <Segments segs={drawn} scale={scale} />
          {hasBeyond && (
            // The stripes are a repeating white-alpha texture, not a colour
            // gradient: the segment colours still read through them.
            <div className="absolute inset-y-0 right-0" style={{ width: `${tailPct}%`, backgroundImage: STRIPES }} />
          )}
        </div>
        {hasBeyond && (
          <>
            <span className={`absolute -top-1 bottom-0 w-0.5 rounded-full ${TICK}`} style={{ left: `calc(${tick}% - 1px)` }} />
            <span className="absolute bottom-0 h-[2px] rounded-full bg-amber-500" style={{ left: `${tick}%`, right: 0 }} />
          </>
        )}
      </div>
      {hasBeyond && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block h-3 w-0.5 rounded-full ${TICK}`} aria-hidden="true" />
            <MoneyText text={`Came in ${money(takeHome)}`} />
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            <MoneyText text={`${money(beyond)} beyond it`} />
          </span>
        </p>
      )}
    </div>
  );
}

/** The one-line statement of what the percentages are of. */
export function percentBase(hasBeyond: boolean): string {
  return hasBeyond ? "Shares are of what went out." : "Shares are of what came in.";
}
