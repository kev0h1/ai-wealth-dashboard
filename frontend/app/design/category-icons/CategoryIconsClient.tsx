"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Plus, RotateCcw, Search } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import MoneyText from "@/components/MoneyText";
import { BUILTIN_ICON_ROWS, getIconLabel, ICON_CATALOG, suggestIcon } from "./icons";
import { CategoryGlyph, CategoryTile } from "./CategoryGlyph";
import { readPreviewCategories, resetPreviewCategories, STARTING_CATEGORIES, type PreviewCategory, writePreviewCategories } from "./previewStore";
import styles from "./preview.module.css";

type Scenario = "ready" | "hidden" | "loading" | "error" | "save-error" | "empty" | "long" | "storage-error";
type Editor = { original?: PreviewCategory; name: string; kind: string; iconKey: string; source: "auto" | "user" };
type Config = { variant: "a" | "b"; mode: "light" | "dark"; scenario: Scenario };
const SCENARIOS: Scenario[] = ["ready", "hidden", "loading", "error", "save-error", "empty", "long", "storage-error"];
const KINDS = [["discretionary", "Free"], ["commitment", "Fixed"], ["movement", "Moved"], ["excluded", "Not counted"]] as const;
const KIND_LABELS: Record<string, string> = Object.fromEntries([...KINDS, ["income", "Income"]]);
const RESERVED_NAMES = ["Internal Transfer", "Loan Payment", "Credit Card Payment", "Hobbies", "Health & Beauty", "Sports & Fitness", "Utilities", "Gambling"];
const CONTEXTS = ["Spend", "Biggest impact", "Upcoming", "Account sheet", "Transactions", "Search", "Category picker", "Teaching", "Penny", "Tutorial", "Planning"];
const RELATED: Record<string, string[]> = {
  golf: ["racquet", "soccer-ball", "barbell"], racquet: ["golf", "soccer-ball", "barbell"],
  lightning: ["drop", "receipt", "house-line"], "device-mobile": ["wifi-high", "laptop", "repeat"],
  briefcase: ["laptop", "wallet", "bank"], "piggy-bank": ["trend-up", "bank", "arrows-left-right"],
  coffee: ["fork-knife", "wine", "shopping-cart"],
};
const normalise = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");

function seedFor(scenario: Scenario): PreviewCategory[] {
  if (scenario === "empty") return [];
  return STARTING_CATEGORIES.map((row, index) => scenario === "long" && index === 0
    ? { ...row, name: "Golf lessons and weekend club membership" } : { ...row });
}

function initialEditor(category?: PreviewCategory): Editor {
  return category ? { original: category, ...category } : { name: "", kind: "discretionary", iconKey: "tag", source: "auto" };
}

function IconButton({ iconKey, selected, onClick }: { iconKey: string; selected: boolean; onClick: () => void }) {
  return <button type="button" data-icon-key={iconKey} aria-pressed={selected} className={styles.iconOption} onClick={onClick}>
    <CategoryGlyph iconKey={iconKey} size={18} /><span>{getIconLabel(iconKey)}</span>
  </button>;
}

function IconSearch({ query, onChange, name }: { query: string; onChange: (value: string) => void; name: string }) {
  return <label className={styles.search}><span>Find an icon</span><span><Search size={17} aria-hidden="true" />
    <input name={name} type="search" autoComplete="off" value={query} placeholder="For example, sport…" onChange={event => onChange(event.target.value)} />
  </span></label>;
}

export default function CategoryIconsClient() {
  const params = useSearchParams();
  const state = params.get("state") as Scenario;
  const config: Config = { variant: params.get("variant") === "b" ? "b" : "a", mode: params.get("mode") === "dark" ? "dark" : "light", scenario: SCENARIOS.includes(state) ? state : "ready" };
  return <Preview key={JSON.stringify(config)} {...config} />;
}

