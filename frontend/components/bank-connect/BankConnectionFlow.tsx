"use client";

import { useEffect, useRef, useState } from "react";
import type { Bank } from "@/components/BankPickerSheet";
import UpcomingFlowSheet from "@/components/UpcomingFlowSheet";
import { BankSearch, BankResults, ChosenBank, ConnectionNotice, ContinueAction } from "./BankConnectionParts";

export interface BankConnectionFlowProps {
  banks: Bank[];
  loading: boolean;
  loadError: string | null;
  connectionError: string | null;
  connecting: string | null;
  onRetry(): void;
  onConnect(bank: Bank, close: () => void): void;
  onClose(): void;
  initialQuery?: string;
  /** B60: open on the review step for the one listed bank whose name matches (case-insensitive). */
  preselectName?: string;
}

/** The single bank whose name matches `name`, exact first, else a unique substring; null otherwise. */
export function matchBank(banks: Bank[], name: string | undefined): Bank | null {
  const wanted = (name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const exact = banks.filter(b => b.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const partial = banks.filter(b => b.name.toLowerCase().includes(wanted));
  return partial.length === 1 ? partial[0] : null;
}

/** Approved A155 G. Bank selection only opens the review. The supplied
 * transport cannot run until Continue to Finexer is explicitly pressed.
 * The same component is rendered with inert transport in the design preview. */
export default function BankConnectionFlow({ banks, loading, loadError, connectionError, connecting, onRetry, onConnect, onClose, initialQuery = "", preselectName }: BankConnectionFlowProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Bank | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pending = connecting !== null;
  const navRef = useRef<{ goTo(view: "choose" | "review"): void } | null>(null);
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || loading || !preselectName) return;
    const bank = matchBank(banks, preselectName);
    if (!bank || !navRef.current) return;
    preselected.current = true;
    setSelected(bank);
    navRef.current.goTo("review");
  }, [banks, loading, preselectName]);
  return <UpcomingFlowSheet<"choose" | "review"> initialView="choose" onClose={onClose} renderView={(view, navigation) => {
    navRef.current = navigation;
    if (view === "choose" || !selected) return {
      title: "Choose your bank",
      subtitle: "Start with the bank you want to add to Sorted.",
      bodyHeader: <BankSearch query={query} setQuery={setQuery} searchRef={searchRef} />,
      bodyClassName: "px-5 py-0",
      body: <BankResults banks={banks} query={query} setQuery={setQuery} searchRef={searchRef}
        selected={selected} disabled={pending} loading={loading} error={loadError} onRetry={onRetry}
        onChoose={bank => { setSelected(bank); navigation.goTo("review"); }} />,
      footer: <p className="text-xs leading-5 text-slate-600 dark:text-slate-300" role={pending ? "status" : undefined}>{pending ? "Opening Finexer…" : "Next: review how this connection works."}</p>,
    };
    return {
      title: "Review your connection",
      subtitle: "Understand what you are connecting before you continue.",
      body: <>
        <ChosenBank bank={selected} onChange={navigation.back} disabled={pending} />
        <ConnectionNotice />
      </>,
      footer: <>
        {connectionError && <p role="alert" className="mb-3 text-sm leading-5 text-slate-700 dark:text-slate-200">{connectionError}</p>}
        <ContinueAction pending={pending} onContinue={() => onConnect(selected, navigation.close)} />
      </>,
    };
  }} />;
}
