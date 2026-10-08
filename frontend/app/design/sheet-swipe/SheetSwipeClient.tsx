"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SheetFrame } from "@/components/SheetFrame";
import FixtureBottomNav from "../_components/FixtureBottomNav";
import { GoalPreview, fixtureGoal } from "../sheet-anatomy/SheetAnatomyClient";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export default function SheetSwipeClient() {
  const search = useSearchParams();
  const mode = search.get("mode") === "dark" ? "dark" : "light";
  const [sheet, setSheet] = useState<"goal" | "list" | "locked" | null>(null);
  const [goal, setGoal] = useState(() => fixtureGoal("long"));
  const [log, setLog] = useState("Nothing closed yet.");
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains("dark");
    const scheme = document.documentElement.style.colorScheme;
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    return () => { document.documentElement.classList.toggle("dark", wasDark); document.documentElement.style.colorScheme = scheme; };
  }, [mode]);
  const closed = (name: string) => { setSheet(null); setLog(`${name} closed at ${new Date().toLocaleTimeString("en-GB")}.`); };
  const rows = Array.from({ length: 30 }, (_, i) => `Example row ${i + 1}`);
  return <main className="min-h-dvh bg-[#f0f2f7] px-4 pb-36 pt-6 text-slate-900 dark:bg-[#0f172a] dark:text-slate-100 sm:px-6">
    <div className="mx-auto max-w-xl">
      <a href="/design" className={`${button} -ml-3 text-indigo-700 dark:text-indigo-300`}><ArrowLeft size={16} aria-hidden="true" />Design previews</a>
      <h1 className="mt-3 text-xl font-bold">Swipe a sheet down to close it</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">These are the real production sheet frame and the real safety net goal sheet. Try this on your phone.</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700 dark:text-slate-200">
        <li>Open a sheet and drag the small bar at the top down past a fifth of the sheet. It follows your finger and closes.</li>
        <li>Drag it down a short way and let go. It springs back.</li>
        <li>Flick down quickly, even a short way. It closes.</li>
        <li>Scroll the body down a little, then drag down. The list scrolls and the sheet stays put.</li>
        <li>Scroll the body back to the very top and drag down. Now the sheet follows your finger.</li>
        <li>Drag the title area down from anywhere in the header. It closes the same way.</li>
        <li>Open the locked sheet. Swiping does nothing, just like the cross, until it unlocks.</li>
        <li>The cross, backdrop and Back still work. Desktop dialogs have no bar and no swipe.</li>
      </ol>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => setSheet("goal")} className={`${button} bg-indigo-600 text-white`}>Open safety net goal</button>
        <button type="button" onClick={() => setSheet("list")} className={`${button} border border-slate-300 dark:border-slate-600`}>Open long list</button>
        <button type="button" onClick={() => setSheet("locked")} className={`${button} border border-slate-300 dark:border-slate-600`}>Open locked sheet</button>
        <a href={`?mode=${mode === "dark" ? "light" : "dark"}`} className={button}>{mode === "dark" ? "Light" : "Dark"} theme</a>
      </div>
      <p role="status" className="mt-5 text-sm leading-6 text-slate-600 dark:text-slate-300">{log}</p>
      <p className="mt-6 border-t border-slate-300 pt-4 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:text-slate-300">The grab bar is new: DESIGN.md said no handle without a gesture, and now there is one. It is a 36 by 4 pill in the slate border tone, shown on phones only.</p>
    </div>
    <FixtureBottomNav active="Planning" onPennyClick={() => {}} />
    {sheet === "goal" && <GoalPreview variant="focused" data={goal} onChange={setGoal} onClose={() => closed("Safety net goal")} onResult={setLog} failFirstSave={false} />}
    {sheet === "list" && <SheetFrame title="Long list" description="Scroll, then drag down from the top." onClose={() => closed("Long list")}
      footer={<button type="button" onClick={() => closed("Long list")} className={`${button} w-full bg-indigo-600 text-white`}>Done</button>}>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">{rows.map(r => <li key={r} className="py-4 text-sm">{r}</li>)}</ul>
    </SheetFrame>}
    {sheet === "locked" && <LockedSheet onClose={() => closed("Locked sheet")} />}
  </main>;
}

function LockedSheet({ onClose }: { onClose: () => void }) {
  const [saving, setSaving] = useState(true);
  useEffect(() => { const t = setTimeout(() => setSaving(false), 4000); return () => clearTimeout(t); }, []);
  return <SheetFrame variant="compact" title="Saving" dismissDisabled={saving} onClose={onClose}>
    <p className="text-sm leading-6">{saving ? "Pretending to save for four seconds. Swipe, cross and backdrop are all locked." : "Unlocked. Swipe down now."}</p>
  </SheetFrame>;
}
