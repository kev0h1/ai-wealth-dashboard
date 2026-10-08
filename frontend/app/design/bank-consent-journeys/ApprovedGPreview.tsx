"use client";

import { useRef, useState } from "react";
import type { Bank } from "@/components/BankPickerSheet";
import BankConnectionFlow from "@/components/bank-connect/BankConnectionFlow";
import { primary, quiet } from "@/components/bank-connect/BankConnectionParts";
import { useBankReturnReset } from "@/lib/useBankReturnReset";
import HostedConsentPreview from "./HostedConsentPreview";

/** The approved screens are the production flow with fixture-only operations.
 * The provider illustration is a separate page, just as real consent leaves
 * Sorted. It never creates a second sheet over the production picker. */
export default function ApprovedGPreview({ banks, mode, initialState, onClose }: {
  banks: Bank[]; mode: "light" | "dark"; initialState: string; onClose(): void;
}) {
  const [stage, setStage] = useState<"sorted" | "provider" | "end">("sorted");
  const [bank, setBank] = useState<Bank | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(initialState === "load-error" ? "We could not load the bank list. Please try again." : null);
  const [loading, setLoading] = useState(initialState === "loading");
  // A149: the production reset hook. "returned" simulates the user pressing Back
  // from Finexer without consenting, 2.2s after Continue: the button re-enables, no error.
  const bankReturn = useBankReturnReset(() => setConnecting(null));
  const handoff = useRef(false);
  const failedOnce = useRef(false);
  return <main className="min-h-dvh bg-[#f0f2f7] px-5 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <div className="mx-auto max-w-lg">
      <button type="button" className={`${quiet} -ml-3`} onClick={onClose}>Compare journeys</button>
      <h1 className="mt-5 text-xl font-bold">{stage === "sorted" ? "G · Bank first" : stage === "provider" ? "Finexer consent" : "Next, your bank"}</h1>
      <p className="mb-5 mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Approved production screens with fixture banks. No connection starts.</p>
      {stage === "provider" && <HostedConsentPreview mode={mode} disclosureAtProvider={false} bankName={bank?.name ?? "your bank"}
        onBack={() => { handoff.current = false; setStage("sorted"); }} onContinue={() => setStage("end")} />}
      {stage === "end" && <><p className="text-sm leading-6">Your bank would ask you to approve access, then return you to Sorted. No bank has been connected. No permission has been given.</p><button type="button" className={`${primary} mt-6`} onClick={onClose}>Back to journeys</button></>}
      {stage === "sorted" && <BankConnectionFlow banks={initialState === "empty" ? [] : banks} loading={loading} loadError={loadError}
        connectionError={connectionError} connecting={connecting}
        initialQuery={initialState === "noresults" ? "zzq" : ""}
        onRetry={() => { setLoadError(null); setLoading(false); }}
        onConnect={(chosen, close) => {
          if (initialState === "pending") { setConnecting(chosen.id); return; }
          if (initialState === "returned") { setConnecting(chosen.id); bankReturn.begin(); window.setTimeout(() => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })), 2200); return; }
          if (initialState === "error" && !failedOnce.current) {
            failedOnce.current = true;
            setConnectionError("Finexer did not open. Please try again. Preview only: no request was sent.");
            return;
          }
          setConnectionError(null); setBank(chosen); handoff.current = true; close();
        }}
        onClose={() => { if (handoff.current) { setStage("provider"); window.scrollTo(0, 0); } else onClose(); }} />}
    </div>
  </main>;
}
