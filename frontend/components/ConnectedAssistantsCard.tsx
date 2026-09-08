"use client";

// F4: "Connected assistants" — Settings card listing the OAuth 2.1
// connectors (F2, backend/app/routers/oauth.py) a user has approved to
// read their Sorted data over MCP (F3, app/routers/mcp.py), with a
// per-connector Disconnect and an expander onto the user's own `/mcp`
// audit log (F3's GET /mcp/audit).
//
// Fully presentational, no fetching of its own — same convention as
// OAuthConsentCard.tsx and PennyUsageRow.tsx, so the live card
// (app/settings/SettingsPage.tsx) and its design preview
// (app/design/connected-assistants/page.tsx) render the exact same
// markup against real vs. fixture data. The caller owns:
//   - `state`: the GET /oauth/connections result (or loading/error).
//   - `onDisconnect(clientId)`: perform DELETE /oauth/connections/{id}
//     and refetch `state`; resolves to whether it succeeded.
//   - `activity` / `activityOpen` / `onToggleActivity`: the GET
//     /mcp/audit result for the current month, fetched lazily the first
//     time the expander opens (SettingsPage owns the "already fetched"
//     guard, this component just renders whatever state it's given).
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
import { Plug, Check, ChevronDown } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { OAuthConnection, McpAuditCall } from "@/lib/api";
import { describeScopes } from "@/lib/oauthScopes";
import { MCP_URL } from "@/lib/featureFlags";
import { formatPennyResetDate } from "@/components/PennySheetProvider";
import type { SubscriptionMcpPack } from "@wealth/shared";

const INDIGO = "#4f46e5";

export type ConnectionsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; connections: OAuthConnection[] };

export type ActivityState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; calls: McpAuditCall[] };

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

function McpPackRow({ pack }: { pack: SubscriptionMcpPack }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 min-h-[44px]">
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
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Available soon
        </span>
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

// No shared TOOL_LABELS map exists yet (grepped, nothing else needs one) —
// "get_safe_to_spend" -> "get safe to spend" reads fine for an audit log.
function toolLabel(tool: string): string {
  return tool.replace(/_/g, " ");
}

export default function ConnectedAssistantsCard({
  state,
  onDisconnect,
  activity,
  activityOpen,
  onToggleActivity,
  tierAllowance,
  allowance,
  mcpPacks,
  tier,
  billingLive,
}: {
  state: ConnectionsState;
  onDisconnect: (clientId: string) => Promise<boolean>;
  activity: ActivityState;
  activityOpen: boolean;
  onToggleActivity: () => void;
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
  /** F9: GET /subscription's `mcp_packs` (MCP_CALL_PACKS) — rendered as
   * "Available soon" rows under "Need more calls?", same treatment as
   * MoreMessagesSheet.tsx's Penny packs (no purchase flow yet, B5). */
  mcpPacks: SubscriptionMcpPack[];
  /** F9: the signed-in user's tier name, so the "Everyone is on the Max
   * plan..." note only shows for a Max-tier user (not e.g. someone on
   * Connect who bought a pack). Null before GET /subscription resolves. */
  tier: string | null;
  /** F9: GET /subscription's `billing_live` — false while item B5 hasn't
   * shipped, gating the temporary "while billing is being built" note so
   * it disappears the day billing goes live instead of needing a code
   * change here. */
  billingLive: boolean;
}) {
  const [confirmClient, setConfirmClient] = useState<OAuthConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectedName, setDisconnectedName] = useState<string | null>(null);

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

      {state.status !== "loading" && !isTierGated && (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 dark:border-slate-700">
            <p className="text-xs text-slate-400 dark:text-slate-500">Every request is logged</p>
            <button
              type="button"
              onClick={onToggleActivity}
              aria-expanded={activityOpen}
              className="flex-shrink-0 min-h-[44px] px-3 flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/10 active:bg-indigo-100 transition-colors"
            >
              {activityOpen ? "Hide activity" : "View activity"}
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${activityOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>

          <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)] ${
              activityOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
            inert={!activityOpen}
          >
            <div className="overflow-hidden">
              <div className="px-4 pb-3.5">
                {activity.status === "loading" && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-1">Checking…</p>
                )}
                {activity.status === "error" && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-1">Could not load activity</p>
                )}
                {activity.status === "ready" && activity.calls.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-1">No activity this month</p>
                )}
                {activity.status === "ready" && activity.calls.length > 0 && (
                  <ul className="space-y-2 pt-1">
                    {activity.calls.slice(0, 20).map((call, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {call.ok ? (
                          <Check size={12} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                        ) : (
                          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Failed
                          </span>
                        )}
                        <span className="truncate">
                          {toolLabel(call.tool)} · {call.client} · {formatDateTime(call.ts)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* F9: "Need more calls?" — quiet upsell for the MCP call pack,
          same "Available soon" treatment as MoreMessagesSheet.tsx's Penny
          packs (no purchase flow yet, billing is B5). Only shown for a
          tier that has the connector at all. */}
      {!isTierGated && mcpPacks.length > 0 && (
        <div className="px-4 py-3.5 border-t border-slate-100 dark:border-slate-700 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Need more calls?</p>
          <div className="space-y-2">
            {mcpPacks.map((pack) => (
              <McpPackRow key={pack.id} pack={pack} />
            ))}
          </div>
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
