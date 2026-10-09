"use client";

// Preview-only. A static, mocked stand-in for Finexer's hosted pages (the
// "Please wait" interstitial, NEXT and CONNECT) inside the native in-app
// browser chrome. No provider URL, no scripts, no requests.
import { LoaderCircle, X } from "lucide-react";
import { consentToolbarColor } from "@/lib/consentToolbar";
import { primary } from "@/components/bank-connect/BankConnectionParts";

export type FinexerStage = "wait" | "next" | "connect";

export default function MockFinexer({ stage, dark, bankName, onNext, onConnect, onClose }: {
  stage: FinexerStage; dark: boolean; bankName: string; onNext(): void; onConnect(): void; onClose(): void;
}) {
  const bar = consentToolbarColor(dark);
  return <div className="mx-auto flex min-h-dvh max-w-[500px] flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <div data-mock-toolbar style={{ background: bar }} className="flex min-h-12 items-center gap-2 px-2 text-slate-900 dark:text-slate-100">
      <button type="button" onClick={onClose} aria-label="Close and return to Sorted" className="flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X size={20} aria-hidden="true" /></button>
      <p className="text-sm font-medium">finexer.com</p>
    </div>
    <div className="flex-1 px-5 py-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Finexer hosted page, mocked</p>
      {stage === "wait" && <div role="status" className="flex flex-col items-center py-24 text-center"><LoaderCircle size={28} aria-hidden="true" className="animate-spin text-slate-600 motion-reduce:animate-none dark:text-slate-300" /><p className="mt-4 text-sm text-slate-700 dark:text-slate-200">Please wait…</p></div>}
      {stage === "next" && <>
        <h1 className="mt-3 text-xl font-bold">Share your account information</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">Sorted is asking Finexer for read-only access to account details, balances and transactions at {bankName}. This does not authorise a payment.</p>
        <button type="button" className={`${primary} mt-8`} onClick={onNext}>Next</button>
      </>}
      {stage === "connect" && <>
        <h1 className="mt-3 text-xl font-bold">Finexer terms</h1>
        <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">By choosing Connect you accept Finexer’s end user terms. Your bank then asks you to approve access.</p>
        <button type="button" className={`${primary} mt-8`} onClick={onConnect}>Connect</button>
      </>}
    </div>
  </div>;
}
