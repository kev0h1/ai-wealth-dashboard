"use client";

import { useEffect, useState } from "react";
import {
  DEMO_FAILED_MESSAGE, DEMO_LIMITED_MESSAGE, DEMO_UNREACHABLE_MESSAGE,
  demoLogin, fetchDemoEnabled,
} from "@/lib/demoLogin";

// C43: a low-key "Demo sign-in" for Apple App Review. Renders nothing unless
// the backend says it is switched on. Existing input and button styles only.

const INPUT =
  "w-full min-h-[44px] rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400";
const PRIMARY =
  "w-full min-h-[44px] py-3 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 active:scale-95 transition font-medium text-slate-700 dark:text-slate-100 text-sm shadow-sm disabled:opacity-60";

export interface DemoSignInViewProps {
  enabled: boolean;
  open: boolean;
  email: string;
  password: string;
  busy: boolean;
  message: string | null;
  onToggle: () => void;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: () => void;
}

export function DemoSignInView(p: DemoSignInViewProps) {
  if (!p.enabled) return null;
  return (
    <div className="mt-5 text-center">
      <button
        type="button"
        onClick={p.onToggle}
        aria-expanded={p.open}
        aria-controls="demo-signin-form"
        className="min-h-[44px] px-3 text-sm font-medium text-slate-600 dark:text-slate-400 underline underline-offset-2"
      >
        Demo sign-in
      </button>
      {p.open && (
        <form
          id="demo-signin-form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); p.onSubmit(); }}
          className="mt-2 space-y-3 text-left"
        >
          <div>
            <label htmlFor="demo-email" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Email</label>
            <input
              id="demo-email" name="username" type="email" inputMode="email" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={p.email} onChange={(e) => p.onEmail(e.target.value)} className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="demo-password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Password</label>
            <input
              id="demo-password" name="password" type="password" autoComplete="current-password"
              value={p.password} onChange={(e) => p.onPassword(e.target.value)} className={INPUT}
            />
          </div>
          <div role="alert" aria-live="assertive">
            {p.message && <p className="text-sm text-slate-700 dark:text-slate-200">{p.message}</p>}
          </div>
          <button type="submit" disabled={p.busy || !p.email || !p.password} className={PRIMARY}>
            {p.busy ? "Signing in" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}

interface DemoSignInProps {
  // The host's post-login flow (the same one Google and Apple use).
  onSignedIn: () => Promise<"ok" | "rejected" | "unreachable">;
}

export default function DemoSignIn({ onSignedIn }: DemoSignInProps) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchDemoEnabled(ctrl.signal).then(setEnabled);
    return () => ctrl.abort();
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await demoLogin(email, password);
      if (result === "limited") return setMessage(DEMO_LIMITED_MESSAGE);
      if (result === "unreachable") return setMessage(DEMO_UNREACHABLE_MESSAGE);
      if (result !== "ok") return setMessage(DEMO_FAILED_MESSAGE);
      const outcome = await onSignedIn();
      if (outcome === "unreachable") setMessage(DEMO_UNREACHABLE_MESSAGE);
      else if (outcome === "rejected") setMessage(DEMO_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DemoSignInView
      enabled={enabled} open={open} email={email} password={password} busy={busy} message={message}
      onToggle={() => setOpen((v) => !v)} onEmail={setEmail} onPassword={setPassword} onSubmit={submit}
    />
  );
}
