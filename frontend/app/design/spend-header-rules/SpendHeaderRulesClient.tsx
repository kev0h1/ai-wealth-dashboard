"use client";

// G75 design round. This wraps /design/spend-live's production-component
// render and changes only the separator treatment through preview-scoped CSS.
// No application component, data contract or interaction is forked here.

import { useSearchParams } from "next/navigation";
import SpendLiveClient from "../spend-live/SpendLiveClient";

type Variant = "a" | "b" | "c";
type Mode = "light" | "dark";

const VARIANTS: { key: Variant; label: string; description: string }[] = [
  {
    key: "a",
    label: "Open canvas",
    description: "No structural rules. Spacing and the existing control surfaces carry the hierarchy.",
  },
  {
    key: "b",
    label: "Section close",
    description: "One quiet rule closes the jump strip before the pay-period verdict begins.",
  },
  {
    key: "c",
    label: "Ledger cue",
    description: "One quiet rule introduces the In, Out and Moved figures as evidence.",
  },
];

function hrefFor(variant: Variant, mode: Mode) {
  return `?variant=${variant}&mode=${mode}&state=normal`;
}

export default function SpendHeaderRulesClient() {
  const params = useSearchParams();
  const rawVariant = params.get("variant");
  const variant: Variant = rawVariant === "b" || rawVariant === "c" ? rawVariant : "a";
  const mode: Mode = params.get("mode") === "dark" ? "dark" : "light";
  const selected = VARIANTS.find((item) => item.key === variant) ?? VARIANTS[0];

  return (
    <div data-g75-variant={variant}>
      <a
        href="#g75-spend-preview"
        className="sr-only z-[160] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to Spend preview
      </a>
      <style>{`
        [data-g75-variant] .max-w-6xl > header {
          border-bottom-width: 0 !important;
        }

        [data-g75-variant="a"] .max-w-6xl > header + .sticky,
        [data-g75-variant="c"] .max-w-6xl > header + .sticky {
          border-top-width: 0 !important;
          border-bottom-width: 0 !important;
        }

        [data-g75-variant="a"] [data-tutorial-id="tutorial-spend-verdict"] > dl,
        [data-g75-variant="b"] [data-tutorial-id="tutorial-spend-verdict"] > dl {
          border-top-width: 0 !important;
          border-bottom-width: 0 !important;
        }

        [data-g75-variant="b"] .max-w-6xl > header + .sticky {
          border-top-width: 0 !important;
          border-bottom-width: 1px !important;
          border-bottom-color: rgb(148 163 184 / 0.24) !important;
        }

        [data-g75-variant="b"] .dark .max-w-6xl > header + .sticky,
        .dark [data-g75-variant="b"] .max-w-6xl > header + .sticky {
          border-bottom-color: rgb(255 255 255 / 0.1) !important;
        }

        [data-g75-variant="c"] [data-tutorial-id="tutorial-spend-verdict"] > dl {
          border-top-width: 1px !important;
          border-bottom-width: 0 !important;
          border-top-color: rgb(148 163 184 / 0.24) !important;
        }

        [data-g75-variant="c"] .dark [data-tutorial-id="tutorial-spend-verdict"] > dl,
        .dark [data-g75-variant="c"] [data-tutorial-id="tutorial-spend-verdict"] > dl {
          border-top-color: rgb(255 255 255 / 0.1) !important;
        }
      `}</style>

      <div id="g75-spend-preview" tabIndex={-1}>
        <SpendLiveClient hidePreviewControls />
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 z-[150] flex justify-center px-3"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <nav
          aria-label="G75 separator variants"
          className="pointer-events-auto w-full max-w-[430px] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 text-white shadow-xl"
        >
          <p className="px-2 pb-1 pt-0.5 text-[10px] leading-4 text-slate-400">
            {selected.description}
          </p>
          <div className="flex items-center gap-1">
            {VARIANTS.map((item) => (
              <a
                key={item.key}
                href={hrefFor(item.key, mode)}
                aria-current={item.key === variant ? "page" : undefined}
                aria-label={`Variant ${item.key.toUpperCase()}: ${item.label}`}
                className={`flex min-h-11 min-w-11 flex-1 touch-manipulation items-center justify-center rounded-xl px-2 text-xs font-bold [-webkit-tap-highlight-color:transparent] transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none ${
                  item.key === variant ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.key.toUpperCase()}
              </a>
            ))}
            <span className="h-6 w-px bg-white/15" aria-hidden="true" />
            <a
              href={hrefFor(variant, mode === "dark" ? "light" : "dark")}
              className="flex min-h-11 touch-manipulation items-center rounded-xl px-3 text-xs font-semibold text-slate-300 [-webkit-tap-highlight-color:transparent] transition-[color,transform] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none"
            >
              {mode === "dark" ? "Light" : "Dark"}
            </a>
          </div>
        </nav>
      </div>
    </div>
  );
}
