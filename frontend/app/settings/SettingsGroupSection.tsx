import type { ReactNode } from "react";
import { SETTINGS_GROUP_ORDER, type SettingsGroup } from "./settingsGroupOrder";

export default function SettingsGroupSection({
  group,
  children,
}: {
  group: SettingsGroup;
  children: ReactNode;
}) {
  const item = SETTINGS_GROUP_ORDER.find((candidate) => candidate.id === group);
  if (!item) return null;

  return (
    <section id={item.id} aria-labelledby={`settings-group-${item.id}`} className="scroll-mt-6 space-y-3">
      <div className="border-y border-slate-300/80 py-4 dark:border-slate-700">
        <h2 id={`settings-group-${item.id}`} className="text-base font-bold text-slate-900 dark:text-slate-100">{item.title}</h2>
        <p className="mt-1 max-w-[65ch] text-[13px] leading-5 text-slate-600 dark:text-slate-400">{item.copy}</p>
      </div>
      <div className={group === "leave-delete" ? "" : "grid gap-3 lg:grid-cols-2 lg:items-start"}>
        {children}
      </div>
    </section>
  );
}
