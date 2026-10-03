"use client";

// G200 variants, drafted with openai/gpt-6-astra (impeccable approach) and
// rewritten to DESIGN.md. Raw output: docs/design/G200-astra-pass1.md.
// A Permission slip, B Cover route, C Permission ledger.
// All three share the production card's prop contract (see shared.tsx).

import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  AccountRows,
  classOf,
  Disclosure,
  FOCUS,
  Frame,
  matchesQuery,
  plural,
  Rules,
  SearchField,
  SECONDARY,
  StateNotice,
  UpcomingLink,
  useCoverModel,
  usability,
  displayName,
  type CoverSafeguardsProps,
} from "./shared";
import type { Account } from "@/lib/api";

const GROUPS: Array<{ kind: "current" | "savings"; label: string }> = [
  { kind: "current", label: "Current accounts" },
  { kind: "savings", label: "Savings" },
];

function namesSummary(accounts: Account[]): string {
  const names = accounts.map((a) => displayName(a.name));
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

// ───────────────────────── A. Permission slip ─────────────────────────
// The saved decision leads, the two exceptions are named, 19 accounts live
// behind one intentional doorway. Settings holds no live move; it links out.
export function PermissionSlip(props: CoverSafeguardsProps) {
  const model = useCoverModel(props);
  const [query, setQuery] = useState("");
  const results = props.accounts.filter((a) => matchesQuery(a, query));
  const searching = query.trim().length > 0;

  return (
    <Frame
      headingId="cover-a-heading"
      title="Choose where cover can come from"
      intro="Keep switched on the accounts you are happy for Sorted to suggest using."
    >
      <StateNotice total={props.accounts.length} model={model} />
      {props.accounts.length > 0 && (
        <>
          <div className="py-4" aria-live="polite">
            <h3 className="text-[16px] font-bold text-slate-950 dark:text-white">
              {plural(model.allowed.length, "account", "accounts")} allowed for cover
            </h3>
            <p className={`mt-1 text-[14px] leading-snug ${SECONDARY}`}>
              {model.turnedOff.length > 0
                ? `Turned off: ${namesSummary(model.turnedOff)}.`
                : "Nothing is turned off. Every account may be considered."}
            </p>
            {model.allowedUnusable.length > 0 && model.allowedUsable.length > 0 && (
              <p className={`mt-1 text-[12px] leading-snug ${SECONDARY}`}>
                {plural(model.allowedUnusable.length, "allowed account", "allowed accounts")} cannot spare anything
                today. Your choices are unchanged.
              </p>
            )}
          </div>

          <Disclosure title="Current accounts first, £10 kept in each" detail="How Sorted picks, in plain words">
            <Rules />
          </Disclosure>

          <Disclosure
            title={`Manage ${props.accounts.length} accounts`}
            detail="Switch any account on or off"
            defaultOpen={model.allowed.length === 0}
          >
            <SearchField value={query} onChange={setQuery} />
            {results.length === 0 && (
              <p className={`pb-4 text-[14px] ${SECONDARY}`}>No accounts match. Try another name or provider.</p>
            )}
            {GROUPS.map(({ kind, label }) => {
              const group = results.filter((a) => classOf(a) === kind);
              if (group.length === 0) return null;
              return (
                <Disclosure
                  key={`${kind}-${searching}`}
                  title={label}
                  detail={plural(group.length, "account", "accounts")}
                  defaultOpen={kind === "current" || searching}
                >
                  <AccountRows accounts={group} props={props} showBalance={false} />
                </Disclosure>
              );
            })}
          </Disclosure>
          <UpcomingLink />
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── B. Cover route ─────────────────────────
// The engine's fixed order is the structure: step 1, step 2, then the
// protections. A single hedged sentence says what would happen today, never
// a move, never a figure. Accounts hide inside their own step.
export function CoverRoute(props: CoverSafeguardsProps) {
  const model = useCoverModel(props);

  let today: string | null = null;
  if (model.allowed.length > 0 && model.allowedUsable.length > 0) {
    today =
      model.currentUsable.length > 0
        ? "If you needed cover today, Sorted would try your current accounts first."
        : "None of your current accounts could spare anything today, so Sorted would look at savings.";
  }

  const stages = [
    {
      kind: "current" as const,
      title: "Current accounts first",
      copy: "Sorted tries your allowed current accounts before anything else.",
    },
    {
      kind: "savings" as const,
      title: "Savings only if needed",
      copy: "Used only if all your allowed current accounts together cannot cover the amount.",
    },
  ];

  return (
    <Frame
      headingId="cover-b-heading"
      title="Your cover route"
      intro="You choose the accounts. Sorted works out which to suggest, and the order is fixed."
    >
      <StateNotice total={props.accounts.length} model={model} />
      {props.accounts.length > 0 && (
        <>
          <div className="py-4" aria-live="polite">
            <h3 className="text-[16px] font-bold text-slate-950 dark:text-white">
              {plural(model.allowed.length, "account", "accounts")} allowed for cover
            </h3>
            {today && <p className={`mt-1 text-[14px] leading-snug ${SECONDARY}`}>{today}</p>}
            {model.allowedUnusable.length > 0 && model.allowedUsable.length > 0 && (
              <p className={`mt-1 text-[12px] leading-snug ${SECONDARY}`}>
                {plural(model.allowedUnusable.length, "allowed account", "allowed accounts")} cannot spare anything
                today. Your choices are unchanged.
              </p>
            )}
          </div>

          <ol>
            {stages.map((stage, index) => {
              const group = props.accounts.filter((a) => classOf(a) === stage.kind);
              const on = group.filter((a) => !props.excludedIds.has(a.id));
              const cannot = on.filter((a) => usability(a, props.shortAccountIds)).length;
              return (
                <li
                  key={stage.kind}
                  className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 border-t border-slate-100 pt-4 dark:border-slate-700/70"
                >
                  <span aria-hidden="true" className={`text-[20px] font-bold leading-none ${SECONDARY}`}>
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">{stage.title}</h3>
                    <p className={`mt-1 text-[13px] leading-snug ${SECONDARY}`}>{stage.copy}</p>
                    <div className="mt-2">
                    <Disclosure
                      title={`${on.length} of ${group.length} allowed`}
                      detail={cannot > 0 ? `${cannot} cannot spare anything today` : "Review these accounts"}
                    >
                      <AccountRows accounts={group} props={props} showBalance={false} />
                    </Disclosure>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-2 border-t border-slate-100 py-4 dark:border-slate-700/70">
            <ShieldCheck aria-hidden="true" size={20} className="text-slate-600 dark:text-slate-300" />
            <div>
              <h3 className="text-[14px] font-semibold text-slate-900 dark:text-slate-100">
                £10 stays in every account
              </h3>
              <p className={`mt-1 text-[13px] leading-snug ${SECONDARY}`}>
                Its own bills and set-asides stay protected. Within each step, the account with the most to spare
                comes first, and Sorted prefers to use as few accounts as it can.
              </p>
              <p className={`mt-2 text-[12px] leading-snug ${SECONDARY}`}>
                A manual account follows the same rules in its own step. You would make that transfer yourself.
              </p>
            </div>
          </div>
          <UpcomingLink />
        </>
      )}
    </Frame>
  );
}

// ───────────────────────── C. Permission ledger ─────────────────────────
// A tool for arriving with one account in mind: search and three views are
// always visible, the first view is the exceptions, balances give each row
// identity. Built to also stand alone as a drill-in page body.
type View = "off" | "on" | "all";

export function PermissionLedger(props: CoverSafeguardsProps) {
  const model = useCoverModel(props);
  const [view, setView] = useState<View>(model.turnedOff.length > 0 ? "off" : "all");
  const [query, setQuery] = useState("");

  const views: Array<{ id: View; label: string; count: number }> = [
    { id: "off", label: "Turned off", count: model.turnedOff.length },
    { id: "on", label: "Allowed", count: model.allowed.length },
    { id: "all", label: "All", count: props.accounts.length },
  ];

  // Membership is fixed when the view or search changes, not on every toggle,
  // so turning an account on inside "Turned off" leaves its row where the
  // finger is (and keyboard focus with it) instead of making it vanish.
  const ids = useMemo(() => {
    const pool =
      view === "off"
        ? props.accounts.filter((a) => props.excludedIds.has(a.id))
        : view === "on"
          ? props.accounts.filter((a) => !props.excludedIds.has(a.id))
          : props.accounts;
    return new Set(pool.filter((a) => matchesQuery(a, query)).map((a) => a.id));
    // props.excludedIds is deliberately omitted, see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, query, props.accounts]);
  const results = props.accounts.filter((a) => ids.has(a.id));
  const visible = results.slice(0, 4);
  const rest = results.slice(4);

  return (
    <Frame
      headingId="cover-c-heading"
      title="Accounts for cover"
      intro="Turn off any account you do not want Sorted to suggest using."
    >
      <StateNotice total={props.accounts.length} model={model} />
      {props.accounts.length > 0 && (
        <>
          <div className="py-4" aria-live="polite">
            <h3 className="text-[16px] font-bold text-slate-950 dark:text-white">
              {model.turnedOff.length > 0
                ? `${plural(model.turnedOff.length, "account", "accounts")} turned off`
                : "Every account is allowed"}
            </h3>
            <p className={`mt-1 text-[14px] leading-snug ${SECONDARY}`}>
              Current accounts first, with <span className="money">£10</span> kept in each.
            </p>
          </div>

          <Disclosure title="Read the fixed rules">
            <Rules />
          </Disclosure>

          <SearchField value={query} onChange={setQuery} />

          <div role="group" aria-label="Show accounts" className="flex gap-1 pb-3">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
                className={`min-h-11 flex-1 rounded-xl px-2 text-[13px] font-semibold active:scale-95 motion-reduce:transform-none ${FOCUS} ${
                  view === item.id
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200"
                }`}
              >
                {item.label} {item.count}
              </button>
            ))}
          </div>

          <p className={`border-t border-slate-100 py-3 text-[12px] leading-snug dark:border-slate-700/70 ${SECONDARY}`}>
            Balances are what each account holds, not what could be moved. An allowed account may be unable to
            spare anything today.
          </p>

          {results.length === 0 ? (
            <p role="status" className={`pb-4 text-[14px] ${SECONDARY}`}>
              {query.trim()
                ? "No accounts match. Try another name or provider."
                : view === "off"
                  ? "Nothing is turned off. Every account may be considered."
                  : "No accounts are allowed. Open Turned off to choose one."}
            </p>
          ) : (
            <AccountRows accounts={visible} props={props} showBalance />
          )}
          {rest.length > 0 && (
            <Disclosure key={`${view}-${query}`} title={`Show ${rest.length} more`}>
              <AccountRows accounts={rest} props={props} showBalance />
            </Disclosure>
          )}
          <UpcomingLink />
        </>
      )}
    </Frame>
  );
}
