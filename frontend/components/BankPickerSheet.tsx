"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { X, Search, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { api, ApiError, resolveApiAsset } from "@/lib/api";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";
import { LEGACY_BANK_SUBTITLE } from "@/lib/legacyBankProvider";
import { SheetFrame } from "@/components/SheetFrame";
import BankConnectionFlow from "@/components/bank-connect/BankConnectionFlow";
import { isNativePlatform } from "@/lib/nativeAuth";
import { DEEP_LINK_EVENT, type DeepLinkDetail } from "@/lib/deepLinks";
import { registerBankSheet } from "@/lib/bankConnectReturn";
import { useBankReturnReset } from "@/lib/useBankReturnReset";
import { launchMode, buildLinkQuery } from "@/lib/bankConsentLaunch";

const BANK_FAILED = "The bank connection didn’t complete. Try again.";

export interface Bank {
  id: string;
  name: string;
  logo: string;
}

/** Archived A155 exploration and legacy picker placements. Finexer production
 *  now uses the approved G review step in BankConnectionFlow. "footer" is the
 *  earlier pinned five-line footer; "list-end" puts the full sentence as the last
 *  row of the scrolling list with a short pinned line and a Full notice jump;
 *  "expandable" pins one compact line that opens in place to the full sentence;
 *  "header" sets the full sentence in the sheet header under the description. */
export type DisclosurePlacement = "footer" | "list-end" | "expandable" | "header";

const DISCLOSURE_ID = "bank-picker-disclosure";
const SOURCE_LINE = "Secure open banking · Powered by Finexer";
const CAPTION_INK = "text-xs leading-5 text-slate-600 dark:text-slate-300";

interface BankPickerSheetProps {
  onClose: () => void;
  /** Called when handoff starts on web/RN, or after a successful native return. */
  onConnecting?: () => void;
  /** Which provider's bank list + connect link to use. Defaults to Finexer,
   *  the only provider production has (A67). "legacy" is the UAT-only
   *  provider described in `lib/legacyBankProvider.ts`; it is absent from a
   *  production build, so a caller may only pass it behind
   *  LEGACY_BANK_AVAILABLE. */
  provider?: "finexer" | "legacy";
  /** Mid-flow callers (Onboarding): an ok return from the in-app browser must not
   *  navigate to Accounts; the caller carries on its own flow. */
  stayOnReturn?: boolean;
  /** Earlier design previews and legacy provider only. */
  disclosurePlacement?: DisclosurePlacement;
  /** A155: a fixed 44px search field in every state (clear button inside the
   *  field, no layout shift) that stays pinned under the sheet header while the
   *  list scrolls. Used by the earlier design previews, not the G flow. */
  stickySearch?: boolean;
  /** Design previews only: render these banks instead of fetching the list. */
  banksOverride?: Bank[];
  /** Design previews only: seed the search text. */
  initialQuery?: string;
  /** Design previews only: open the expandable disclosure on first render. */
  initiallyExpanded?: boolean;
}

/** The sheet description, with the sentence set in it for the "header" placement. */
export function pickerDescription(provider: "finexer" | "legacy", placement: DisclosurePlacement): ReactNode {
  const line = provider === "legacy" ? LEGACY_BANK_SUBTITLE : SOURCE_LINE;
  if (placement !== "header") return line;
  return <>{line}<span className={`mt-2 block ${CAPTION_INK}`}>{AGENT_DISCLOSURE}</span></>;
}

