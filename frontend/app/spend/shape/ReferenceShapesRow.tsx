"use client";

// "Ask Penny to explain:" reference row — production.
// Plain text, no card frame, matches the approved wireframe
// (app/design/insights-shape/shared.tsx's ReferenceShapesRow) with the
// wireframe-only `<a href="#">` links swapped for buttons that open a
// Penny explainer turn via onAskPenny. Reference only, never a target —
// no grading, no colour beyond the same indigo link treatment every other
// Penny hand-off on this page uses.

const REFERENCE_SHAPES: { label: string; ask: string }[] = [
  { label: "Example ranges", ask: "Explain the example ranges for Fixed, Moved and Free" },
  { label: "50/30/20 example", ask: "Explain the 50/30/20 rule" },
  { label: "Saving before spending", ask: "Explain saving before spending, also called pay yourself first" },
];

export default function ReferenceShapesRow({ onAskPenny }: { onAskPenny: (ask: string) => void }) {
  return (
    <div className="px-1">
      <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400 text-pretty">
        Ask Penny to explain:{" "}
        {REFERENCE_SHAPES.map((ref, i) => (
          <span key={ref.label}>
            <button
              onClick={() => onAskPenny(ref.ask)}
              className="inline-flex min-h-11 items-center text-indigo-600 dark:text-indigo-400 underline underline-offset-4 active:opacity-70 transition-opacity"
            >
              {ref.label}
            </button>
            {i < REFERENCE_SHAPES.length - 1 ? ", " : ""}
          </span>
        ))}
      </p>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        Opens a chat with Penny. Your chosen view stays the same.
      </p>
    </div>
  );
}
