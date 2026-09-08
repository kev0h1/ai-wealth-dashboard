"use client";

// D5: sign-up allow list managed in the app instead of the ALLOWED_EMAILS
// env var + a Railway redeploy. Backend: app/routers/admin_allowlist.py
// (bot-or-owner gate, same pairing as GET /ops/go-live's own owner check).
// Every write (invite/revoke) returns the full refreshed list, same
// "re-render from truth" convention page.tsx's item/question actions use.

import { useState } from "react";
import { api, type AllowlistEntry, type AllowlistResponse } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function AllowlistRow({
  entry,
  pending,
  onRevoke,
}: {
  entry: AllowlistEntry;
  pending: boolean;
  onRevoke: () => void;
}) {
  return (
    <div className="glass-card flex items-center justify-between gap-3 rounded-2xl p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{entry.email}</p>
        <p className="num mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
          Invited {formatDate(entry.created_at)}
          {entry.note ? ` · ${entry.note}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={pending}
        className="min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
      >
        Revoke
      </button>
    </div>
  );
}

export function AllowlistSection({
  data,
  onChange,
}: {
  data: AllowlistResponse;
  onChange: (next: AllowlistResponse) => void;
}) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    setInviteError(null);
    try {
      const next = await api.addAllowlist(trimmed, note.trim() || undefined);
      onChange(next);
      setEmail("");
      setNote("");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn't send the invite, try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(key: string) {
    setPendingKey(key);
    setActionError(null);
    try {
      const next = await api.revokeAllowlist(key);
      onChange(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't revoke, try again.");
    } finally {
      setPendingKey(null);
      setConfirmKey(null);
    }
  }

  const confirmEntry = data.invited.find((entry) => entry.key === confirmKey) ?? null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">Allowlist</span>
        <span className="num text-xs font-semibold normal-case text-slate-400 dark:text-slate-500">
          {data.invited.length} invited
        </span>
      </div>

      <form onSubmit={handleInvite} className="glass-card mb-3 rounded-2xl p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            required
            className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="min-h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {inviting ? "Inviting…" : "Invite"}
          </button>
        </div>
        {inviteError && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{inviteError}</p>}
      </form>

      {actionError && <p className="mb-2 text-xs font-semibold text-red-600 dark:text-red-400">{actionError}</p>}

      <div className="space-y-2">
        {data.invited.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No one invited yet.</p>
        ) : (
          data.invited.map((entry) => (
            <AllowlistRow
              key={entry.key}
              entry={entry}
              pending={pendingKey === entry.key}
              onRevoke={() => setConfirmKey(entry.key)}
            />
          ))
        )}
      </div>

      {data.env_seeded.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            From the env allow list
          </p>
          <div className="flex flex-wrap gap-2">
            {data.env_seeded.map((addr) => (
              <span
                key={addr}
                className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-white/5 dark:text-slate-400"
              >
                {addr}
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-slate-400">
                  from env
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmEntry !== null}
        title="Revoke access?"
        message={confirmEntry ? `${confirmEntry.email} will no longer be able to sign in.` : ""}
        confirmLabel="Revoke"
        destructive
        confirmDisabled={pendingKey !== null}
        onConfirm={() => confirmEntry && handleRevoke(confirmEntry.key)}
        onCancel={() => setConfirmKey(null)}
      />
    </section>
  );
}
