// Test-only host for the real production components. No customer API calls.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import PennyPermissionSettings from "@/components/settings/PennyPermissionSettings";
import { ProfileSettingsForm } from "@/components/settings/ProfileSettingsForm";
import YourPlanCard from "@/components/YourPlanCard";
import { api } from "@/lib/api";
import { planFixture, type PlanState } from "./g296-settings";
const params = new URLSearchParams(location.search), state = params.get("state") ?? "off";
const calls = { grant: 0, revoke: 0, refresh: 0, profile: 0 };
Object.assign(window, { g296Calls: calls });
let server = { penny_agent_consent: state === "on" ? "timestamp" : null, version: 1 };
let fail = state === "save-error" || state === "unknown";
api.grantPennyAgentConsent = async () => {
  calls.grant++;
  if (state === "save-error" && fail) { fail = false; throw Error("offline"); }
  server = { penny_agent_consent: "timestamp", version: server.version + 1 };
  if (state === "lost-response") throw Error("response lost after applying");
  return { penny_agent_consent: "timestamp" };
};
api.revokePennyAgentConsent = async () => {
  calls.revoke++;
  server = { penny_agent_consent: null, version: server.version + 1 };
  return { penny_agent_consent: null, proposals_cancelled: 2 };
};
const noop = () => {};
const router = { bfcacheId: "g296-browser", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
function Host() {
  const [snapshot, setSnapshot] = useState<typeof server | null>(state === "unavailable" ? null : server);
  const [ready, setReady] = useState(state !== "loading");
  const [name, setName] = useState("Alex Morgan"), [saved, setSaved] = useState(name), [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState(state === "profile-error");
  const refresh = async () => {
    calls.refresh++;
    if (state === "unknown" && fail) { fail = false; return null; }
    setSnapshot({ ...server }); setReady(true); return { ...server };
  };
  return <AppRouterContext.Provider value={router}><main data-g296-production className="mx-auto max-w-xl px-4 py-6">
    {params.get("view") === "profile" ? <><h1 className="mb-4 text-2xl font-bold">Your account</h1><h2 className="text-base font-bold">Profile</h2><p className="mt-1 mb-3 text-[13px] text-slate-600 dark:text-slate-400">Your name in Sorted.</p><div className="glass-card rounded-2xl"><ProfileSettingsForm name={name} loading={false} loadError={loadError} saving={false} dirty={name.trim() !== saved} status={status} onChange={setName} onSave={() => { calls.profile++; setSaved(name.trim()); setStatus("Profile saved"); }} onRetry={() => setLoadError(false)} /></div></> : <><h1 className="mb-4 text-2xl font-bold">Penny and your plan</h1><h2 className="mb-3 text-base font-bold">Your plan</h2><YourPlanCard info={planFixture((params.get("plan") ?? "paid") as PlanState, "web")} error={params.get("plan") === "error"} /><PennyPermissionSettings ready={ready} snapshot={snapshot} refresh={refresh} /></>}
  </main></AppRouterContext.Provider>;
}
document.documentElement.classList.toggle("dark", params.get("mode") === "dark");
document.documentElement.style.colorScheme = params.get("mode") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(<Host />);
