"use client";

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string; // accessible name (aria-label)
  disabled?: boolean;
  onColor?: string; // tailwind bg class for ON track, default indigo
}

/**
 * Accessible toggle switch (role="switch").
 *
 * Visual dimensions match the existing hand-rolled toggles on SettingsPage:
 *   Track:  w-12 h-6 (48×24px), rounded-full
 *   Knob:   w-5 h-5 (20×20px), absolute, top-0.5 left-0.5 when OFF
 *           translates translate-x-6 (24px) when ON
 * Focus ring: 2px indigo ring per DESIGN.md §5.
 */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled,
  onColor = "bg-indigo-500",
}: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${
        checked ? onColor : "bg-slate-200 dark:bg-slate-600"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}
