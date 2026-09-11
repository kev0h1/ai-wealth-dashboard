"use client";

// B20: private offer-broadcast composer. Gated the same way as
// /ops/go-live: the normal AuthProvider (this route is not in its /design,
// /terms, /privacy public-page exemption list) plus a server-side
// bot-or-owner check in backend/app/routers/broadcast.py (403s for anyone
// but the account owner or the bot identity).
//
// Two explicit steps, never one click to a fan-out: "Preview" resolves the
// audience and freezes it into a draft broadcast, showing the recipient
// COUNT before anything can be sent; "Send" is a separate action that only
// appears once a preview exists, and is itself gated behind a checked "I
// understand this reaches N people" box so the number is unmissable
// (DESIGN.md: colour is information, so this uses Adviser Indigo, not a
// danger-red button — the risk here is a mis-specified audience, which the
// recipient count already surfaces, not a destructive action).
//
// A "Send as a test (no one receives anything)" toggle drives dry_run on
// POST /admin/broadcast/{id}/send — the only way to exercise the send path
// without a real push ever leaving the server.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type BroadcastAudience, type BroadcastRecord } from "@/lib/api";

const TIER_LABELS: Record<"statements" | "lite" | "standard" | "connect" | "max", string> = {
  statements: "Statements",
  lite: "Lite",
  standard: "Standard",
  connect: "Connect",
  max: "Max",
};

const STATE_LABELS: Record<"penny_cap", string> = {
  penny_cap: "At the Penny message cap",
};

