"use client";

// A6.2A GATE: a reconfirmation shown in our own interface is itself a consent
// screen, so Finexer's written approval of this exact wording is required
// before FINEXER_RECONFIRM_PROMPT_ENABLED is switched on (default off; the
// server then never marks a connection reconfirm_prompt, so this renders
// nothing). A6.3 fallback: Finexer may require its hosted reconfirmation
// instead, which needs no approval from us.
//
// A182: a gentle in-app question before a bank consent's 90-day reconfirmation
// falls due. One tap writes renewed_at at Finexer (no bank login, the consent's
// end date is never extended). Dismissible until the due day. Quiet strip, same
// family as ReconnectStrip: a plain glass card, no amber and no red, because
// this is routine housekeeping and not a risk (DESIGN.md, Red Is Risk Rule).

import { useState } from "react";
import type { Connection } from "@wealth/shared";
import { api } from "@/lib/api";
import {
  RECONFIRM_BUTTON, RECONFIRM_DISMISS_LABEL, RECONFIRM_ERROR,
  pickReconfirmConnection, reconfirmDismissKey, reconfirmQuestion,
} from "@/lib/reconfirm";

interface Props {
  connections: Connection[];
  /** Bank display name for a consent (from its accounts). */
  bankNameFor: (connection: Connection) => string | undefined;
}

function readDismissed(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export default function ReconfirmPrompt({ connections, bankNameFor }: Props) {
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  void tick;

  const live = connections.filter((c) => !done.has(c.connection_id));
  const target = pickReconfirmConnection(live, readDismissed);
  if (!target) return null;
  const question = reconfirmQuestion(bankNameFor(target));

  async function submitReconfirm(c: Connection) {
    setBusy(true);
    setError(false);
    try {
      await api.finexerReconfirm(c.connection_id);
      setDone((prev) => new Set(prev).add(c.connection_id));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function dismiss(c: Connection) {
    try {
      if (c.next_reconfirm_by) window.localStorage.setItem(reconfirmDismissKey(c.connection_id), c.next_reconfirm_by);
    } catch { /* storage unavailable: the prompt simply returns next visit */ }
    setError(false);
    setTick((n) => n + 1);
  }

  return (
    <div className="glass-card rounded-2xl p-4" role="group" aria-label="Bank access check">
      <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{question}</p>
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-slate-600 dark:text-slate-300">{RECONFIRM_ERROR}</p>
      )}
      <div className="mt-2 flex items-center gap-2 -mb-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submitReconfirm(target)}
          className="min-h-[44px] flex items-center px-2 text-[13px] font-semibold text-indigo-600 dark:text-indigo-400 active:opacity-70 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
        >
          {RECONFIRM_BUTTON}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dismiss(target)}
          className="min-h-[44px] flex items-center px-2 text-[13px] font-medium text-slate-500 dark:text-slate-400 active:opacity-70 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
        >
          {RECONFIRM_DISMISS_LABEL}
        </button>
      </div>
    </div>
  );
}
