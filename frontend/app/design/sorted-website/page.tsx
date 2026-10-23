import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { robots: { index: false, follow: false } };
const directions = [
  { id: "a", title: "Product first", text: "A direct introduction to the estimate, with a real app example beside the message." },
  { id: "b", title: "Everyday money", text: "An editorial morning scene leads into the product, its limits and the decisions it supports." },
  { id: "c", title: "Clear perspective", text: "The app evidence leads a question-based introduction to cash, payments and plans." },
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const mode = query.mode === "dark" ? "dark" : "light";
  const variant = directions.find(item => item.id === query.variant)?.id ?? "a";
  return <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-900 dark:bg-slate-900 dark:text-slate-100 lg:px-8"><div className="mx-auto max-w-5xl">
    <h1 className="text-xl font-bold">Sorted website · homepage directions</h1>
    <p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 dark:text-slate-300">Three coded homepages for the separate public website. App examples use fictional figures. Choose a direction before the remaining pages and public deployment are built.</p>
    <nav aria-label="Preview theme" className="mt-5 flex gap-3">{["light", "dark"].map(theme => <Link prefetch={false} key={theme} href={`?variant=${variant}&mode=${theme}`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-medium active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600" aria-current={theme === mode ? "true" : undefined}>{theme === "light" ? "Light theme" : "Dark theme"}</Link>)}</nav>
    <div className="mt-6 grid gap-4 md:grid-cols-3">{directions.map(item => <article key={item.id} className={`rounded-2xl border bg-white p-5 dark:bg-slate-800 ${item.id === variant ? "border-indigo-500" : "border-slate-200 dark:border-slate-700"}`}><h2 className="text-base font-bold">{item.id.toUpperCase()} · {item.title}</h2><p className="mt-3 text-[13px] leading-5 text-slate-600 dark:text-slate-300">{item.text}</p><a href={`/design/sorted-website/${item.id}/${mode}.html`} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white hover:bg-indigo-700 active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">Open full homepage</a></article>)}</div>
    <p className="mt-6 max-w-2xl text-[12px] leading-5 text-slate-600 dark:text-slate-300">The previews have no forms, analytics or tracking cookies. Web sign-in works; App Store and Google Play links are awaiting verified listing URLs. Prices and regulatory copy are checked against the app’s source values.</p>
  </div></main>;
}
