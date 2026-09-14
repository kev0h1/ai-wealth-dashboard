"use client";

// G75 production gate. The approved C treatment now lives in the real Spend
// components, so this preview renders those components without CSS overrides.
import SpendLiveClient from "../spend-live/SpendLiveClient";

export default function SpendHeaderRulesClient() {
  return (
    <div>
      <a
        href="#g75-spend-preview"
        className="sr-only z-[160] rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Skip to Spend preview
      </a>
      <div id="g75-spend-preview" tabIndex={-1}>
        <SpendLiveClient hidePreviewControls />
      </div>
    </div>
  );
}
