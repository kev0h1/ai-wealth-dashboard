"use client";

import { useState } from "react";

// D9: where an invited tester who signed in with Apple's Hide My Email lands
// instead of a dead end. Apple handed us a private relay address that nobody
// could have put on the invite list, so there are two ways forward: sign in
// with the provider the invite was sent to and add Apple from Settings, or
// enter the invited address and confirm it with a code sent there.
// Presentational: the caller supplies the network actions.

export interface RelayClaimScreenProps {
  prompt: string;
  onSend: (email: string) => Promise<"sent" | "limited" | "failed">;
  onVerify: (email: string, code: string) => Promise<"ok" | "invalid" | "locked" | "failed">;
  onVerified: () => void;
  onBack: () => void;
}

const FIELD =
  "w-full py-3 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100";
const PRIMARY =
  "w-full py-3.5 px-4 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 active:scale-95 transition font-medium text-sm disabled:opacity-60";
const SECONDARY =
  "w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 active:scale-95 transition font-medium text-slate-700 dark:text-slate-100 text-sm shadow-sm";

export default function RelayClaimScreen({ prompt, onSend, onVerify, onVerified, onBack }: RelayClaimScreenProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await onSend(email.trim());
    setBusy(false);
    if (r === "sent") setStep("code");
    else setMessage(r === "limited" ? "Too many tries. Wait a few minutes and try again." : "We could not send that. Check your connection and try again.");
  }

  async function verify() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await onVerify(email.trim(), code.trim());
    setBusy(false);
    if (r === "ok") onVerified();
    else if (r === "locked") setMessage("Too many wrong codes. Go back and ask for a new one.");
    else if (r === "invalid") setMessage("That code did not work. Check it, or ask for a new one.");
    else setMessage("We could not check that. Check your connection and try again.");
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-6" data-testid="relay-claim">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mb-3">
            Confirm your invitation
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            You chose to hide your email, so we cannot see which address your invitation went to. Enter that address and we will send you a code.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm p-6 space-y-3">
          {step === "email" ? (
            <>
              <label htmlFor="relay-claim-email" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Invited email address
              </label>
              <input
                id="relay-claim-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD}
              />
              <button type="button" onClick={send} disabled={busy || !email.trim()} className={PRIMARY}>
                {busy ? "Sending" : "Send me a code"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                If that address is on the list, a code is on its way. Enter it below.
              </p>
              <label htmlFor="relay-claim-code" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Code
              </label>
              <input
                id="relay-claim-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={FIELD}
              />
              <button type="button" onClick={verify} disabled={busy || !code.trim()} className={PRIMARY}>
                {busy ? "Checking" : "Confirm"}
              </button>
              <button type="button" onClick={() => { setStep("email"); setCode(""); setMessage(null); }} className={SECONDARY}>
                Use a different address
              </button>
            </>
          )}
          {message && (
            <p role="alert" className="text-sm text-slate-700 dark:text-slate-200 text-center">
              {message}
            </p>
          )}
        </div>

        {prompt && (
          <p className="mt-5 px-2 text-center text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{prompt}</p>
        )}
        <button type="button" onClick={onBack} className={`${SECONDARY} mt-5`}>
          Back to sign in
        </button>
      </div>
    </div>
  );
}
