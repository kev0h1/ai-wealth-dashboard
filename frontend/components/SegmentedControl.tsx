"use client";

interface SegmentedControlProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function SegmentedControl({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps) {
  return (
    <div
      className={`flex bg-slate-100 dark:bg-slate-700 rounded-xl p-1 gap-1 ${className}`}
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
              active
                ? "bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
