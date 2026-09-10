"use client";

// TEMPORARY PREVIEW — delete with the other /design/* routes.
// F4/F8/F9/F15: "Connected assistants" Settings card, real
// components/ConnectedAssistantsCard.tsx (the same component
// app/settings/SettingsPage.tsx renders after the Penny card) against
// static fixtures — empty, populated (two clients, one of which has
// never been used), (F8) a zero-allowance tier that can't use the
// connector at all, and (F9) the monthly call allowance row + "Need more
// calls?" pack upsell in its normal / amber (>=80% used) / unlimited
// states — each in a light and a dark block. No data fetching, no
// session; Disconnect is interactive against the fixture data (real
// component state), it just doesn't hit the network. F15: the card no
// longer carries an inline activity list or its own expander, it links
// straight to /mcp-activity (F14), so there is no "activity expanded"
// fixture any more either.
import ConnectedAssistantsCard, { ConnectionsState, McpAllowance } from "@/components/ConnectedAssistantsCard";
import type { OAuthConnection } from "@/lib/api";
import type { SubscriptionMcpPack } from "@wealth/shared";

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

// F9: the one MCP call pack (MCP_CALL_PACKS, backend/app/core/subscription.py).
const MCP_PACKS: SubscriptionMcpPack[] = [
  { id: "mcp_1000", calls: 1000, price_gbp: 2.99, badge: null },
];

function FixtureCard({
  label,
  connections,
  tierAllowance = null,
  allowance = null,
  mcpPacks = [],
  tier = null,
  billingLive = false,
}: {
  label: string;
  connections: OAuthConnection[];
  tierAllowance?: number | null;
  allowance?: McpAllowance | null;
  mcpPacks?: SubscriptionMcpPack[];
  tier?: string | null;
  billingLive?: boolean;
}) {
  const state: ConnectionsState = { status: "ready", connections };
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">{label}</p>
      <ConnectedAssistantsCard
        state={state}
        onDisconnect={async () => true}
        tierAllowance={tierAllowance}
        allowance={allowance}
        mcpPacks={mcpPacks}
        tier={tier}
        billingLive={billingLive}
      />
    </div>
  );
}

function ThemeBlock({ dark }: { dark: boolean }) {
  return (
    <div className={dark ? "dark" : ""} style={{ colorScheme: dark ? "dark" : "light" }}>
      <div className="rounded-3xl p-4 space-y-6 bg-[#f0f2f7] dark:bg-[#0f172a]">
        <FixtureCard label="Empty, nothing connected yet" connections={[]} />
        <FixtureCard
          label="Populated, two clients (one never used)"
          connections={POPULATED_CONNECTIONS}
        />
        <FixtureCard
          label="Statements / Lite / Standard tier, no connector allowance"
          connections={[]}
          tierAllowance={0}
        />
        {/* F9: monthly call allowance row + "Need more calls?" pack upsell. */}
        <FixtureCard
          label="F9: allowance normal, 1,240 of 2,000"
          connections={POPULATED_CONNECTIONS}
          tierAllowance={2000}
          tier="connect"
          mcpPacks={MCP_PACKS}
          allowance={{ used: 1240, limit: 2000, remaining: 760, resets_on: "2026-10-01", pack_calls: 0 }}
        />
        <FixtureCard
          label="F9: allowance amber, 1,650 of 2,000 (>=80% used)"
          connections={POPULATED_CONNECTIONS}
          tierAllowance={2000}
          tier="connect"
          mcpPacks={MCP_PACKS}
          allowance={{ used: 1650, limit: 2000, remaining: 350, resets_on: "2026-10-01", pack_calls: 0 }}
        />
        <FixtureCard
          label="F9: allowance unlimited, Max plan (billing not live)"
          connections={POPULATED_CONNECTIONS}
          tierAllowance={null}
          tier="max"
          billingLive={false}
          mcpPacks={MCP_PACKS}
          allowance={{ used: 820, limit: null, remaining: null, resets_on: "2026-10-01", pack_calls: 0 }}
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
          F4/F8/F9/F15, real ConnectedAssistantsCard.tsx against fixtures
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
          NEXT_PUBLIC_MCP_URL (lib/featureFlags.ts); the zero-allowance fixture above shows SettingsPage.tsx
          passing tierAllowance={"{"}0{"}"} (GET /subscription&apos;s limits.mcp_tool_calls_per_month) instead of
          connect instructions. The F9 fixtures below that show GET /subscription&apos;s new `mcp` block (used,
          limit, resets_on, pack_calls) driving the allowance row and pill, and `mcp_packs` driving the "Need more
          calls?" pack row, "Available soon" until item B5 (billing) ships a purchase flow. The Max-tier fixture&apos;s
          "while billing is being built" note is driven by `billing_live: false`, not hardcoded to the Max tier
          check alone. F15: the card&apos;s footer is now a single unconditional retention line plus the "View full
          log" link to /mcp-activity (F14), there is no more inline activity list or expander to fixture here.
        </p>
      </div>
    </div>
  );
}
