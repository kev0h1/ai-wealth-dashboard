// TEMPORARY PREVIEW — delete with the other /design/* routes
//
// Backlog B4: "Show Penny messages used 37 of 150, resets 1 Oct" as its own
// row in Settings' Sign-in methods card. Renders the REAL
// components/PennyUsageRow.tsx (the same component app/settings/
// SettingsPage.tsx now places directly under the Apple row) against three
// static SubscriptionInfo fixtures (shared/src/types.ts) — normal, amber
// (>=80% used) and an uncapped tier (no pill). A faithful replica of the
// surrounding card (header + a Google row) frames each state so the row
// reads in its real context, but that replica is copied markup, not an
// import — SectionHeader/IconChip are private to SettingsPage.tsx. No data
// fetching, no client state, no auth — /design/* is exempt (see
// components/AuthProvider.tsx). Deep-linkable at /design/settings-usage-row.

import { KeyRound } from "lucide-react";
import PennyUsageRow from "@/components/PennyUsageRow";
import type { SubscriptionInfo } from "@/lib/api";

const INDIGO = "#4f46e5";

function fixture(
  tier: SubscriptionInfo["tier"],
  usage: Partial<SubscriptionInfo["usage"]>,
): SubscriptionInfo {
  return {
    tier,
    status: "active",
    prices_gbp: { statements: 0, lite: 2.99, standard: 5.99, connect: 9.99, max: 14.99 },
    topup: { messages: 100, price_gbp: 2.99 },
    limits: {
      open_banking: true,
      max_banks: null,
      max_accounts: null,
      refresh: "daily",
      penny_messages_per_month: 150,
      mcp_tool_calls_per_month: null,
      history_days: null,
      statement_uploads_per_month: null,
    },
    usage: {
      year_month: "2026-09",
      penny_messages: 0,
      cost_usd: 0,
      penny_limit: 150,
      penny_remaining: 150,
      penny_resets_on: "2026-10-01",
      penny_topup_messages: 0,
      ...usage,
    },
  };
}

const NORMAL = fixture("standard", { penny_messages: 37, penny_limit: 150, penny_remaining: 113 });
const AMBER = fixture("standard", { penny_messages: 131, penny_limit: 150, penny_remaining: 19 });
const UNLIMITED = fixture("max", { penny_messages: 84, penny_limit: null, penny_remaining: null });

function CardFrame({ label, info }: { label: string; info: SubscriptionInfo }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{label}</p>
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-start gap-2.5">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${INDIGO}26` }}
            aria-hidden="true"
          >
            <KeyRound size={16} style={{ color: INDIGO }} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Sign-in methods
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Google</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">kevin@example.com</p>
          </div>
          <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2.5 py-1">
            Primary
          </span>
        </div>

        <PennyUsageRow info={info} />
      </div>
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="rounded-3xl p-4 space-y-5 bg-[#f0f2f7] dark:bg-[#0f172a]">
        <CardFrame label="Normal, 37 of 150" info={NORMAL} />
        <CardFrame label="Amber, 131 of 150 (>=80% used)" info={AMBER} />
        <CardFrame label="Unlimited, Max plan" info={UNLIMITED} />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Settings usage row</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Backlog B4, real PennyUsageRow.tsx against three fixtures
        </p>

        <div className="mt-6 flex flex-col gap-8">
          <ThemeBlock dark={false} />
          <ThemeBlock dark={true} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          The pill turns amber only once used reaches 80% of the (topped-up) limit, and is omitted entirely on an
          uncapped tier, per DESIGN.md&apos;s Red Is Risk rule, running low on chat messages is never a genuine
          financial risk.
        </p>
      </div>
    </div>
  );
}
