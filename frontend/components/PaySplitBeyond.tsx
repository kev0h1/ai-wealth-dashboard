// G269 design round: the pieces "How your pay was split" needs when spending
// can go past take-home. Shared by components/SpendShapeCard.tsx and
// app/spend/shape/MoneyShapeHero.tsx, both of which render exactly what they
// rendered before unless they are handed a `beyondView`. Colours arrive as
// props (JOB_COLOR lives in MoneyShapeHero, which imports this file).
//
// Rules held here (DESIGN.md): figures are ink, amber lives in the signifier
// (a hairline, a dot, a ring), never in text; red is never used because going
// past take-home is not a payment at risk. Facts come from the engine
// (total_out, beyond, beyond_source, card_growth); nothing is computed or
// guessed in the browser beyond scaling the bar.
import type { ReactNode } from "react";
import MoneyText from "@/components/MoneyText";
import type { MoneyShape, MoneyShapeJob } from "@/lib/api";

export type BeyondView = "tail" | "lanes" | "detached";
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

/** Split the outgoings segments at the take-home mark: what fits inside it,
 *  and what lies past it. */
function splitAt(segs: Seg[], mark: number): { head: Seg[]; tail: Seg[] } {
  const head: Seg[] = [];
  const tail: Seg[] = [];
  let used = 0;
  for (const s of segs) {
    const inHead = Math.max(0, Math.min(s.amount, mark - used));
    if (inHead > 0) head.push({ ...s, amount: inHead });
    if (s.amount - inHead > 1e-9) tail.push({ ...s, amount: s.amount - inHead });
    used += s.amount;
  }
  return { head, tail };
}

const TRACK = "bg-slate-100 dark:bg-slate-800";
const TICK = "bg-slate-900 dark:bg-slate-100";

export function PaySplitBar({
  segs,
  figures,
  view,
  size,
  money = gbp,
}: {
  segs: Seg[];
  figures: BeyondFigures;
  view: BeyondView;
  size: "card" | "hero";
  money?: (n: number) => string;
}) {
  const { takeHome, totalOut, beyond } = figures;
  const scale = Math.max(takeHome, totalOut);
  const tick = pct(takeHome, scale);
  const tailPct = 100 - tick;
  const h = size === "card" ? "h-2.5" : "h-3";
  const hasBeyond = beyond >= 1;
  const ordered = segs.filter((s) => s.id !== "left");

  let bar: ReactNode;
  if (view === "lanes") {
    bar = (
      <div className="relative space-y-1.5">
        <div className={`flex w-full overflow-hidden rounded-full ${TRACK} ${h}`}>
          <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${tick}%` }} />
        </div>
        <div className={`flex w-full overflow-hidden rounded-full ${TRACK} ${h}`}>
          <Segments segs={ordered} scale={scale} />
        </div>
        {hasBeyond && (
          <>
            <span className={`absolute -top-1 -bottom-1 w-0.5 rounded-full ${TICK}`} style={{ left: `calc(${tick}% - 1px)` }} />
            <span className="absolute bottom-[-5px] h-[2px] rounded-full bg-amber-500" style={{ left: `${tick}%`, right: 0 }} />
          </>
        )}
      </div>
    );
  } else if (view === "detached" && hasBeyond) {
    const { head, tail } = splitAt(ordered, takeHome);
    const headTotal = head.reduce((a, s) => a + s.amount, 0);
    const tailTotal = tail.reduce((a, s) => a + s.amount, 0);
    bar = (
      <div className="flex w-full gap-2 px-px">
        <div className={`flex overflow-hidden rounded-full ${TRACK} ${h}`} style={{ flexGrow: tick, flexBasis: 0 }}>
          <Segments segs={head} scale={headTotal} />
        </div>
        <div
          className={`flex overflow-hidden rounded-full ring-1 ring-amber-500 ring-offset-2 ring-offset-transparent ${h}`}
          style={{ flexGrow: tailPct, flexBasis: 0 }}
        >
          <Segments segs={tail} scale={tailTotal} />
        </div>
      </div>
    );
  } else {
    // "tail" (and the quiet states of "detached"): one bar, scaled to the
    // larger of take-home and outgoings. Past the mark the segments keep
    // their colours under a stripe, with an amber hairline beneath.
    bar = (
      <div className="relative pb-1">
        <div className={`relative flex w-full overflow-hidden rounded-full ${TRACK} ${h}`}>
          <Segments segs={ordered} scale={scale} />
          {hasBeyond && (
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
    );
  }

  return (
    <div className={size === "card" ? "mt-2" : "mt-3"}>
      <div aria-hidden="true" className={hasBeyond && view !== "detached" ? "px-0" : ""}>{bar}</div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          {hasBeyond || view === "lanes" ? (
            view === "lanes" ? (
              <span className="inline-block h-1.5 w-3 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
            ) : (
              <span className={`inline-block h-3 w-0.5 rounded-full ${TICK}`} aria-hidden="true" />
            )
          ) : null}
          <MoneyText text={`Came in ${money(takeHome)}`} />
        </span>
        {view === "lanes" && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex h-1.5 w-4 overflow-hidden rounded-full" aria-hidden="true">
              {ordered.map((s) => <span key={s.id} className={`flex-1 ${s.bg}`} />)}
            </span>
            <MoneyText text={`Went out ${money(totalOut)}`} />
          </span>
        )}
        {hasBeyond && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            <MoneyText text={`${money(beyond)} beyond it`} />
          </span>
        )}
      </p>
    </div>
  );
}

/** The one-line statement of what the percentages are of. */
export function percentBase(hasBeyond: boolean): string {
  return hasBeyond ? "Shares are of what went out." : "Shares are of what came in.";
}
