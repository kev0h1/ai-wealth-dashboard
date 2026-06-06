"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface Bank {
  id: string;
  name: string;
  logo: string;
}

interface BankPickerSheetProps {
  onClose: () => void;
}

export default function BankPickerSheet({ onClose }: BankPickerSheetProps) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.truelayerProviders()
      .then(setBanks)
      .catch(() => setError("Failed to load banks"))
      .finally(() => setLoading(false));
    setTimeout(() => searchRef.current?.focus(), 300);
  }, []);

  const filtered = query.trim()
    ? banks.filter(b => b.name.toLowerCase().includes(query.toLowerCase()))
    : banks;

  async function handleSelect(bank: Bank) {
    setConnecting(bank.id);
    setError(null);
    try {
      const { auth_url } = await api.connectLink(bank.id);
      window.location.href = auth_url;
    } catch {
      setError("Failed to connect. Please try again.");
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: "88dvh" }}
      >
        {/* Handle */}
        <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mt-3 mb-1 flex-shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-4 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Add a Bank</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Secure open banking · Powered by TrueLayer
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:scale-90 transition-transform"
          >
            <X size={15} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-700 rounded-2xl px-3.5 py-2.5">
            <Search size={15} className="text-slate-400 flex-shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your bank…"
              className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-slate-400 active:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="px-5 pb-2 text-xs text-red-500 flex-shrink-0">{error}</p>
        )}

        {/* Bank list */}
        <div className="flex-1 overflow-y-auto px-3 pb-10 min-h-0">
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
                  onClick={() => handleSelect(bank)}
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
                    <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
