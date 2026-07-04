import { Info } from "lucide-react";

export default function AdviceDisclaimer({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-start gap-2 px-1 ${className}`}>
      <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" />
      <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Figures and suggestions here are for general information only and are not
        regulated financial advice. Consider your own circumstances and seek advice
        from a qualified adviser before making financial decisions.
      </p>
    </div>
  );
}