function Preview({ variant, mode, scenario }: Config) {
  const [categories, setCategories] = useState<PreviewCategory[]>(() => seedFor(scenario));
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pickerDraft, setPickerDraft] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [hide, setHide] = useState(scenario === "hidden");
  const [exampleName, setExampleName] = useState("");
  const failedOnce = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const namespace = scenario === "empty" || scenario === "long" ? scenario : "";
  const unavailable = scenario === "loading" || scenario === "error" || !ready || storageError;
  const theme = `${styles.sheetTheme} ${mode === "dark" ? styles.darkTheme : ""}`;
  const url = (next: Record<string, string>) => `/design/category-icons?${new URLSearchParams({ variant, mode, state: scenario, ...next })}`;

  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const oldScheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = oldScheme; };
  }, [mode]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        if (scenario === "storage-error") throw new Error("Fictional read failure");
        setCategories(readPreviewCategories(seedFor(scenario), namespace));
      } catch { setStorageError(true); }
      setReady(true);
    });
    return () => { live = false; };
  }, [scenario, namespace]);

  const icons = useMemo(() => ICON_CATALOG.filter(icon => `${icon.label} ${icon.terms} ${icon.group}`.toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const example = categories.find(row => row.name === exampleName) ?? categories[0];
  const suggested = editor ? suggestIcon(editor.name, editor.kind) : "tag";
  const suggestionKeys = [...new Set([editor?.iconKey ?? "tag", suggested, ...(RELATED[suggested] ?? ["tag", "wallet", "receipt"])])];
  const updateEditor = (next: Partial<Editor>) => setEditor(current => current ? { ...current, ...next } : null);
  const startEditor = (category?: PreviewCategory) => { setEditor(initialEditor(category)); setPickerDraft(null); setQuery(""); setSaveError(""); };
  const failSave = (message: string, field = false) => {
    setSaveError(message);
    queueMicrotask(() => field ? nameRef.current?.focus() : errorRef.current?.focus());
  };

  function save(close: () => void) {
    if (!editor) return;
    const name = editor.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 40) return failSave("Use a category name of up to 40 characters.", true);
    if (BUILTIN_ICON_ROWS.some(row => normalise(row.name) === normalise(name)) || RESERVED_NAMES.some(value => normalise(value) === normalise(name))) return failSave("That name is already used by Sorted. Choose a different name.", true);
    if (categories.some(row => row !== editor.original && normalise(row.name) === normalise(name))) return failSave("That category already exists. Choose a different name.", true);
    if (scenario === "save-error" && !failedOnce.current) { failedOnce.current = true; return failSave("The category was not saved. Try again."); }
    const saved: PreviewCategory = { name, kind: editor.kind, source: editor.source, iconKey: editor.source === "auto" ? suggestIcon(name, editor.kind) : editor.iconKey };
    const next = editor.original ? categories.map(row => row === editor.original ? saved : row) : [...categories, saved];
    try {
      writePreviewCategories(next, namespace);
      setCategories(next); setExampleName(saved.name); setSaveError("");
      setNotice(`${saved.name} is saved with ${getIconLabel(saved.iconKey)} in this preview on this device.`);
      close();
    } catch { failSave("The category was not saved on this device. Try again, or cancel to keep the saved version."); }
  }

  function reset() {
    try {
      resetPreviewCategories(namespace); setCategories(seedFor(scenario)); setStorageError(false); setResetPending(false); setExampleName("");
      setNotice("This fictional example has been reset.");
    } catch { setNotice("The example could not be reset on this device. Try again."); }
  }

  function retryRead() {
    try { setCategories(readPreviewCategories(seedFor(scenario), namespace)); setStorageError(false); setNotice("The fictional categories are ready."); }
    catch { setNotice("The saved example still cannot be read. Reset demo to start with fictional categories."); }
  }

  const pickerContent = (selected: string, choose: (key: string) => void) => <>
    <IconSearch query={query} onChange={setQuery} name="icon-search" />
    <p className={styles.quiet} role="status">{icons.length ? `${icons.length} icons` : "No icons match. Try sport, home or money."}</p>
    <div className={styles.catalogue}>{icons.map(icon => <IconButton key={icon.key} iconKey={icon.key} selected={selected === icon.key} onClick={() => choose(icon.key)} />)}</div>
  </>;

  return <main className={`${styles.preview} ${mode === "dark" ? "dark" : ""}`}>
    <a href="#category-preview" className={styles.skip}>Skip to category preview</a>
    <section className={styles.review}>
      <Link href="/design" className={styles.back}>Back to design reviews</Link>
      <h1>Category icons</h1>
      <p>G450. The same Phosphor regular icons in both proposals, at the current sizes and colours. Try creating or renaming a category, then choose how its icon is changed. All records are fictional and saved only in this preview on this device.</p>
      <nav aria-label="Design variants" className={styles.variants}>
        <Link href={url({ variant: "a" })} aria-current={variant === "a" ? "page" : undefined}>A · Suggested icons</Link>
        <Link href={url({ variant: "b" })} aria-current={variant === "b" ? "page" : undefined}>B · Browse icons</Link>
      </nav>
      <div className={styles.tools}>
        <label>Preview state<select name="preview-state" value={scenario} onChange={event => window.location.assign(url({ state: event.target.value }))}>{SCENARIOS.map(item => <option key={item} value={item}>{item.replaceAll("-", " ")}</option>)}</select></label>
        <Link href={url({ mode: mode === "dark" ? "light" : "dark" })}>{mode === "dark" ? "Light theme" : "Dark theme"}</Link>
        <button type="button" data-reset-preview onClick={() => setResetPending(true)}><RotateCcw size={16} aria-hidden="true" />Reset demo</button>
      </div>
      {resetPending && <div className={styles.reset}><p>Discard the changes to this fictional example?</p><button type="button" onClick={reset}>Reset fictional example</button><button type="button" onClick={() => setResetPending(false)}>Keep changes</button></div>}
    </section>

    <section id="category-preview" className={styles.canvas} aria-label="Fictional category settings">
      <header className={styles.heading}><div><h2>Categories</h2><p>A familiar icon for each part of your money.</p></div><button type="button" data-create-category disabled={unavailable} onClick={() => startEditor()}><Plus size={17} aria-hidden="true" />Add category</button></header>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {storageError && <div className={styles.notice}><p>The saved preview could not be read. Try again, or reset this fictional example.</p><button type="button" onClick={retryRead}>Try again</button></div>}
      {scenario === "loading" || !ready ? <div className={styles.loading} role="status"><p>Loading categories…</p><span /><span /><span /></div> : scenario === "error" ? <div className={styles.empty}><h3>Categories are not available</h3><p>Try again to load the fictional example.</p><Link href={url({ state: "ready" })}>Try again</Link></div> : <>
        <div className={styles.directory}>
          <section aria-labelledby="custom-heading"><h3 id="custom-heading" className={styles.sectionTitle}>Your categories</h3>
            <div className={styles.list}>{categories.map(category => <button key={category.name} type="button" data-open-category={category.name} className={styles.categoryRow} disabled={storageError} onClick={() => startEditor(category)}>
              <CategoryTile name={category.name} iconKey={category.iconKey} /><span><strong>{category.name}</strong><small>{category.source === "user" ? "You chose this icon" : "Suggested for this category"}</small></span><ChevronRight size={17} aria-hidden="true" />
            </button>)}</div>
            {!categories.length && <div className={styles.empty}><h4>No custom categories yet</h4><p>Add one and Sorted will suggest an icon you can change.</p><button type="button" disabled={storageError} onClick={() => startEditor()}>Add category</button></div>}
          </section>
          <details className={styles.builtins}><summary>22 built-in categories <ChevronRight size={16} aria-hidden="true" /></summary><p className={styles.quiet}>The same colours and category groups you use today.</p><div>{BUILTIN_ICON_ROWS.map(row => <div key={row.name} className={styles.builtinRow}><CategoryTile name={row.name} iconKey={row.iconKey} /><span><b>{row.name}</b><small>{KIND_LABELS[row.kind]}</small></span></div>)}</div></details>
        </div>
        {example && <section className={styles.parity}><div className={styles.parityHeader}><div><h3>One identity everywhere</h3><p><strong>{example.name}</strong> in each context, using the same icon and colour.</p></div><button type="button" aria-pressed={hide} onClick={() => setHide(value => !value)}>{hide ? "Show figures" : "Hide figures"}</button></div>
          <p className={styles.quiet}>The amount below represents one fictional transaction shown in different places.</p>
          <div className={styles.parityGrid}>{CONTEXTS.map((surface, index) => <div key={surface} className={styles.contextRow}>
            <CategoryTile name={example.name} iconKey={example.iconKey} tileSize={surface === "Category picker" ? 36 : 32} iconSize={[14,15,15,15,14,14,16,16,18,15,16][index]} />
            <span>{surface}</span>{index < 4 && <MoneyText text={hide ? "−£••••" : "−£42.50"} />}
          </div>)}</div>
        </section>}
      </>}
    </section>

    {editor && <SheetFrame title={editor.original ? "Edit category" : "Add category"} description="Fictional preview on this device" themeClass={theme} onClose={() => setEditor(null)} footer={({ close }) => <div className={styles.footer}><button type="button" data-save-category className={styles.primary} onClick={() => save(close)}>{editor.original ? "Save category" : "Add category"}</button><button type="button" className={styles.secondary} onClick={close}>Cancel</button></div>}>
      <div className={styles.form}>
        <label>Name<input ref={nameRef} aria-label="Category name" aria-describedby={saveError ? "category-save-error" : undefined} name="category-name" autoComplete="off" value={editor.name} maxLength={40} placeholder="For example, Golf…" onChange={event => { const name = event.target.value; updateEditor({ name, ...(editor.source === "auto" ? { iconKey: suggestIcon(name, editor.kind) } : {}) }); }} /></label>
        <fieldset className={styles.kindField}><legend>Group</legend><div>{KINDS.map(([kind, label]) => <label key={kind}><input type="radio" name="category-kind" value={kind} checked={editor.kind === kind} onChange={() => updateEditor({ kind, ...(editor.source === "auto" ? { iconKey: suggestIcon(editor.name, kind) } : {}) })} />{label}</label>)}</div></fieldset>
        <section className={styles.picked} aria-label="Current icon"><CategoryTile name={editor.name || "Other"} iconKey={editor.iconKey} /><div><strong>{getIconLabel(editor.iconKey)}</strong><p>{editor.source === "user" ? "You chose this icon. Renaming keeps it." : suggested === "tag" ? "A neutral icon until you choose a closer match." : "Suggested from the name. Renaming updates it."}</p></div></section>
        {editor.source === "user" && <button type="button" className={styles.textAction} onClick={() => updateEditor({ source: "auto", iconKey: suggested })}>Use suggested icon</button>}
        {variant === "a" ? <>
          <h3 className={styles.sectionTitle}>Icons for this category</h3><div className={styles.suggestions}>{suggestionKeys.map(iconKey => <IconButton key={iconKey} iconKey={iconKey} selected={editor.iconKey === iconKey} onClick={() => updateEditor({ iconKey, source: "user" })} />)}</div>
          <details className={styles.inlineBrowse} data-inline-icons><summary>Browse all icons <ChevronRight size={16} aria-hidden="true" /></summary><div className={styles.picker}>{pickerContent(editor.iconKey, iconKey => updateEditor({ iconKey, source: "user" }))}</div></details>
        </> : <button type="button" data-choose-icon className={styles.changeIcon} onClick={() => { setPickerDraft(editor.iconKey); setQuery(""); }}><span>Change icon</span><ChevronRight size={17} aria-hidden="true" /></button>}
        {saveError && <p id="category-save-error" ref={errorRef} tabIndex={-1} className={styles.error} role="alert">{saveError}</p>}
      </div>
    </SheetFrame>}
    {pickerDraft !== null && editor && <SheetFrame nested title="Choose an icon" description="Choose an icon, then save the category to keep it." themeClass={theme} onClose={() => setPickerDraft(null)} footer={({ close }) => <div className={styles.footer}><button type="button" className={styles.primary} onClick={() => { updateEditor({ iconKey: pickerDraft, source: "user" }); close(); }}>Use this icon</button><button type="button" className={styles.secondary} onClick={close}>Cancel</button></div>}>
      <div className={styles.picker}>{pickerContent(pickerDraft, setPickerDraft)}</div>
    </SheetFrame>}
  </main>;
}
