import { ChevronRight, HelpCircle, ShieldCheck } from "lucide-react";
import SettingsCard, { SettingsCardHeader } from "./SettingsCard";
import Toggle from "@/components/Toggle";

const INDIGO = "#4f46e5";

export type SettingsTutorial = { id: string; label: string; blurb: string };

export function SettingsTutorialsCard({
  flows,
  onStart,
}: {
  flows: SettingsTutorial[];
  onStart: (id: string) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardHeader icon={HelpCircle} hex={INDIGO} title="How Sorted works" subtitle="Replay any screen's tour" />
      {flows.map((flow, i) => (
        <button key={flow.id} type="button" onClick={() => onStart(flow.id)} className={`w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-70 transition-opacity${i > 0 ? " border-t border-slate-100 dark:border-slate-700" : ""}`}>
          <span className="min-w-0"><span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{flow.label}</span><span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{flow.blurb}</span></span>
          <ChevronRight size={16} className="shrink-0 text-slate-400 dark:text-slate-500" />
        </button>
      ))}
    </SettingsCard>
  );
}

export function SettingsHelpCard({ onTerms, onPrivacy }: { onTerms: () => void; onPrivacy: () => void }) {
  return (
    <SettingsCard>
      <SettingsCardHeader icon={HelpCircle} hex={INDIGO} title="Help" />
      <button type="button" onClick={onTerms} className="w-full min-h-[44px] flex items-center justify-between gap-3 px-4 py-3.5 text-left active:opacity-70 transition-opacity"><span className="text-sm font-medium text-slate-800 dark:text-slate-100">Terms &amp; Conditions</span><ChevronRight size={16} className="shrink-0 text-slate-400 dark:text-slate-500" /></button>
      <button type="button" onClick={onPrivacy} className="w-full min-h-[44px] flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3.5 text-left active:opacity-70 transition-opacity dark:border-slate-700"><span className="text-sm font-medium text-slate-800 dark:text-slate-100">Privacy Policy</span><ChevronRight size={16} className="shrink-0 text-slate-400 dark:text-slate-500" /></button>
    </SettingsCard>
  );
}

export function SettingsSecurityCard({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <SettingsCard id="settings-security" className="scroll-mt-4">
      <SettingsCardHeader icon={ShieldCheck} hex="#10b981" title="Security" />
      <div className="flex items-center justify-between px-4 py-3.5">
        <div><p className="text-sm font-medium text-slate-800 dark:text-slate-100">Biometric unlock</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Require fingerprint or face to open the app</p></div>
        <Toggle checked={enabled} onChange={onChange} label="Biometric login" />
      </div>
    </SettingsCard>
  );
}
