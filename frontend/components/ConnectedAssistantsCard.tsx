"use client";

// F4: "Connected assistants" — Settings card listing the OAuth 2.1
// connectors (F2, backend/app/routers/oauth.py) a user has approved to
// read their Sorted data over MCP (F3, app/routers/mcp.py), with a
// per-connector Disconnect and a link onto the full paginated activity
// log at /mcp-activity (F14).
//
// Fully presentational, no fetching of its own — same convention as
// OAuthConsentCard.tsx and PennyUsageRow.tsx, so the live card
// (app/settings/SettingsPage.tsx) and its design preview
// (app/design/connected-assistants/page.tsx) render the exact same
// markup against real vs. fixture data. The caller owns:
//   - `state`: the GET /oauth/connections result (or loading/error).
//   - `onDisconnect(clientId)`: perform DELETE /oauth/connections/{id}
//     and refetch `state`; resolves to whether it succeeded.
//
// F15: this card used to carry its own inline slice of the GET /mcp/audit
// log behind a "View activity" / "Hide activity" toggle, duplicating
// /mcp-activity (F14, cursor-paginated, filterable, the real place to read
// activity). Kevin asked for exactly one way in, so the toggle and inline
// list are gone; the card only ever links out to /mcp-activity now. The
// `formatDateTime`/`toolLabel` helpers below stay exported because
// app/mcp-activity/McpActivityPage.tsx still imports them for its own rows.
//
// A connection only counts as "connected" while it still has at least
// one live token (`active_tokens > 0`) — a fully revoked client's docs
// stay in Mongo for history (see oauth.py's list_connections comment),
// but showing a dead entry forever with a Disconnect button that does
// nothing would be confusing, so the populated list filters them out.
// The "{name} disconnected" confirmation line above the list covers the
// gap between an optimistic disconnect and the next refetch dropping the
// row.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import type { OAuthConnection } from "@/lib/api";
import { describeScopes } from "@/lib/oauthScopes";
import { MCP_URL } from "@/lib/featureFlags";
import { formatPennyResetDate } from "@/components/PennySheetProvider";
import type { SubscriptionMcpPack } from "@wealth/shared";

const INDIGO = "#4f46e5";

export type ConnectionsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; connections: OAuthConnection[] };

/** F9: this calendar month's MCP connector call allowance (GET
 * /subscription's `mcp` block), or null before that fetch has resolved. */
export type McpAllowance = {
  used: number;
  limit: number | null;
  remaining: number | null;
  resets_on: string | null;
  pack_calls: number;
};

// Copy: no em dashes (repo-wide rule). Colour: the trailing pill turns
// amber only once used reaches 80% of the (pack-topped-up) limit, never
// red, matching PennyUsageRow.tsx's own reading of DESIGN.md's Red Is
// Risk rule, running low on connector calls isn't a genuine financial
// risk either.
function formatAllowanceRow(allowance: McpAllowance): { subline: string; pill: { text: string; amber: boolean } | null } {
  const { used, limit, remaining, resets_on, pack_calls } = allowance;
  if (limit == null) {
    return { subline: "Unlimited", pill: null };
  }
  const resetLabel = formatPennyResetDate(resets_on);
  let subline = `${used.toLocaleString("en-GB")} of ${limit.toLocaleString("en-GB")} calls this month, resets ${resetLabel}`;
  if (pack_calls > 0) {
    subline += `, including ${pack_calls.toLocaleString("en-GB")} from a pack`;
  }
  const remainingVal = remaining ?? Math.max(0, limit - used);
  const pill = {
    text: `${remainingVal.toLocaleString("en-GB")} left`,
    amber: limit > 0 && used / limit >= 0.8,
  };
  return { subline, pill };
}

