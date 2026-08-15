"use client";

// TEMPORARY PREVIEW — delete after review.
// The real surface is TeachingSheet's naming step (born-in-context, per
// ENGINE.md); the standalone CategoryManagerSheet this preview used to
// mirror has been deleted. This route renders the same add-category row
// shape, using the same exported CategoryKindChooser, over realistic names.
// Deep-linkable: /design/category-kind?mode=light | ?mode=dark

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { CategoryKindChooser } from "@/components/CategoryKindChooser";
import { DEFAULT_CUSTOM_COLOUR, inferCategoryKind, type CategoryKind } from "@/lib/categories";
import { ICON_LIBRARY, suggestIcon } from "@/lib/categoryIcons";

function AddCategoryRow({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<CategoryKind | null>(null);
  const iconKey = suggestIcon(name);
  const Icon = ICON_LIBRARY[iconKey] ?? ICON_LIBRARY.Tag;
  const value = kind ?? inferCategoryKind(name);

  return (
    <div className="px-4 pb-3 border-t border-slate-50 dark:border-slate-700/50 pt-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Choose an icon"
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          style={{ backgroundColor: `${DEFAULT_CUSTOM_COLOUR}26` }}
        >
          <Icon size={16} style={{ color: DEFAULT_CUSTOM_COLOUR }} />
        </button>
        <input
          aria-label="New category name"
          className="flex-1 min-w-0 text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Add a category…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
        <button
          type="button"
          disabled={!name.trim()}
          className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center disabled:opacity-40 active:scale-90 transition-transform flex-shrink-0"
        >
          <Plus size={16} color="#fff" />
        </button>
      </div>
      {name.trim() && (
        <CategoryKindChooser name={name.trim()} kind={value} onChange={setKind} />
      )}
    </div>
  );
}

export default function CategoryKindClient() {
  const mode = useSearchParams().get("mode") === "dark" ? "dark" : "light";

  useEffect(() => {
    // The page canvas lives outside this tree; PreferencesContext also writes
    // this class on mount, so apply after its effect has run.
    const t = setTimeout(() => {
      document.documentElement.classList.toggle("dark", mode === "dark");
      document
        .querySelector('meta[name="color-scheme"]')
        ?.setAttribute("content", mode === "dark" ? "dark" : "only light");
    }, 0);
    return () => clearTimeout(t);
  }, [mode]);

  return (
    <div className={mode === "dark" ? "dark" : ""}>
      <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a] px-3 py-5">
        <div className="mx-auto w-full max-w-[430px]">
          <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Preview · {mode}
          </p>
          <h1 className="px-2 mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">
            Spend settings — adding a category
          </h1>
          <p className="px-2 mt-1 mb-4 text-[13px] leading-snug text-slate-600 dark:text-slate-300">
            Each row is the real add-category flow. The kind is inferred from the
            name and shown as a decision already made; one tap changes it.
          </p>

          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Categories
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Mine
              </p>
            </div>

            <AddCategoryRow initialName="Golf" />
            <AddCategoryRow initialName="House Fund" />
            <AddCategoryRow initialName="Childcare" />
            <AddCategoryRow initialName="" />
          </div>

          <div className="mt-4 px-2 flex gap-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            <a href="?mode=light">View light</a>
            <a href="?mode=dark">View dark</a>
          </div>
        </div>
      </div>
    </div>
  );
}
