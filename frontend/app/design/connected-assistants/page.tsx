"use client";

// TEMPORARY PREVIEW — delete with the other /design/* routes.
// F4/F8: "Connected assistants" Settings card, real
// components/ConnectedAssistantsCard.tsx (the same component
// app/settings/SettingsPage.tsx renders after the Penny card) against
// static fixtures — empty, populated (two clients, one of which has
// never been used), with the activity expander open, and (F8) a
// zero-allowance tier that can't use the connector at all — each in a
// light and a dark block. No data fetching, no session; Disconnect and
// "View activity" are both interactive against the fixture data (real
// component state), they just don't hit the network.
import { useState } from "react";
import ConnectedAssistantsCard, { ActivityState, ConnectionsState } from "@/components/ConnectedAssistantsCard";
import type { OAuthConnection, McpAuditCall } from "@/lib/api";

const POPULATED_CONNECTIONS: OAuthConnection[] = [
  {
    client_id: "claude-abc123",
    client_name: "Claude",
    scopes: ["accounts:read", "plans:read", "insights:read"],
    created_at: "2026-08-12T09:14:00Z",
    last_used_at: "2026-09-07T18:42:00Z",
    active_tokens: 1,
  },
  {
    client_id: "chatgpt-def456",
    client_name: "ChatGPT",
    scopes: ["accounts:read"],
    created_at: "2026-09-05T11:03:00Z",
    last_used_at: null,
    active_tokens: 1,
  },
];

const ACTIVITY_CALLS: McpAuditCall[] = [
  { tool: "get_safe_to_spend", client: "Claude", ts: "2026-09-08T08:12:00Z", ok: true },
  { tool: "get_upcoming_bills", client: "Claude", ts: "2026-09-07T18:42:30Z", ok: true },
  { tool: "get_accounts", client: "ChatGPT", ts: "2026-09-05T11:04:10Z", ok: false },
  { tool: "explain", client: "Claude", ts: "2026-09-04T21:07:00Z", ok: true },
];

function FixtureCard({
  label,
  connections,
  activityCalls,
  initialOpen,
  tierAllowance = null,
}: {
  label: string;
  connections: OAuthConnection[];
  activityCalls: McpAuditCall[];
  initialOpen: boolean;
  tierAllowance?: number | null;
}) {
  const [open, setOpen] = useState(initialOpen);
  const state: ConnectionsState = { status: "ready", connections };
  const activity: ActivityState = { status: "ready", calls: activityCalls };
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{label}</p>
      <ConnectedAssistantsCard
        state={state}
        onDisconnect={async () => true}
        activity={activity}
        activityOpen={open}
        onToggleActivity={() => setOpen((o) => !o)}
        tierAllowance={tierAllowance}
      />
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="rounded-3xl p-4 space-y-6 bg-[#f0f2f7] dark:bg-[#0f172a]">
        <FixtureCard label="Empty, nothing connected yet" connections={[]} activityCalls={[]} initialOpen={false} />
        <FixtureCard
          label="Populated, two clients (one never used)"
          connections={POPULATED_CONNECTIONS}
          activityCalls={ACTIVITY_CALLS}
          initialOpen={false}
        />
        <FixtureCard
          label="Activity expanded"
          connections={POPULATED_CONNECTIONS}
          activityCalls={ACTIVITY_CALLS}
          initialOpen={true}
        />
        <FixtureCard
          label="Statements / Lite / Standard tier, no connector allowance"
          connections={[]}
          activityCalls={[]}
          initialOpen={false}
          tierAllowance={0}
        />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen bg-[#f0f2f7] dark:bg-[#0f172a]">
      <div className="mx-auto max-w-[430px] px-4 py-8">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">Connected assistants</h1>
        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          F4/F8, real ConnectedAssistantsCard.tsx against fixtures
        </p>

        <div className="mt-6 flex flex-col gap-10">
          <ThemeBlock dark={false} />
          <ThemeBlock dark={true} />
        </div>

        <p className="mt-8 text-[11px] text-slate-500 dark:text-slate-400 text-pretty">
          Scope labels come from lib/oauthScopes.ts, kept word for word in sync with the backend's own
          SCOPE_DESCRIPTIONS (backend/app/routers/oauth.py) so the wording never drifts from the /oauth/consent
          screen. A connection only counts as connected while it has at least one live token, a fully disconnected
          client drops out of this list once the parent&apos;s next fetch settles. The connect URL comes from
          NEXT_PUBLIC_MCP_URL (lib/featureFlags.ts); the zero-allowance fixture above shows
          SettingsPage.tsx passing tierAllowance={"{"}0{"}"} (GET /subscription&apos;s
          limits.mcp_tool_calls_per_month) instead of connect instructions.
        </p>
      </div>
    </div>
  );
}