function audienceLabel(a: BroadcastAudience): string {
  if (a.type === "everyone") return "Everyone";
  if (a.type === "tier") return `Tier: ${TIER_LABELS[a.tier] ?? a.tier}`;
  return `State: ${STATE_LABELS[a.state] ?? a.state}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

type AudienceKind = "everyone" | "tier" | "state";

export default function BroadcastPage() {
  const [forbidden, setForbidden] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);

  const [title, setTitle] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [url, setUrl] = useState("/");
  const [audienceKind, setAudienceKind] = useState<AudienceKind>("everyone");
  const [tier, setTier] = useState<keyof typeof TIER_LABELS>("lite");
  const [state, setState] = useState<keyof typeof STATE_LABELS>("penny_cap");

  const [draft, setDraft] = useState<BroadcastRecord | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [confirmChecked, setConfirmChecked] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<BroadcastRecord | null>(null);

  const [history, setHistory] = useState<BroadcastRecord[]>([]);

  const loadHistory = useCallback(() => {
    api
      .listBroadcasts()
      .then((res) => setHistory(res.broadcasts))
      .catch(() => {
        /* history is best-effort, the composer itself doesn't depend on it */
      });
  }, []);

  // A cheap probe rather than a real payload: any owner-only GET works,
  // listBroadcasts() also seeds the history panel.
  useEffect(() => {
    api
      .listBroadcasts()
      .then((res) => {
        setHistory(res.broadcasts);
        setCheckedAuth(true);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setForbidden(true);
        setCheckedAuth(true);
      });
  }, []);

  function currentAudience(): BroadcastAudience {
    if (audienceKind === "tier") return { type: "tier", tier };
    if (audienceKind === "state") return { type: "state", state };
    return { type: "everyone" };
  }

  async function handlePreview() {
    setPreviewError(null);
    setPreviewing(true);
    setDraft(null);
    setSent(null);
    setConfirmChecked(false);
    try {
      const res = await api.previewBroadcast({
        title,
        body: messageBody,
        url: url || "/",
        audience: currentAudience(),
      });
      setDraft(res);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Could not resolve the audience");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSend() {
    if (!draft || !confirmChecked) return;
    setSendError(null);
    setSending(true);
    try {
      const res = await api.sendBroadcast(draft.id, dryRun);
      setSent(res);
      loadHistory();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (!checkedAuth) {
    return (
      <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a]">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-7 w-56 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-40 rounded-3xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f0f2f7] px-6 dark:bg-[#0f172a]">
        <p className="text-sm text-slate-500 dark:text-slate-400">This page is for the account owner.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f0f2f7] px-6 py-10 dark:bg-[#0f172a]">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link href="/ops/go-live" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            Back to go-live board
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Send an offer
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Compose the copy, preview who it reaches, then send. Preview and send are always two
            separate steps.
          </p>
        </div>

        {/* ── Compose ─────────────────────────────────────────────────── */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDraft(null);
              }}
              maxLength={60}
              placeholder="A new way to see your spending"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Message
            </label>
            <textarea
              value={messageBody}
              onChange={(e) => {
                setMessageBody(e.target.value);
                setDraft(null);
              }}
              maxLength={200}
              rows={4}
              placeholder="Describe the offer in plain language. No promises about timing, no dashes, no prices unless billing is live."
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Opens to (in-app link)
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setDraft(null);
              }}
              placeholder="/"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Audience
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["everyone", "tier", "state"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    setAudienceKind(kind);
                    setDraft(null);
                  }}
                  className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
                    audienceKind === kind
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {kind === "everyone" ? "Everyone" : kind === "tier" ? "By tier" : "By state"}
                </button>
              ))}
            </div>

            {audienceKind === "tier" && (
              <select
                value={tier}
                onChange={(e) => {
                  setTier(e.target.value as keyof typeof TIER_LABELS);
                  setDraft(null);
                }}
                className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {Object.entries(TIER_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            )}

            {audienceKind === "state" && (
              <select
                value={state}
                onChange={(e) => {
                  setState(e.target.value as keyof typeof STATE_LABELS);
                  setDraft(null);
                }}
                className="mt-3 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {Object.entries(STATE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {previewError && (
            <p className="text-sm text-amber-700 dark:text-amber-300">{previewError}</p>
          )}

          <button
            type="button"
            onClick={handlePreview}
            disabled={previewing || !title.trim() || !messageBody.trim()}
            className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
          >
            {previewing ? "Resolving audience..." : "Preview"}
          </button>
        </div>

        {/* ── Preview + confirm-and-send ──────────────────────────────── */}
        {draft && !sent && (
          <div className="glass-card rounded-2xl p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Preview
            </p>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{draft.title}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{draft.body}</p>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Opens {draft.url}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Reaches
              </p>
              <p className="money mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {draft.recipient_count} {draft.recipient_count === 1 ? "person" : "people"}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{audienceLabel(draft.audience)}</p>
              {draft.recipient_sample.length > 0 && (
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                  Sample: {draft.recipient_sample.join(", ")}
                  {draft.recipient_count > draft.recipient_sample.length ? "…" : ""}
                </p>
              )}
            </div>

            <label className="flex min-h-11 items-center gap-3 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-5 w-5 rounded border-slate-300"
              />
              Send as a test. No one receives anything, but the whole path runs.
            </label>

            <label className="flex min-h-11 items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-slate-300"
              />
              <span>
                I understand this reaches <strong className="tabular-nums">{draft.recipient_count}</strong>{" "}
                {draft.recipient_count === 1 ? "person" : "people"}
                {dryRun ? " (test mode: nobody actually receives it)" : ""}.
              </span>
            </label>

            {sendError && <p className="text-sm text-amber-700 dark:text-amber-300">{sendError}</p>}

            <button
              type="button"
              onClick={handleSend}
              disabled={!confirmChecked || sending}
              className="min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white active:scale-95 transition-transform disabled:opacity-50"
            >
              {sending ? "Sending..." : dryRun ? "Send test" : `Send to ${draft.recipient_count}`}
            </button>
          </div>
        )}

        {sent && (
          <div className="glass-card rounded-2xl p-5 space-y-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {sent.dry_run ? "Test run complete" : "Sent"}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {sent.results?.delivered ?? 0} delivered, {sent.results?.skipped_optout ?? 0} opted out,{" "}
              {sent.results?.skipped_already_sent ?? 0} already sent.
            </p>
          </div>
        )}

        {/* ── History ──────────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Recent broadcasts
            </p>
            {history.map((b) => (
              <div key={b.id} className="glass-card rounded-2xl p-4">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{b.title}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {audienceLabel(b.audience)} · {b.status}
                  {b.status === "sent" ? ` · ${b.results?.delivered ?? 0} delivered` : ""}
                  {b.dry_run ? " · test" : ""}
                </p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  {b.sent_at ? formatDate(b.sent_at) : formatDate(b.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
