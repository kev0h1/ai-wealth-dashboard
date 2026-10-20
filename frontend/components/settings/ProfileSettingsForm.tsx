"use client";

export function ProfileSettingsForm({ name, loading, loadError, saving, dirty, status, onChange, onSave, onRetry }: {
  name: string; loading: boolean; loadError: boolean; saving: boolean; dirty: boolean; status: string;
  onChange: (name: string) => void; onSave: () => void; onRetry: () => void;
}) {
  return <form onSubmit={event => { event.preventDefault(); if (dirty && !saving && !loading && !loadError) onSave(); }} className="p-4">
    <label htmlFor="settings-name" className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Full name</label>
    <input id="settings-name" name="full-name" autoComplete="name" aria-describedby="profile-name-help profile-save-status" disabled={loading || loadError || saving} value={name} onChange={event => onChange(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-base text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
    <p id="profile-name-help" className="mt-1 text-xs text-slate-600 dark:text-slate-400">Used to recognise transfers between your own accounts.</p>
    <button type="submit" disabled={!dirty || saving || loading || loadError} className="mt-4 min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition-transform motion-reduce:transition-none hover:bg-indigo-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-slate-800">{saving ? "Saving…" : "Save profile"}</button>
    <p id="profile-save-status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-slate-700 dark:text-slate-200">{loading ? "Loading profile…" : loadError ? "Could not load your profile. Try again." : status}</p>
    {loadError && <button type="button" onClick={onRetry} className="mt-1 min-h-11 rounded-xl px-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-900/20">Try again</button>}
  </form>;
}
