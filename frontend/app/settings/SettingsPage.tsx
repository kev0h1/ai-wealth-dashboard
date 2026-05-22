"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { RotateCcw, LogOut, Plus, Trash2 } from "lucide-react";
import { CATEGORIES, CATEGORY_COLOURS } from "@/lib/categories";
import { useColours } from "@/components/ColourProvider";
import { useAuth } from "@/components/AuthProvider";
import { usePreferences, Region } from "@/components/PreferencesContext";
import { useCategories } from "@/components/CategoriesContext";
import { api, Account, Transaction } from "@/lib/api";
import BottomNav from "@/components/BottomNav";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";

interface CategorySpend {
  name: string;
  value: number;
}

export default function SettingsPage() {
  const { colours, setColour, resetColour } = useColours();
  const { user, logout } = useAuth();
  const { darkMode, setDarkMode, region, setRegion } = usePreferences();
  const { allCategories, customCategories, addCategory, deleteCategory, defaultColour: catDefaultColour } = useCategories();
  const [topSpend, setTopSpend] = useState<CategorySpend[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [catError, setCatError] = useState("");
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncHistoryMsg, setSyncHistoryMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadSpend = useCallback(async () => {
    try {
      const accs: Account[] = await api.accounts().catch(() => []);
      const all: Transaction[] = [];
      await Promise.all(
        accs.map(async (acc) => {
          try {
            const txns = await api.transactions(acc.id);
            all.push(...txns);
          } catch {}
        })
      );
      const map: Record<string, number> = {};
      for (const tx of all) {
        if (tx.transaction_type === "credit") continue;
        const cat = tx.category || "Other";
        if (cat === "Transfer" || cat === "Savings") continue;
        map[cat] = (map[cat] ?? 0) + Math.abs(tx.amount);
      }
      const arr = Object.entries(map)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
      setTopSpend(arr);
    } catch {}
  }, []);

  useEffect(() => {
    loadSpend();
  }, [loadSpend]);

  async function handleAddCategory() {
    const name = newCatName.trim();
    if (!name) return;
    setAddingCat(true); setCatError("");
    try {
      await addCategory(name);
      setNewCatName("");
    } catch (e: unknown) {
      setCatError(e instanceof Error ? e.message : "Failed to add category");
    } finally {
      setAddingCat(false);
    }
  }

  async function handleSyncHistory() {
    setSyncingHistory(true);
    setSyncHistoryMsg(null);
    try {
      const res = await api.syncHistory();
      setSyncHistoryMsg({ text: res.message || "Full sync complete", ok: true });
    } catch (e: unknown) {
      setSyncHistoryMsg({ text: e instanceof Error ? e.message : "Sync failed", ok: false });
    } finally {
      setSyncingHistory(false);
      setTimeout(() => setSyncHistoryMsg(null), 4000);
    }
  }

  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] pb-20">
      <div
        className="px-4 pt-6 pb-5 text-white"
        style={{
          background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
        }}
      >
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm opacity-70 mt-1">Customise your dashboard</p>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Display settings */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Display</p>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Dark Mode</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Easier on the eyes at night</p>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${darkMode ? "bg-indigo-500" : "bg-slate-200 dark:bg-slate-600"}`}
              aria-label="Toggle dark mode"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${darkMode ? "translate-x-6" : "translate-x-0"}`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-100 dark:border-slate-700">
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Region</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                {region === "UK" ? "TrueLayer open banking" : "Mono + M-Pesa + statements"}
              </p>
            </div>
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value as Region);
                setTimeout(() => loadSpend(), 300);
              }}
              className="text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-0 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer appearance-none pr-7 bg-no-repeat"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "right 8px center" }}
            >
              {([["UK", "🇬🇧"], ["Kenya", "🇰🇪"]] as [Region, string][]).map(([r, flag]) => (
                <option key={r} value={r}>{flag} {r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Live donut preview */}
        {topSpend.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Live Preview — Top Spending
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0" style={{ width: 110, height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={topSpend}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={48}
                      strokeWidth={3}
                      stroke="#fff"
                    >
                      {topSpend.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={colours[entry.name] ?? CATEGORY_COLOURS.Other}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                {topSpend.map((cat) => (
                  <div key={cat.name} className="flex items-center gap-2">
                    <span
                      className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: colours[cat.name] ?? CATEGORY_COLOURS.Other }}
                    />
                    <span className="text-xs text-slate-600 dark:text-slate-300 truncate">{cat.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Custom categories */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Custom Categories</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Add categories beyond the built-in ones</p>
          </div>
          {/* Add new */}
          <div className="px-4 py-3 border-b border-slate-50 dark:border-slate-700/50 flex items-center gap-2">
            <input
              className="flex-1 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="e.g. Pet Care, Hobbies…"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddCategory(); }}
              maxLength={40}
            />
            <button
              onClick={handleAddCategory}
              disabled={!newCatName.trim() || addingCat}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform"
            >
              <Plus size={16} color="#fff" />
            </button>
          </div>
          {catError && <p className="px-4 pb-2 text-xs text-red-500">{catError}</p>}
          {/* Custom category list */}
          {customCategories.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500">No custom categories yet</p>
          ) : (
            customCategories.map((cat) => (
              <div key={cat} className="flex items-center justify-between px-4 py-3 border-t border-slate-50 dark:border-slate-700/50">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{cat}</span>
                <button
                  onClick={() => deleteCategory(cat)}
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-red-50 dark:bg-red-900/20 active:bg-red-100 transition-colors"
                  aria-label={`Delete ${cat}`}
                >
                  <Trash2 size={13} color="#ef4444" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Colour list */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden divide-y divide-slate-50 dark:divide-slate-700">
          {allCategories.map((cat) => {
            const current = colours[cat] ?? catDefaultColour(cat);
            const def = catDefaultColour(cat);
            const inChart = topSpend.some((s) => s.name === cat);
            return (
              <CategoryColourRow
                key={cat}
                name={cat}
                colour={current}
                defaultColour={def}
                isCustom={current !== def}
                inChart={inChart}
                onChange={(hex) => setColour(cat, hex)}
                onReset={() => resetColour(cat)}
              />
            );
          })}
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center pb-2">
          Tap a swatch to change its colour. Changes apply instantly everywhere.
        </p>

        {/* Data section */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Data</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Sync all history</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-3">
              Re-fetch the last 90 days of transactions from all connected banks.
            </p>
            <button
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 active:scale-95 transition-transform"
            >
              <RotateCcw size={14} className={syncingHistory ? "animate-spin" : ""} />
              {syncingHistory ? "Syncing…" : "Sync history (90 days)"}
            </button>
            {syncHistoryMsg && (
              <p className={`mt-2 text-xs font-medium ${syncHistoryMsg.ok ? "text-emerald-500" : "text-red-500"}`}>
                {syncHistoryMsg.text}
              </p>
            )}
          </div>
        </div>

        {/* Account section */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3.5 border-b border-slate-50 dark:border-slate-700">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">Account</p>
            {user?.name && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{user.name}</p>}
            {user?.email && <p className="text-xs text-slate-400 dark:text-slate-500">{user.email}</p>}
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 active:bg-red-100 transition-colors"
          >
            <LogOut size={16} />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

interface RowProps {
  name: string;
  colour: string;
  defaultColour: string;
  isCustom: boolean;
  inChart: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
}

function CategoryColourRow({
  name,
  colour,
  defaultColour,
  isCustom,
  inChart,
  onChange,
  onReset,
}: RowProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <button
        onClick={() => inputRef.current?.click()}
        className="flex-shrink-0 w-8 h-8 rounded-xl border-2 border-white shadow-md active:scale-90 transition-transform"
        style={{ backgroundColor: colour }}
        aria-label={`Change colour for ${name}`}
      />
      <input
        ref={inputRef}
        type="color"
        value={colour}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{name}</span>
        {inChart && (
          <span className="ml-2 text-[10px] font-semibold text-indigo-500 uppercase tracking-wide">
            in chart
          </span>
        )}
      </div>

      <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{colour}</span>

      {isCustom ? (
        <button
          onClick={onReset}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 active:bg-slate-200 transition-colors"
          title={`Reset to default (${defaultColour})`}
        >
          <RotateCcw size={13} color="#94a3b8" />
        </button>
      ) : (
        <div className="flex-shrink-0 w-7" />
      )}
    </div>
  );
}
