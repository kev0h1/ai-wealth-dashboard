"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Trash2, Receipt, Camera, Image as ImageIcon } from "lucide-react";
import { api, Basket } from "@/lib/api";
import { goBack } from "@/lib/goBack";

function money(amount: number | null, currency = "GBP") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
}

// Downscale on the client so we send a lean image — same helper as
// components/GroceryBasketCard.tsx's own scan flow (Home/Spend's entry
// point). Duplicated rather than extracted (2026-09-05, review round: this
// page had no scan control of its own, its empty state pointed at the
// retired Insights page) so this fix doesn't also touch that already-
// shipped card's behaviour.
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

export default function ReceiptsPage() {
  const router = useRouter();
  const [baskets, setBaskets] = useState<Basket[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    api.listBaskets()
      .then(setBaskets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    setBaskets((prev) => prev.filter((b) => b.id !== id));
    if (expanded === id) setExpanded(null);
    setPendingDeleteId(null);
    try { await api.deleteBasket(id); } catch {}
  }

  async function scanFile(file: File | Blob) {
    setScanError(null);
    setScanning(true);
    try {
      const dataUrl = await fileToScaledDataUrl(file as File);
      const basket = await api.scanReceipt(dataUrl);
      setBaskets((prev) => [basket, ...prev]);
      setExpanded(basket.id);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Couldn't scan that receipt");
    } finally {
      setScanning(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await scanFile(file);
  }

  // Inside the app shell, use the native camera via the message bridge — the
  // WebView's file-input camera is unreliable across Android versions. Same
  // bridge contract as GroceryBasketCard.tsx's own `takePhoto`.
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
    setTimeout(() => window.removeEventListener("native-camera", onResult), 60_000);
  }

  return (
    <div className="min-h-dvh" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="sticky top-0 z-10 bg-[#f0f2f7]/90 dark:bg-[#0f172a]/90 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            onClick={() => goBack(router, "/spend")}
            className="w-11 h-11 flex items-center justify-center rounded-full glass-tile flex-shrink-0 active:scale-95 transition-transform"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-slate-500 dark:text-slate-400" aria-hidden="true" />
          </button>
          <h1 className="flex-1 text-lg font-bold text-slate-900 dark:text-slate-100">Receipts</h1>
          {!loading && baskets.length > 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400 pr-1">
              {baskets.length} total
            </span>
          )}
          <button
            onClick={takePhoto}
            disabled={scanning}
            aria-label="Scan a receipt"
            className="w-11 h-11 flex items-center justify-center rounded-full text-emerald-600 dark:text-emerald-400 active:scale-95 transition-transform disabled:opacity-50"
          >
            <Camera size={20} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 pb-28 space-y-2">
        {scanning && (
          <div className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white">
            <Camera size={16} />
            Reading receipt…
          </div>
        )}
        {scanError && <p className="text-xs text-rose-500 text-center">{scanError}</p>}

        {loading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm animate-pulse" />
            ))}
          </>
        ) : baskets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
              <Receipt size={24} className="text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">No receipts yet</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-[260px]">
              Scan a receipt here to start tracking grocery prices.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-[280px]">
              <button
                onClick={takePhoto}
                disabled={scanning}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50"
              >
                <Camera size={16} />
                Take photo
              </button>
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={scanning}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-400/60 dark:border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-sm font-semibold text-emerald-700 dark:text-emerald-200 transition-all active:scale-95 disabled:opacity-50"
              >
                <ImageIcon size={16} />
                Upload
              </button>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {baskets.map((b) => {
              const open = expanded === b.id;
              return (
                <li
                  key={b.id}
                  className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden"
                >
                  <div className="flex items-center gap-2 p-3">
                    <button
                      onClick={() => setExpanded(open ? null : b.id)}
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      aria-expanded={open}
                    >
                      <ChevronDown
                        size={16}
                        className={`text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {b.shop || "Receipt"}
                          <span className="ml-1.5 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            {b.item_count} item{b.item_count === 1 ? "" : "s"}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {b.purchased_at ? (
                            <>
                              {b.purchased_at}
                              {b.date_estimated && <span className="italic"> · estimated</span>}
                            </>
                          ) : (
                            "Date unknown"
                          )}
                        </p>
                      </div>
                    </button>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100 money flex-shrink-0">
                      {money(b.total, b.currency)}
                    </span>
                    <button
                      onClick={() => setPendingDeleteId(b.id)}
                      className="p-2.5 -mr-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 active:scale-90 transition-transform flex-shrink-0"
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
                              {it.qty > 1 && (
                                <span className="text-slate-500 dark:text-slate-400">{it.qty}× </span>
                              )}
                              {it.name}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{it.category}</p>
                          </div>
                          <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 money flex-shrink-0">
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
      </div>

      {pendingDeleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            className="w-full max-w-md mx-4 mb-8 bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Delete receipt?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 active:bg-slate-50 dark:active:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => remove(pendingDeleteId)}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-sm font-semibold text-white active:bg-rose-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
