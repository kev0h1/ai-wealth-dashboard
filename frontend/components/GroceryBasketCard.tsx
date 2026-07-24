"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Camera, Image as ImageIcon, TrendingUp, Store, Pin, ChevronDown, Trash2, ChevronRight } from "lucide-react";
import { api, Basket, BasketInsights } from "@/lib/api";
import { useHomePinnedCards } from "@/lib/useHomePinnedCards";
import ConfirmDialog from "@/components/ConfirmDialog";

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };

function money(value: number | null, currency: string): string {
  if (value == null) return "—";
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${sym}${value.toFixed(2)}`;
}

// Downscale on the client so we send a lean image: smaller payload + the model
// reads a 1600px receipt fine, and we never ship a 12MP original.
function fileToScaledDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(reader.result as string); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function GroceryBasketCard() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [insights, setInsights] = useState<BasketInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showTrends, setShowTrends] = useState(false);
  const [showMoreCheaper, setShowMoreCheaper] = useState(false);
  const [showMorePriceChanges, setShowMorePriceChanges] = useState(false);
  const router = useRouter();
  const [cardOpen, setCardOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const { pinned: pinnedCards, toggle: toggleCard } = useHomePinnedCards();
  const isGroceriesPinned = pinnedCards.includes("groceries");

  const loadInsights = () => api.basketInsights().then(setInsights).catch(() => {});

  useEffect(() => {
    api.listBaskets().then(setBaskets).catch(() => {});
    loadInsights();
  }, []);

  async function scanFile(file: File | Blob) {
    setError(null);
    setLoading(true);
    try {
      const dataUrl = await fileToScaledDataUrl(file as File);
      const basket = await api.scanReceipt(dataUrl);
      setBaskets((prev) => [basket, ...prev]);
      setExpanded(basket.id);
      loadInsights();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't scan that receipt");
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await scanFile(file);
  }

  // Inside the app shell, use the native camera via the message bridge — the
  // WebView's file-input camera is unreliable across Android versions.
  function takePhoto() {
    const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
    if (!rn) { cameraRef.current?.click(); return; }
    const id = Math.random().toString(36).slice(2);
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.id !== id) return;
      window.removeEventListener("native-camera", onResult);
      if (detail.error === "cancelled") return;
      if (detail.error || !detail.base64) { cameraRef.current?.click(); return; } // fall back to the input route
      const bytes = atob(detail.base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      scanFile(new Blob([arr], { type: detail.mime || "image/jpeg" }));
    };
    window.addEventListener("native-camera", onResult);
    rn.postMessage(JSON.stringify({ type: "camera:request", id }));
    // Safety: stop listening if the shell never answers (old app build)
    setTimeout(() => window.removeEventListener("native-camera", onResult), 60_000);
  }

  async function remove(id: string) {
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    if (expanded === id) setExpanded(null);
    try { await api.deleteBasket(id); } catch { /* best-effort */ }
    loadInsights();
  }

  const hasTrends = !!insights && (insights.item_trends.length > 0 || insights.store_prices.length > 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setCardOpen((v) => !v)}
          aria-expanded={cardOpen}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
            <Receipt size={16} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1">Groceries</p>
          {insights && insights.receipt_count > 0 && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {insights.receipt_count} receipt{insights.receipt_count === 1 ? "" : "s"}
            </span>
          )}
          <ChevronDown
            size={18}
            className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform ${cardOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={() => toggleCard("groceries")}
          title={isGroceriesPinned ? "Unpin from Home" : "Pin to Home"}
          aria-label={isGroceriesPinned ? "Unpin from Home" : "Pin to Home"}
          className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${isGroceriesPinned ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500" : "text-slate-300 dark:text-slate-600 hover:text-indigo-400"}`}
        >
          <Pin size={13} className={isGroceriesPinned ? "fill-indigo-400" : ""} />
        </button>
      </div>

      {!cardOpen ? (
        <div
          className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl ${
            insights?.headline ? "bg-emerald-50 dark:bg-emerald-900/30" : "bg-slate-50 dark:bg-slate-900/60"
          }`}
        >
          {insights?.headline ? (
            <>
              <TrendingUp size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200 flex-1 min-w-0 truncate">{insights.headline}</span>
            </>
          ) : (
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex-1">Snap a receipt to track grocery prices</span>
          )}
        </div>
      ) : (
      <>

      {insights?.headline ? (
        <button
          onClick={() => hasTrends && setShowTrends((v) => !v)}
          className="w-full flex items-center gap-2 mt-3 mb-4 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 text-left"
        >
          <TrendingUp size={15} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200 flex-1 min-w-0">
            {insights.headline}
          </span>
          {hasTrends && (
            <ChevronDown
              size={14}
              className={`text-emerald-600 dark:text-emerald-400 flex-shrink-0 transition-transform ${showTrends ? "rotate-180" : ""}`}
            />
          )}
        </button>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 mb-4 leading-relaxed">
          Snap a receipt and we&apos;ll itemise it, then track how prices change over
          time and which shop is cheapest for what you buy.
        </p>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
      {loading ? (
        <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white opacity-60">
          <Camera size={16} />
          Reading receipt…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={takePhoto}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white transition-all active:scale-95"
          >
            <Camera size={16} />
            Take photo
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-400/60 dark:border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-sm font-semibold text-emerald-700 dark:text-emerald-200 transition-all active:scale-95"
          >
            <ImageIcon size={16} />
            Upload
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-500 mt-2">{error}</p>}

      {showTrends && insights && (
        <div className="mt-4 space-y-3">
          {insights.store_prices.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                <Store size={12} /> Cheaper elsewhere
              </p>
              {(() => {
                const sorted = [...insights.store_prices].sort((a, b) => b.saving - a.saving);
                const visible = showMoreCheaper ? sorted : sorted.slice(0, 5);
                const hidden = sorted.length - 5;
                return (
                  <>
                    <ul className="space-y-1.5">
                      {visible.map((s) => (
                        <li key={s.key} className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate">{s.name}</p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {money(s.cheapest_price, s.currency)} at {s.cheapest_store} · {money(s.dearest_price, s.currency)} at {s.dearest_store}
                            </p>
                          </div>
                          <span className="text-[11px] font-semibold text-emerald-500 flex-shrink-0">
                            save {money(s.saving, s.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {sorted.length > 5 && (
                      <button
                        onClick={() => setShowMoreCheaper((v) => !v)}
                        className="mt-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                      >
                        {showMoreCheaper ? "Show less" : `See ${hidden} more`}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}
          {insights.item_trends.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                <TrendingUp size={12} /> Price changes
              </p>
              {(() => {
                const filtered = insights.item_trends.filter((t) => t.pct_change !== 0);
                const sorted = [...filtered].sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change));
                const visible = showMorePriceChanges ? sorted : sorted.slice(0, 5);
                const hidden = sorted.length - 5;
                return (
                  <>
                    <ul className="space-y-1.5">
                      {visible.map((t) => {
                        const up = t.pct_change > 0;
                        return (
                          <li key={t.key} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate">{t.name}</p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {money(t.previous, t.currency)} → {money(t.latest, t.currency)}{t.store ? ` · ${t.store}` : ""}
                              </p>
                            </div>
                            <span className={`text-[11px] font-semibold flex-shrink-0 ${up ? "text-rose-500" : "text-emerald-500"}`}>
                              {up ? "+" : ""}{t.pct_change}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {sorted.length > 5 && (
                      <button
                        onClick={() => setShowMorePriceChanges((v) => !v)}
                        className="mt-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                      >
                        {showMorePriceChanges ? "Show less" : `See ${hidden} more`}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {baskets.length > 0 && (
        <ul className="mt-4 space-y-2">
          {baskets.slice(0, 3).map((b) => {
            const open = expanded === b.id;
            return (
              <li key={b.id} className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => setExpanded(open ? null : b.id)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <ChevronDown
                      size={16}
                      className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {b.shop || "Receipt"}
                        <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {b.item_count} item{b.item_count === 1 ? "" : "s"}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {b.purchased_at
                          ? <>{b.purchased_at}{b.date_estimated && <span className="italic"> · estimated</span>}</>
                          : "Date unknown"}
                      </p>
                    </div>
                  </button>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 flex-shrink-0">
                    {money(b.total, b.currency)}
                  </span>
                  <button
                    onClick={() => setPendingDeleteId(b.id)}
                    className="p-2.5 text-slate-300 hover:text-rose-500 flex-shrink-0"
                    aria-label="Delete receipt"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {open && (
                  <ul className="px-3 pb-3 pt-0 space-y-1 border-t border-slate-100 dark:border-slate-700">
                    {b.items.map((it, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 pt-1.5">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-700 dark:text-slate-300 truncate">
                            {it.qty > 1 && <span className="text-slate-500 dark:text-slate-400">{it.qty}× </span>}
                            {it.name}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{it.category}</p>
                        </div>
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex-shrink-0">
                          {money(it.line_price ?? it.unit_price, b.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {baskets.length > 3 && (
        <button
          onClick={() => router.push("/insights/receipts")}
          className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
        >
          View all {baskets.length} receipts
          <ChevronRight size={16} className="text-slate-500 dark:text-slate-400" />
        </button>
      )}
      </>
      )}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        destructive
        title="Delete receipt?"
        message="Remove this scanned receipt? This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => { const id = pendingDeleteId!; setPendingDeleteId(null); remove(id); }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
