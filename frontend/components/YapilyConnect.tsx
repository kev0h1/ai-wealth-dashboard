"use client";

import { useState, useEffect, useRef } from "react";
import { X, Search, ChevronRight, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface Institution {
  id: string;
  name: string;
  logo: string;
  countries: string[];
}

interface YapilyConnectProps {
  onClose: () => void;
}

export default function YapilyConnect({ onClose }: YapilyConnectProps) {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.yapilyInstitutions("GB")
      .then(setInstitutions)
      .catch(() => setError("Failed to load banks. Check your Yapily credentials."))
      .finally(() => setLoading(false));
    setTimeout(() => searchRef.current?.focus(), 300);
  }, []);

  const filtered = query.trim()
    ? institutions.filter(i => i.name.toLowerCase().includes(query.toLowerCase()))
    : institutions;

  async function handleSelect(inst: Institution) {
    setConnecting(inst.id);
    setError(null);
    try {
      const { link } = await api.yapilyRequisition(inst.id);
      window.location.href = link;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start bank connection");
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-t-3xl shadow-xl flex flex-col" style={{ maxHeight: "85dvh" }}>
        <div className="mx-auto w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mt-3 mb-4 flex-shrink-0" />

        <div className="flex items-center justify-between px-5 mb-4 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Connect a Bank</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Powered by Yapily Open Banking</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700"
          >
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="px-5 mb-3 flex-shrink-0">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-3 py-2.5">
            <Search size={15} className="text-slate-400 flex-shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search banks…"
              className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {error && (
          <p className="px-5 mb-3 text-xs text-red-500 flex-shrink-0">{error}</p>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-8 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">No banks found</p>
          ) : (
            <div className="space-y-1">
              {filtered.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => handleSelect(inst)}
                  disabled={connecting !== null}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-700/50 active:bg-slate-100 dark:active:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {inst.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={inst.logo} alt={inst.name} className="w-9 h-9 rounded-xl object-contain bg-white border border-slate-100 flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-indigo-500">{inst.name[0]}</span>
                    </div>
                  )}
                  <span className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                    {inst.name}
                  </span>
                  {connecting === inst.id ? (
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
