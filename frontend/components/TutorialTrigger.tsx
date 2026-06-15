"use client";

import { HelpCircle } from "lucide-react";
import { useTutorial } from "./TutorialContext";

export default function TutorialTrigger({
  className = "",
  variant = "light-on-color",
}: {
  className?: string;
  variant?: "light-on-color" | "dark-on-white";
}) {
  const { start } = useTutorial();
  const isOnColor = variant === "light-on-color";
  return (
    <button
      onClick={start}
      aria-label="Open tutorial"
      className={`w-8 h-8 flex items-center justify-center rounded-full active:scale-90 transition-all ${
        isOnColor
          ? "bg-white/20 hover:bg-white/30"
          : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
      } ${className}`}
    >
      <HelpCircle
        size={17}
        color={isOnColor ? "rgba(255,255,255,0.85)" : "#64748b"}
      />
    </button>
  );
}
