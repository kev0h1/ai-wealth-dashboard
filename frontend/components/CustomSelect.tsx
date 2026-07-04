"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Option {
  value: string | number;
  label: string;
}

interface CustomSelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

export default function CustomSelect({ value, onChange, options, placeholder, className = "" }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find(o => String(o.value) === String(value));

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Position the dropdown above if too close to the bottom of the viewport
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropUp, setDropUp] = useState(false);
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    setDropUp(spaceBelow < 240);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-sm text-left transition-colors ${
          open
            ? "border-indigo-400 dark:border-indigo-500 bg-white dark:bg-slate-900 ring-2 ring-indigo-100 dark:ring-indigo-900/40"
            : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-500"
        } ${selected ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}
      >
        <span className="truncate">{selected ? selected.label : (placeholder ?? "Select…")}</span>
        <ChevronDown
          size={15}
          className={`flex-shrink-0 text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute z-50 w-full min-w-[160px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          {options.map(opt => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(String(opt.value)); setOpen(false); }}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                }`}
              >
                {opt.label}
                {isSelected && <Check size={14} className="text-indigo-500 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
