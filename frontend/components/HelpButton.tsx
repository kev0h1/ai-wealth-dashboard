"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import TutorialModal from "./TutorialModal";

export default function HelpButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Help & Tutorial"
        className="fixed right-4 z-50 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-slate-800/90 shadow-md border border-slate-200/60 dark:border-slate-700/60 backdrop-blur active:scale-90 transition-transform"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
      >
        <HelpCircle size={16} className="text-slate-500 dark:text-slate-400" />
      </button>
      <TutorialModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
