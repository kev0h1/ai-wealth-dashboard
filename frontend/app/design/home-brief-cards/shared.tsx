import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
} from "lucide-react";
import MoneyText from "@/components/MoneyText";
import { getCategoryColour } from "@/lib/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { CardAction, CardFixture } from "./fixtures";
import { ActionButton, Currency, Signifier } from "./primitives";

export function fixturesFor(state: "stack" | "family", fixtures: readonly CardFixture[], stackIds: readonly string[]) {
  if (state === "family") return fixtures;
  const wanted = new Set(stackIds);
  return fixtures.filter((fixture) => wanted.has(fixture.id));
}

export function fixtureKindLabel(fixture: CardFixture): string {
  switch (fixture.kind) {
    case "ask_payday":
      return "Payday check";
    case "ask_generic":
      return "Card detail";
    case "celebration":
      return "Covered";
    case "cliff":
      return "Rate change";
    case "unfunded_move":
      return "Move overdue";
    case "intent_pace":
      return "Pace note";
    case "cover_plan":
      return "Cover plan";
    case "rhythm":
      return "Spending pattern";
  }
}

export function FixtureSignifier({ fixture }: { fixture: CardFixture }) {
  if (fixture.tone === "penny") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <Signifier tone="penny" label="Penny" />
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{fixtureKindLabel(fixture)}</span>
      </span>
    );
  }
  return <Signifier tone={fixture.tone} label={fixtureKindLabel(fixture)} />;
}

export function FixtureIcon({ fixture, size = "regular" }: { fixture: CardFixture; size?: "small" | "regular" }) {
  const dimension = size === "small" ? "h-8 w-8 rounded-[10px]" : "h-9 w-9 rounded-xl";
  const iconSize = size === "small" ? 14 : 16;

  if (fixture.kind === "intent_pace" || fixture.kind === "rhythm") {
    const colour = getCategoryColour(fixture.category);
    const Icon = getCategoryIcon(fixture.category);
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center ${dimension}`}
        style={{ backgroundColor: `${colour}26` }}
      >
        <Icon size={iconSize} style={{ color: colour }} />
      </span>
    );
  }

  const common = `${dimension} flex shrink-0 items-center justify-center`;
  switch (fixture.kind) {
    case "ask_payday":
      return <span aria-hidden="true" className={`${common} bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300`}><CalendarDays size={iconSize} /></span>;
    case "ask_generic":
      return <span aria-hidden="true" className={`${common} bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300`}><CreditCard size={iconSize} /></span>;
    case "celebration":
      return <span aria-hidden="true" className={`${common} bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-300`}><CheckCircle2 size={iconSize} /></span>;
    case "cliff":
      return <span aria-hidden="true" className={`${common} bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-300`}><Clock3 size={iconSize} /></span>;
    case "unfunded_move":
      return <span aria-hidden="true" className={`${common} bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-300`}><AlertCircle size={iconSize} /></span>;
    case "cover_plan":
      return <span aria-hidden="true" className={`${common} bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300`}><ArrowRightLeft size={iconSize} /></span>;
  }
}

function Lead({ value, companion, compact }: { value: ReactNode; companion: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${compact ? "mt-1" : "mt-2"}`}>
      <span className={`${compact ? "text-base" : "text-[19px]"} font-bold leading-6 text-slate-950 dark:text-white`}>
        {value}
      </span>
      <span className="min-w-0 break-words text-[12px] leading-5 text-slate-500 dark:text-slate-400">{companion}</span>
    </div>
  );
}

export function FixtureLead({ fixture, compact = false }: { fixture: CardFixture; compact?: boolean }) {
  switch (fixture.kind) {
    case "ask_payday":
      return <Lead compact={compact} value={fixture.payday} companion={<>expected payday · <Currency value={fixture.expectedIncome} /> expected</>} />;
    case "ask_generic":
      return <Lead compact={compact} value={fixture.source?.account ?? "Card details"} companion="one answer keeps the cash view accurate" />;
    case "celebration":
      return <Lead compact={compact} value={<Currency value={fixture.coveredAmount} />} companion="held aside" />;
    case "cliff":
      return <Lead compact={compact} value={fixture.date} companion={<>rate changes from {fixture.rateFrom}% to {fixture.rateTo}%</>} />;
    case "unfunded_move":
      return <Lead compact={compact} value={<Currency value={fixture.move.suggestedSource.amount} />} companion={<>suggested from {fixture.move.suggestedSource.account}</>} />;
    case "intent_pace":
      return <Lead compact={compact} value={<Currency value={fixture.spent} />} companion={<>of <Currency value={fixture.usual} /> usual</>} />;
    case "cover_plan":
      return <Lead compact={compact} value={<Currency value={fixture.moving} />} companion={<>to {fixture.destination.account}</>} />;
    case "rhythm":
      return <Lead compact={compact} value={<Currency value={46.5} pence />} companion="at Dishoom · 6 Sept" />;
  }
}

