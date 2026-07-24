"use client";

import { useState, useRef, useEffect, useId } from "react";
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
  ariaLabel?: string;
}

export default function CustomSelect({ value, onChange, options, placeholder, className = "", ariaLabel }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected = options.find(o => String(o.value) === String(value));

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Reset active index when opening; initialise to selected item
  useEffect(() => {
    if (open) {
      const idx = options.findIndex(o => String(o.value) === String(value));
      setActiveIdx(idx >= 0 ? idx : 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll active option into view
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (open && activeIdx >= 0) {
      optionRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open]);

  // Position the dropdown above if too close to the bottom of the viewport
  const [dropUp, setDropUp] = useState(false);
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    setDropUp(spaceBelow < 240);
  }, [open]);

  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < options.length) {
        onChange(String(options[activeIdx].value));
        setOpen(false);
        triggerRef.current?.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={open ? handleListKeyDown : undefined}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleTriggerKeyDown}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-sm text-left transition-colors ${
          open
            ? "border-indigo-400 dark:border-indigo-500 bg-white dark:bg-slate-900 ring-2 ring-indigo-100 dark:ring-indigo-900/40"
            : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-500"
        } ${selected ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}
      >
        <span className="truncate">{selected ? selected.label : (placeholder ?? "Select…")}</span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute z-50 w-full min-w-[160px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden ${
            dropUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value);
            const isActive = idx === activeIdx;
            return (
              <button
                key={opt.value}
                ref={el => { optionRefs.current[idx] = el; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onChange(String(opt.value)); setOpen(false); triggerRef.current?.focus(); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium"
                    : isActive
                    ? "bg-slate-50 dark:bg-slate-700/50 text-slate-800 dark:text-slate-100"
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
