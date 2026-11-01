"use client";

// E14: one person's subscription on the People page. Collapsed by default;
// opening it loads the detail for that row only. Actions open a sheet with a
// reason field and, where it matters, a typed confirmation (plan name, pack
// name or RESET). None of them delete data, so every confirm is the neutral
// indigo button, never red. A live Stripe, App Store or Google Play
// subscription is never edited here: the section says where to manage it.

import { useState } from "react";
import { api, type OpsSubscription } from "@/lib/api";
import { useSheetA11y } from "@/lib/useSheetA11y";
import {
  PACKS,
  SUB_WORDING,
  TIERS,
  canSubmit,
  capitalise,
  grantLabel,
  mcpLabel,
  packLabel,
  pennyLabel,
  periodLabel,
  providerGuard,
  providerLabel,
  renewalLabel,
  sourceLabel,
  statusLabel,
  trialLabel,
  type SubAction,
} from "./subscription";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const INPUT =
  "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100";
const QUIET_BTN =
  "min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:text-slate-200 dark:hover:bg-slate-700";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-0.5 break-words text-sm text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-start gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
      <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400" />
      <span>{text}</span>
    </p>
  );
}

function ActionSheet({
  action,
  sub,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  action: SubAction;
  sub: OpsSubscription;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (v: { tier: string; pack: string; expires: string; reason: string; typed: string }) => void;
}) {
  const [tier, setTier] = useState<string>(sub.tier);
  const [pack, setPack] = useState<string>(PACKS[0]);
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const panelRef = useSheetA11y<HTMLDivElement>(onCancel);
  const ctx = { tier, pack };
  const ok = canSubmit(action, typed, reason, ctx);
  const title =
    action === "set-tier" ? SUB_WORDING.setTier : action === "topup" ? SUB_WORDING.grantPack : action === "reset-trial" ? SUB_WORDING.resetTrial : SUB_WORDING.cancelGrant;
  const note =
    action === "set-tier" ? SUB_WORDING.setNote : action === "topup" ? SUB_WORDING.packNote : action === "reset-trial" ? SUB_WORDING.resetNote : SUB_WORDING.cancelNote;
  const typeLabel = action === "set-tier" ? SUB_WORDING.typeTier : action === "topup" ? SUB_WORDING.typePack : SUB_WORDING.typeReset;
  const typePlaceholder = action === "set-tier" ? tier : action === "topup" ? pack : SUB_WORDING.resetWord;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-0 dark:bg-black/60 sm:items-center sm:px-6"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-sub-sheet={action}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-slate-100 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{note}</p>

        {action === "set-tier" && (
          <>
            <label className={`${LABEL} mt-4 block`} htmlFor="sub-tier">{SUB_WORDING.tierLabel}</label>
            <select id="sub-tier" value={tier} onChange={(e) => setTier(e.target.value)} className={`${INPUT} mt-1`}>
              {TIERS.map((t) => (
                <option key={t} value={t}>{capitalise(t)}</option>
              ))}
            </select>
            <label className={`${LABEL} mt-4 block`} htmlFor="sub-expiry">{SUB_WORDING.expiryLabel}</label>
            <input id="sub-expiry" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={`${INPUT} mt-1`} />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{SUB_WORDING.expiryHint}</p>
          </>
        )}
        {action === "topup" && (
          <>
            <label className={`${LABEL} mt-4 block`} htmlFor="sub-pack">{SUB_WORDING.packLabel}</label>
            <select id="sub-pack" value={pack} onChange={(e) => setPack(e.target.value)} className={`${INPUT} mt-1`}>
              {PACKS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </>
        )}

        <label className={`${LABEL} mt-4 block`} htmlFor="sub-reason">{SUB_WORDING.reasonLabel}</label>
        <input
          id="sub-reason"
          type="text"
          maxLength={200}
          autoComplete="off"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={SUB_WORDING.reasonPlaceholder}
          className={`${INPUT} mt-1`}
        />

        {action !== "cancel-grant" && (
          <>
            <label className={`${LABEL} mt-4 block`} htmlFor="sub-confirm">{typeLabel}</label>
            <input
              id="sub-confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typePlaceholder}
              className={`${INPUT} mt-1`}
            />
          </>
        )}

        {error && (
          <div className="mt-2">
            <ErrorLine text={error} />
          </div>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {SUB_WORDING.cancel}
          </button>
          <button
            type="button"
            data-sub-confirm
            disabled={!ok || busy}
            onClick={() => onSubmit({ tier, pack, expires, reason, typed })}
            className="min-h-11 flex-1 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "Saving…" : title}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionSection({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<OpsSubscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<SubAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  async function fetchSub() {
    setLoading(true);
    setError(null);
    try {
      setSub(await api.getOpsPersonSubscription(personId));
    } catch {
      setError(SUB_WORDING.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !sub) void fetchSub();
  }

  async function submit(v: { tier: string; pack: string; expires: string; reason: string; typed: string }) {
    if (!action) return;
    setBusy(true);
    setSheetError(null);
    try {
      const reason = v.reason.trim();
      if (action === "set-tier") {
        await api.setOpsPersonTier(personId, { tier: v.tier, confirm: v.typed.trim(), reason, ...(v.expires ? { expires_at: v.expires } : {}) });
      } else if (action === "topup") {
        await api.grantOpsPersonPack(personId, { pack_id: v.pack, confirm: v.typed.trim(), reason });
      } else if (action === "reset-trial") {
        await api.resetOpsPersonTrial(personId, { confirm: v.typed.trim(), reason });
      } else {
        await api.cancelOpsPersonGrant(personId, { reason });
      }
      setAction(null);
      await fetchSub();
    } catch (e) {
      setSheetError(e instanceof Error && e.message ? e.message : SUB_WORDING.applyFailed);
    } finally {
      setBusy(false);
    }
  }

  const guard = sub ? providerGuard(sub.live_provider) : null;
  const panelId = `sub-${personId.slice(0, 12)}`;
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/5" data-subscription-section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className={`${QUIET_BTN} ${open ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200" : ""}`}
      >
        {SUB_WORDING.section}
      </button>
      {open && (
        <div id={panelId} className="mt-3 space-y-4">
          {loading && !sub && <p className="text-xs text-slate-500 dark:text-slate-400">{SUB_WORDING.loading}</p>}
          {error && <ErrorLine text={error} />}
          {sub && (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Fact label="Plan" value={capitalise(sub.tier)} />
                <Fact label="Status" value={statusLabel(sub.status)} />
                <Fact label="Source" value={sourceLabel(sub.tier_source)} />
                <Fact label="Billing period" value={periodLabel(sub.billing_period)} />
                <Fact label="Provider" value={providerLabel(sub)} />
                <Fact label="Paid subscription" value={sub.has_paid_subscription ? "Yes" : "No"} />
                <Fact label="Trial" value={trialLabel(sub)} />
                <Fact label="Renewal" value={renewalLabel(sub)} />
                <Fact label="Manual grant" value={grantLabel(sub)} />
                <Fact label="Penny this month" value={pennyLabel(sub)} />
                <Fact label="MCP calls this month" value={mcpLabel(sub)} />
              </div>
              {sub.penny.packs.length > 0 && (
                <div>
                  <p className={LABEL}>Penny packs</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-800 dark:text-slate-100">
                    {sub.penny.packs.map((p, i) => (
                      <li key={i}>{packLabel(p)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {guard && <p className="text-sm font-medium text-slate-700 dark:text-slate-200" data-provider-guard>{guard}</p>}
              <div className="flex flex-wrap gap-2">
                {!guard && (
                  <button type="button" className={QUIET_BTN} onClick={() => { setSheetError(null); setAction("set-tier"); }}>
                    {SUB_WORDING.setTier}
                  </button>
                )}
                <button type="button" className={QUIET_BTN} onClick={() => { setSheetError(null); setAction("topup"); }}>
                  {SUB_WORDING.grantPack}
                </button>
                {sub.can_reset_trial && (
                  <button type="button" className={QUIET_BTN} onClick={() => { setSheetError(null); setAction("reset-trial"); }}>
                    {SUB_WORDING.resetTrial}
                  </button>
                )}
                {sub.manual_grant && (
                  <button type="button" className={QUIET_BTN} onClick={() => { setSheetError(null); setAction("cancel-grant"); }}>
                    {SUB_WORDING.cancelGrant}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {action && sub && (
        <ActionSheet
          action={action}
          sub={sub}
          busy={busy}
          error={sheetError}
          onCancel={() => setAction(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
