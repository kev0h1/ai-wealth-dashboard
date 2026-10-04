"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, ChevronRight, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AGENT_DISCLOSURE } from "@/lib/regulatoryCopy";
import { LEGACY_BANK_SUBTITLE } from "@/lib/legacyBankProvider";
import { SheetFrame } from "@/components/SheetFrame";
import { isNativePlatform } from "@/lib/nativeAuth";
import { DEEP_LINK_EVENT, type DeepLinkDetail } from "@/lib/deepLinks";
import { registerBankSheet } from "@/lib/bankConnectReturn";
import { launchMode, buildLinkQuery } from "@/lib/bankConsentLaunch";

const BANK_FAILED = "The bank connection didn’t complete. Try again.";

interface Bank {
  id: string;
  name: string;
  logo: string;
}

interface BankPickerSheetProps {
  onClose: () => void;
  /** Called the moment a bank is selected and OAuth is about to open. */
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
}

export default function BankPickerSheet({ onClose, onConnecting, provider = "finexer", stayOnReturn = false }: BankPickerSheetProps) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onConnectingRef = useRef(onConnecting);
  onConnectingRef.current = onConnecting;

  // A108: while the in-app browser is open the sheet waits for the hand-off
  // deep link. A return closes the sheet, a failure keeps it open with a
  // message, and dismissing the browser without a return just clears the spinner.
  useEffect(() => {
    const unregister = registerBankSheet({ stayOnReturn });
    const onLink = (e: Event) => {
      const d = (e as CustomEvent<DeepLinkDetail>).detail;
      if (d?.kind !== "bank_connected") return;
      if (d.status === "error") {
        setConnecting(null);
        setError(BANK_FAILED);
        return;
      }
      onConnectingRef.current?.();
      (closeRef.current ?? onCloseRef.current)();
    };
    window.addEventListener(DEEP_LINK_EVENT, onLink);
    let removeBrowser: (() => void) | null = null;
    let disposed = false;
    if (isNativePlatform()) {
      // A139: destructure and call inline, never return the plugin proxy from an async function.
      void import("@capacitor/browser").then(({ Browser }) =>
        Browser.addListener("browserFinished", () => setConnecting(null)),
      ).then((h) => {
        if (disposed) void h.remove();
        else removeBrowser = () => void h.remove();
      }).catch(() => {});
    }
    return () => {
      disposed = true;
      unregister();
      window.removeEventListener(DEEP_LINK_EVENT, onLink);
      removeBrowser?.();
    };
  }, []);

  useEffect(() => {
    const fetchProviders = provider === "legacy" ? api.legacyBankProviders() : api.finexerProviders();
    fetchProviders
      .then(list => setBanks([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setError("Failed to load banks"))
      .finally(() => setLoading(false));
  }, [provider]);

  const filtered = query.trim()
    ? banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase()))
    : banks;

  async function handleSelect(bank: Bank, close: () => void) {
    setConnecting(bank.id);
    setError(null);
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
      setConnecting(null);
    }
  }

  return <SheetFrame
    title="Add a Bank"
    description={provider === "legacy" ? LEGACY_BANK_SUBTITLE : "Secure open banking · Powered by Finexer"}
    onClose={onClose}
    bodyClassName="px-0 py-0"
    footer={<p className="text-center text-xs leading-relaxed text-slate-400 dark:text-slate-500">{AGENT_DISCLOSURE}</p>}
  >
    {({ close }) => <>
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

        {error && (
          <p className="px-5 pb-2 text-xs text-red-500">{error}</p>
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
                  onClick={() => handleSelect(bank, close)}
                  disabled={connecting !== null}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/60 active:bg-slate-100 dark:active:bg-slate-700 transition-colors disabled:opacity-50 text-left"
                >
                  {/* Logo */}
                  <div className="w-10 h-10 rounded-xl border border-slate-100 dark:border-slate-700 bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {bank.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bank.logo}
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
    </>}
  </SheetFrame>;
}