function ExpandableDisclosure({ initiallyExpanded = false }: { initiallyExpanded?: boolean }) {
  const [open, setOpen] = useState(initiallyExpanded);
  const regionId = "bank-picker-disclosure-region";
  return <div>
    <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(o => !o)}
      className={`flex w-full items-center justify-between gap-3 text-left font-medium ${CAPTION_INK} focus-visible:outline-2 focus-visible:outline-indigo-500`}>
      <span>Regulated by the FCA through Finexer LTD</span>
      <ChevronDown size={16} aria-hidden="true" className={`flex-shrink-0 text-slate-500 dark:text-slate-300 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    <p id={regionId} hidden={!open} className={`pb-1 ${CAPTION_INK}`}>{AGENT_DISCLOSURE}</p>
  </div>;
}

/** The sheet footer for a placement, or undefined when the footer is freed. */
export function pickerFooter(placement: DisclosurePlacement, initiallyExpanded = false): ReactNode {
  if (placement === "footer") {
    return <p className="max-h-28 overflow-y-auto overscroll-contain text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">{AGENT_DISCLOSURE}</p>;
  }
  if (placement === "list-end") {
    return <button type="button" onClick={() => {
      const note = document.getElementById(DISCLOSURE_ID);
      note?.scrollIntoView({ block: "end" });
      note?.focus({ preventScroll: true });
    }} className={`flex w-full items-center justify-between gap-3 text-left ${CAPTION_INK} focus-visible:outline-2 focus-visible:outline-indigo-500`}>
      <span className="text-balance">Provided by Finexer LTD. AURIQ LTD acts as its agent.</span>
      <span className="flex-shrink-0 font-semibold text-indigo-700 dark:text-indigo-300">Full notice</span>
    </button>;
  }
  if (placement === "expandable") return <ExpandableDisclosure initiallyExpanded={initiallyExpanded} />;
  return undefined;
}
export default function BankPickerSheet({ onClose, onConnecting, provider = "finexer", stayOnReturn = false, disclosurePlacement = "footer", stickySearch = false, banksOverride, initialQuery = "", initiallyExpanded = false }: BankPickerSheetProps) {
  const [banks, setBanks] = useState<Bank[]>(banksOverride ?? []);
  const [loading, setLoading] = useState(!banksOverride);
  const [query, setQuery] = useState(initialQuery);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const connectingRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onConnectingRef = useRef(onConnecting);
  onConnectingRef.current = onConnecting;
  function updateConnecting(value: string | null) {
    connectingRef.current = value;
    setConnecting(value);
  }

  // A149: coming back without a completed consent (Back, the in-app browser's X,
  // a swipe back) clears the connecting state like Cancel, with no error.
  const bankReturn = useBankReturnReset(() => updateConnecting(null));

  // A108: while the in-app browser is open the sheet waits for the hand-off
  // deep link. A return closes the sheet, a failure keeps it open with a
  // message, and dismissing the browser without a return just clears the spinner.
  useEffect(() => {
    const unregister = registerBankSheet({ stayOnReturn });
    const onLink = (e: Event) => {
      const d = (e as CustomEvent<DeepLinkDetail>).detail;
      if (d?.kind !== "bank_connected") return;
      if (d.status === "error") {
        updateConnecting(null);
        setError(BANK_FAILED);
        return;
      }
      onConnectingRef.current?.();
      (closeRef.current ?? onCloseRef.current)();
    };
    window.addEventListener(DEEP_LINK_EVENT, onLink);
    return () => {
      unregister();
      window.removeEventListener(DEEP_LINK_EVENT, onLink);
    };
  }, []);

  // A155: focus the search on open only where no software keyboard can pop up
  // unasked (a wide viewport with a fine pointer, never the native app).
  useEffect(() => {
    if (!stickySearch || isNativePlatform()) return;
    if (window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) searchRef.current?.focus({ preventScroll: true });
  }, [stickySearch]);

  useEffect(() => {
    if (banksOverride) return;
    let active = true;
    const fetchProviders = provider === "legacy" ? api.legacyBankProviders() : api.finexerProviders();
    fetchProviders
      .then(list => { if (active) setBanks([...list].sort((a, b) => a.name.localeCompare(b.name))); })
      .catch(() => { if (active) setLoadError("We could not load the bank list. Please try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [provider, banksOverride, loadAttempt]);

  function retryBanks() {
    setLoading(true);
    setLoadError(null);
    setLoadAttempt(attempt => attempt + 1);
  }

  const filtered = query.trim()
    ? banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase()))
    : banks;

  async function handleSelect(bank: Bank, close: () => void) {
    // Archived fixtures must never create a live connection. Approved G's
    // preview uses BankConnectionFlow directly with a separate inert transport.
    if (banksOverride) { setError("Preview only. No connection starts."); return; }
    if (connectingRef.current) return;
    updateConnecting(bank.id);
    setError(null);
    bankReturn.begin();
    closeRef.current = close;
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage(s: string): void } }).ReactNativeWebView;
    const mode = launchMode(isNativePlatform(), !!rn);
    const { native } = buildLinkQuery(mode === "browser");
    try {
      const { auth_url } = provider === "legacy"
        ? await api.legacyBankConnectLink(bank.id, native)
        : await api.finexerConnectLink(bank.id, native);
      if (mode === "browser") {
        // A108: the in-app browser (Custom Tab / SFSafariViewController), not
        // full Chrome and not a WebView; the hand-off page returns by deep link.
        // The sheet stays mounted so its deep-link and browserFinished listeners
        // live; the connecting callback fires only from the ok return handler above.
        // A139: destructure and call inline, never return the plugin proxy.
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: auth_url });
      } else if (mode === "rn") {
        // React Native WebView: external browser so bank apps (e.g. Starling) work.
        onConnecting?.();
        rn!.postMessage(JSON.stringify({ type: "open_external", url: auth_url }));
        close();
      } else {
        onConnecting?.();
        window.location.href = auth_url;
      }
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 402
        ? err.message
        : "Failed to connect. Please try again.";
      setError(msg);
      bankReturn.end();
      updateConnecting(null);
    }
  }

  if (provider === "finexer" && !banksOverride) return <BankConnectionFlow
    banks={banks} loading={loading} loadError={loadError} connectionError={error} connecting={connecting}
    onRetry={retryBanks} onConnect={handleSelect} onClose={onClose} />;

  return <SheetFrame
    title="Add a Bank"
    description={pickerDescription(provider, disclosurePlacement)}
    onClose={onClose}
    bodyClassName="px-0 py-0"
    footer={pickerFooter(disclosurePlacement, initiallyExpanded)}
  >
    {({ close }) => <BankPickerBody
      query={query} setQuery={setQuery} searchRef={searchRef} error={error ?? loadError} loading={loading}
      filtered={filtered} connecting={connecting} onSelect={bank => handleSelect(bank, close)}
      stickySearch={stickySearch} disclosurePlacement={disclosurePlacement} />}
  </SheetFrame>;
}

interface BankPickerBodyProps {
  query: string;
  setQuery: (q: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  error: string | null;
  loading: boolean;
  filtered: Bank[];
  connecting: string | null;
  onSelect: (bank: Bank) => void;
  stickySearch: boolean;
  disclosurePlacement: DisclosurePlacement;
}

/** The sheet body: search, error line, bank list, and the list-end sentence. Exported so the check can render it without the portal. */
export function BankPickerBody({ query, setQuery, searchRef, error, loading, filtered, connecting, onSelect, stickySearch, disclosurePlacement }: BankPickerBodyProps) {
  return <>
      {stickySearch ? (
        <div data-bank-search="sticky" className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 pb-3 pt-3 dark:border-slate-700 dark:bg-slate-900">
          <div data-bank-search-field className="relative h-11 rounded-2xl bg-slate-100 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-700">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-300" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your bank…"
              aria-label="Search your bank"
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              className="block h-11 w-full appearance-none rounded-2xl bg-transparent py-0 pl-10 pr-11 text-base leading-6 text-slate-800 outline-none placeholder:text-slate-600 dark:text-slate-100 dark:placeholder:text-slate-300 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" data-compact aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus({ preventScroll: true }); }}
                className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-2xl text-slate-600 active:text-slate-800 dark:text-slate-300 dark:active:text-slate-100">
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      ) : (
      <div className="px-5 pb-3 pt-4">
          <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-700 rounded-2xl px-3.5 py-2.5">
            <Search size={15} className="text-slate-400 flex-shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your bank…"
              type="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-slate-400 active:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
      </div>
      )}

        {error && (
          <p className="px-5 pb-2 text-[12px] font-semibold text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Bank list */}
        <div className="px-3 pb-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-400 dark:text-slate-500 py-10">
              {query ? `No banks matching "${query}"` : "No banks available"}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(bank => (
                <button
                  key={bank.id}
                  onClick={() => onSelect(bank)}
                  disabled={connecting !== null}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/60 active:bg-slate-100 dark:active:bg-slate-700 transition-colors disabled:opacity-50 text-left"
                >
                  {/* Logo */}
                  <div className="w-10 h-10 rounded-xl border border-slate-100 dark:border-slate-700 bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {bank.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveApiAsset(bank.logo)}
                        alt={bank.name}
                        className="w-8 h-8 object-contain"
                      />
                    ) : (
                      <span className="text-sm font-bold text-indigo-500">
                        {bank.name[0]}
                      </span>
                    )}
                  </div>

                  {/* Name */}
                  <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                    {bank.name}
                  </span>

                  {/* Indicator */}
                  {connecting === bank.id ? (
                    <Loader2 size={16} className="animate-spin text-indigo-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
      </div>
      {disclosurePlacement === "list-end" && (
        <p id={DISCLOSURE_ID} tabIndex={-1} className={`mx-5 mb-5 border-t border-slate-100 pt-4 outline-none dark:border-slate-700 ${CAPTION_INK}`}>{AGENT_DISCLOSURE}</p>
      )}
  </>;
}