// B5: real button once `billingLive` (POST /billing/checkout, kind="pack",
// target="mcp_1000") — starts a Stripe Checkout session and redirects the
// browser to it. `onBuy`/`busy` are only meaningful when `billingLive` is
// true; otherwise the row keeps the "Available soon" trailing label.
function McpPackRow({
  pack, billingLive, busy, onBuy,
}: {
  pack: SubscriptionMcpPack;
  billingLive: boolean;
  busy: boolean;
  onBuy: () => void;
}) {
  const inner = (
    <>
      <span className="flex items-center gap-2 min-w-0 pr-2">
        <span className="text-[13px] font-medium text-slate-800 dark:text-slate-100 num">
          {pack.calls.toLocaleString("en-GB")} calls
        </span>
        {pack.badge && (
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 rounded-full px-2 py-0.5">
            {pack.badge}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 flex flex-col items-end gap-0.5">
        <span className="font-mono text-[13px] text-slate-900 dark:text-slate-100">£{pack.price_gbp.toFixed(2)}</span>
        {billingLive ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            {busy ? "Opening…" : "Buy"}
          </span>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Available soon
          </span>
        )}
      </span>
    </>
  );

  if (!billingLive) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onBuy}
      disabled={busy}
      className="w-full flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px] text-left active:scale-[0.99] transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {inner}
    </button>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

// No shared TOOL_LABELS map exists yet (grepped, nothing else needs one) —
// "get_safe_to_spend" -> "get safe to spend" reads fine for an audit log.
export function toolLabel(tool: string): string {
  return tool.replace(/_/g, " ");
}

export default function ConnectedAssistantsCard({
  state,
  onDisconnect,
  tierAllowance,
  allowance,
  mcpPacks,
  tier,
  billingLive,
}: {
  state: ConnectionsState;
  onDisconnect: (clientId: string) => Promise<boolean>;
  /** F8: the signed-in user's `mcp_tool_calls_per_month` limit (GET
   * /subscription's SubscriptionLimits), or null before that fetch has
   * resolved. Statements/Lite/Standard carry 0 here; Connect/Max carry a
   * number or null (unlimited). At 0 the connector card shows a plan
   * upsell instead of connect instructions or the activity footer, since a
   * zero-allowance tier can never make a call either way. Null (not yet
   * known) falls through to the ordinary state machine below, the same as
   * any other tier that does allow the connector. */
  tierAllowance: number | null;
  /** F9: this calendar month's MCP connector call allowance (GET
   * /subscription's `mcp` block), or null before that fetch has resolved —
   * distinct from `tierAllowance` above (which is just the tier's own
   * ceiling, used for the tier-gate check) because this also carries the
   * live `used` count and any active call-pack balance. */
  allowance: McpAllowance | null;
  /** F9: GET /subscription's `mcp_packs` (MCP_CALL_PACKS) — rendered under
   * "Need more calls?". B5: real "Buy" buttons once `billingLive` (POST
   * /billing/checkout), "Available soon" rows until then. */
  mcpPacks: SubscriptionMcpPack[];
  /** F9: the signed-in user's tier name, so the "Everyone is on the Max
   * plan..." note only shows for a Max-tier user (not e.g. someone on
   * Connect who bought a pack). Null before GET /subscription resolves. */
  tier: string | null;
  /** F9/B5: GET /subscription's `billing_live` — false until a Stripe
   * account exists and BILLING_ENABLED is set (app.core.config). Gates
   * both the temporary "while billing is being built" note below and
   * whether the MCP pack row is a real checkout button. */
  billingLive: boolean;
}) {
  const [confirmClient, setConfirmClient] = useState<OAuthConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectedName, setDisconnectedName] = useState<string | null>(null);
  const [packPendingId, setPackPendingId] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  async function handleBuyPack(packId: string) {
    if (packPendingId) return;
    setPackError(null);
    setPackPendingId(packId);
    try {
      const { url } = await api.startCheckout("pack", packId);
      window.location.assign(url);
    } catch {
      setPackError("Could not start checkout. Try again in a moment.");
      setPackPendingId(null);
    }
  }

  // "Brief" per the brief: the confirmation line clears itself so it
  // doesn't linger as a stale caption on a settings screen the user may
  // leave open.
  useEffect(() => {
    if (!disconnectedName) return;
    const t = setTimeout(() => setDisconnectedName(null), 5000);
    return () => clearTimeout(t);
  }, [disconnectedName]);

  async function handleConfirm() {
    if (!confirmClient) return;
    setBusy(true);
    const ok = await onDisconnect(confirmClient.client_id);
    setBusy(false);
    const name = confirmClient.client_name;
    setConfirmClient(null);
    if (ok) setDisconnectedName(name);
  }

  const connected = state.status === "ready" ? state.connections.filter((c) => c.active_tokens > 0) : [];
  // F8: a zero-allowance tier (Statements, Lite, Standard) can never make
  // an MCP call, so the whole connect flow is replaced with a plan upsell
  // rather than instructions that would just fail.
  const isTierGated = tierAllowance === 0;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-start gap-2.5">
        <span
          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${INDIGO}26` }}
          aria-hidden="true"
        >
          <Plug size={16} style={{ color: INDIGO }} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Connected assistants</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">AI assistants that can read your Sorted data</p>
        </div>
      </div>

      {/* F9: this month's connector call allowance, shown for any tier
          that actually has the connector (tierAllowance !== 0) — placed
          under the header, before the connections list, so it reads as a
          property of the card as a whole rather than of any one
          connection. */}
      {!isTierGated && allowance && (() => {
        const { subline, pill } = formatAllowanceRow(allowance);
        return (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 num">{subline}</p>
            {pill && (
              <span
                className={`flex-shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 num ${
                  pill.amber
                    ? "text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30"
                    : "text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-700"
                }`}
              >
                {pill.text}
              </span>
            )}
          </div>
        );
      })()}

      {state.status === "loading" && (
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-400 dark:text-slate-500">Checking…</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="px-4 py-3.5">
          <p className="text-xs text-slate-400 dark:text-slate-500">Could not load connected assistants</p>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {disconnectedName && (
            <p className="px-4 pt-3 text-xs text-emerald-600 dark:text-emerald-400">{disconnectedName} disconnected</p>
          )}

          {isTierGated ? (
            <div className="px-4 py-3.5">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Available on Connect and Max</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Connecting an AI assistant to your Sorted data is included in the Connect and Max plans.
              </p>
            </div>
          ) : connected.length === 0 ? (
            <div className="px-4 py-3.5">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">No assistants connected</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Connect Claude or another assistant to Sorted at {MCP_URL} and it will appear here.
              </p>
            </div>
          ) : (
            connected.map((c, i) => (
              <div
                key={c.client_id}
                className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i < connected.length - 1 ? "border-b border-slate-100 dark:border-slate-700" : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{c.client_name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {describeScopes(c.scopes)} · last used {c.last_used_at ? formatDate(c.last_used_at) : "never"} · connected {formatDate(c.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmClient(c)}
                  className="flex-shrink-0 min-h-[44px] px-3 text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 active:bg-indigo-100 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ))
          )}
        </>
      )}

      {/* F15: the inline activity list (and its "View activity" / "Hide
          activity" toggle) is gone, Kevin wants exactly one way into
          activity, the full log at /mcp-activity (F14: cursor pagination,
          per-assistant filter chips, date grouping). This footer is the
          single unconditional retention line plus that one link, "90 days"
          mirrors the backend's MCP_AUDIT_TTL_DAYS default
          (backend/app/core/config.py) and would drift if that env var is
          ever changed away from 90 without updating this string too. */}
      {state.status !== "loading" && !isTierGated && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-700">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Sorted keeps this activity log for 90 days.
          </p>
          <Link
            href="/mcp-activity"
            className="flex-shrink-0 min-h-[44px] px-3 flex items-center text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 active:bg-indigo-100 transition-colors"
          >
            View full log
          </Link>
        </div>
      )}

      {/* F9: "Need more calls?" — upsell for the MCP call pack. B5: a real
          checkout button once `billingLive`, same "Available soon"
          treatment as before until then. Only shown for a tier that has
          the connector at all. */}
      {!isTierGated && mcpPacks.length > 0 && (
        <div className="px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Need more calls?</p>
          <div className="space-y-2">
            {mcpPacks.map((pack) => (
              <McpPackRow
                key={pack.id}
                pack={pack}
                billingLive={billingLive}
                busy={packPendingId === pack.id}
                onBuy={() => handleBuyPack(pack.id)}
              />
            ))}
          </div>
          {packError && (
            <p className="text-[11px] leading-snug text-red-500 dark:text-red-400">{packError}</p>
          )}
          {tier === "max" && !billingLive && (
            <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              Everyone is on the Max plan with 5,000 calls a month while billing is being built.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmClient}
        title={confirmClient ? `Disconnect ${confirmClient.client_name}?` : undefined}
        message="It will lose access straight away. You can connect it again from the assistant at any time."
        confirmLabel="Disconnect"
        confirmDisabled={busy}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmClient(null)}
      />
    </div>
  );
}