export function FixtureBody({ fixture, className = "" }: { fixture: CardFixture; className?: string }) {
  return fixture.body ? (
    <p className={`text-pretty text-[13px] leading-5 text-slate-600 dark:text-slate-300 ${className}`}>
      <MoneyText text={fixture.body} />
    </p>
  ) : null;
}

function EvidenceRow({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="grid min-h-11 grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] items-center gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-right text-[12px] leading-5 ${strong ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}`}>
        {children}
      </dd>
    </div>
  );
}

export function FixtureEvidence({ fixture, condensed = false }: { fixture: CardFixture; condensed?: boolean }) {
  if (fixture.kind === "ask_generic") {
    return (
      <div className="border-y border-slate-100 py-2 dark:border-slate-700/70">
        <p className="text-pretty text-[13px] font-medium leading-5 text-slate-700 dark:text-slate-200">{fixture.question}</p>
      </div>
    );
  }

  if (fixture.kind === "unfunded_move") {
    return (
      <dl className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700/70 dark:border-slate-700/70">
        <EvidenceRow label="Payment">
          <span className="block">{fixture.move.label}</span>
          <span className="block"><Currency value={fixture.move.amount} /> · due {fixture.move.due}</span>
        </EvidenceRow>
        <EvidenceRow label="Destination">
          <span className="block">{fixture.move.destination.account}</span>
          <span className="block"><Currency value={fixture.move.holding} /> held</span>
        </EvidenceRow>
        <EvidenceRow label="Move from" strong>
          <span className="block">{fixture.move.suggestedSource.account}</span>
          <Currency value={fixture.move.suggestedSource.amount} />
        </EvidenceRow>
      </dl>
    );
  }

  if (fixture.kind === "cover_plan") {
    const rows = condensed ? fixture.contributions.slice(0, 2) : fixture.contributions;
    return (
      <dl className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700/70 dark:border-slate-700/70">
        <EvidenceRow label="Destination">
          <span className="block">{fixture.destination.account} · <Currency value={fixture.destination.held} /> held</span>
          <span className="block"><Currency value={fixture.destination.needed} /> due {fixture.destination.due}</span>
        </EvidenceRow>
        {rows.map((source, index) => (
          <EvidenceRow key={source.account} label={index === 0 ? "Move from" : "Then from"}>
            <>{source.account} · <Currency value={source.amount} /></>
          </EvidenceRow>
        ))}
        {condensed && fixture.contributions.length > rows.length ? (
          <EvidenceRow label="One more"><>{fixture.contributions[2].account} · <Currency value={fixture.contributions[2].amount} /></></EvidenceRow>
        ) : null}
        <EvidenceRow label="Moving" strong><Currency value={fixture.moving} /></EvidenceRow>
      </dl>
    );
  }

  const evidence = fixture.kind === "rhythm" ? [fixture.transaction] : fixture.evidence ?? [];
  if (evidence.length === 0) return null;
  return (
    <dl className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700/70 dark:border-slate-700/70">
      {evidence.map((row) => (
        <EvidenceRow key={`${row.label}-${row.value}`} label={row.label}>
          <MoneyText text={row.value} />
        </EvidenceRow>
      ))}
    </dl>
  );
}

export function FixtureActions({
  actions,
  layout = "natural",
}: {
  actions?: CardAction[];
  layout?: "natural" | "fill";
}) {
  if (!actions?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action, index) => {
        const isLastOfThree = actions.length === 3 && index === 2;
        return (
          <ActionButton
            key={action.label}
            kind={action.kind}
            onClick={() => {}}
            className={`${layout === "fill" ? "flex-1" : ""} ${isLastOfThree ? "basis-full" : ""}`}
          >
            {action.label}
          </ActionButton>
        );
      })}
    </div>
  );
}

export function PreviewHeading({ state, title, copy }: { state: "stack" | "family"; title: string; copy: string }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="text-pretty text-base font-bold text-slate-900 dark:text-white">{state === "stack" ? "Cards as they land on Home" : title}</h2>
      <p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-slate-500 dark:text-slate-400">{copy}</p>
    </div>
  );
}
