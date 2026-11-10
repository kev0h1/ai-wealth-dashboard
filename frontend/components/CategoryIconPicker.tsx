"use client";

import { useId, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { useColours } from "@/components/ColourProvider";
import { getCategoryColour } from "@/lib/categories";
import { getIconLabel, ICON_CATALOG, ICON_LIBRARY, normaliseIconKey, RELATED_ICON_KEYS, suggestIcon } from "@/lib/categoryIcons";
import styles from "./CategoryIconPicker.module.css";

export interface CategoryIconPickerProps {
  name: string;
  kind?: string;
  /** null means Sorted's automatic choice, not a manual tag selection. */
  value: string | null;
  automaticKey?: string;
  onChange: (key: string | null) => void;
  disabled?: boolean;
}

/** Approved G450 A: suggestions and searchable browsing in the same sheet. */
export default function CategoryIconPicker({ name, kind, value, automaticKey, onChange, disabled = false }: CategoryIconPickerProps) {
  const { colours } = useColours();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const automatic = normaliseIconKey(automaticKey) ?? suggestIcon(name, kind);
  const selected = normaliseIconKey(value) ?? automatic;
  const CurrentIcon = ICON_LIBRARY[selected] ?? ICON_LIBRARY.tag;
  const colour = getCategoryColour(name || "Other", colours);
  const suggestions = [...new Set([selected, automatic, ...(RELATED_ICON_KEYS[automatic] ?? RELATED_ICON_KEYS[selected] ?? ["tag", "wallet", "receipt"])])];
  const icons = useMemo(() => {
    const normalise = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-GB");
    const wanted = normalise(query.trim());
    return ICON_CATALOG.filter(icon => {
      const words = normalise(`${icon.label} ${icon.terms} ${icon.group}`).split(/\s+/);
      return wanted.split(/\s+/).every(term => words.some(word => word.startsWith(term)));
    });
  }, [query]);

  function choice(key: string, prefix: string) {
    const Icon = ICON_LIBRARY[key];
    return <button key={`${prefix}-${key}`} type="button" data-category-icon-choice={key} aria-pressed={selected === key} disabled={disabled} className={styles.option} onClick={() => onChange(key)}>
      <Icon size={18} /><span>{getIconLabel(key)}</span>
    </button>;
  }

  return <section className={styles.picker} aria-label="Category icon">
    <div className={styles.current} data-current-category-icon={selected}>
      <span className={styles.tile} style={{ backgroundColor: `${colour}26`, color: colour }}><CurrentIcon size={15} /></span>
      <div><strong>{getIconLabel(selected)}</strong><p>{value === null ? automatic === "tag" && !automaticKey ? "Sorted will choose an icon when you save." : "Suggested by Sorted." : "You chose this icon."}</p></div>
    </div>
    {value !== null && <button type="button" disabled={disabled} className={styles.textAction} onClick={() => onChange(null)}>Use suggested icon</button>}
    <h3>Icons for this category</h3>
    <div className={styles.suggestions}>{suggestions.map(key => choice(key, "suggested"))}</div>
    <details className={styles.browse}>
      <summary tabIndex={0}>Browse all icons <ChevronRight size={16} aria-hidden="true" /></summary>
      <div className={styles.browser}>
        <label htmlFor={searchId}>Find an icon</label>
        <div className={styles.search}><Search size={17} aria-hidden="true" /><input id={searchId} name="category-icon-search" type="search" autoComplete="off" disabled={disabled} value={query} placeholder="For example, sport…" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} onChange={event => setQuery(event.target.value)} /></div>
        <p className={styles.count} role="status">{icons.length ? `${icons.length} icons` : "No icons match. Try sport, home or money."}</p>
        <div className={styles.catalogue}>{icons.map(icon => choice(icon.key, "catalogue"))}</div>
      </div>
    </details>
  </section>;
}
