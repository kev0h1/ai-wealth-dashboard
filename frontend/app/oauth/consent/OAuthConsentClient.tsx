"use client";

// F2: /oauth/consent — where GET /auth/oauth/authorize (app/routers/oauth.py)
// sends the browser after validating a connector's request. This page is
// exempt from AuthProvider's usual gate (see components/AuthProvider.tsx),
// so it manages its own auth end to end:
//
// - No session yet: stash `req` in sessionStorage and render LoginScreen
//   directly. Google's callback always lands back on `${APP_URL}/?token=...`
//   (never back here), so AuthProvider itself restores the detour once the
//   session is confirmed (see its own comment for that half).
// - Session present: fetch the pending request's details and show the
//   real consent card; Approve/Deny post the decision and follow the
//   redirect it returns, back to the connector.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getToken } from "@/lib/auth";
import { api, type OAuthRequestDetails } from "@/lib/api";
import LoginScreen from "@/components/LoginScreen";
import OAuthConsentCard from "./OAuthConsentCard";
import { MCP_CONNECTOR } from "@/lib/featureFlags";

const PENDING_REQ_KEY = "wd_oauth_consent_req";

type Stage = "loading" | "need-login" | "ready" | "expired" | "error" | "done" | "unavailable";

export default function OAuthConsentClient() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get("req") || "";

  const [stage, setStage] = useState<Stage>("loading");
  const [details, setDetails] = useState<OAuthRequestDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A17: the connector isn't live yet. No session check, no sessionStorage
    // write, no request lookup, none of it, just the calm placeholder below.
    if (!MCP_CONNECTOR) {
      setStage("unavailable");
      return;
    }
    if (!reqId) {
      setStage("error");
      return;
    }
    if (!getToken()) {
      try {
        sessionStorage.setItem(PENDING_REQ_KEY, reqId);
      } catch {}
      setStage("need-login");
      return;
    }
    let cancelled = false;
    api.getOAuthRequest(reqId)
      .then((d) => {
        if (cancelled) return;
        setDetails(d);
        setStage("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStage("expired");
      });
    return () => {
      cancelled = true;
    };
  }, [reqId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { redirect } = await api.decideOAuthRequest(reqId, approve);
      setStage("done");
      window.location.assign(redirect);
    } catch {
      setBusy(false);
      setError("Something went wrong. Please try connecting again.");
    }
  }

  if (stage === "loading" || stage === "done") {
    return <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]" />;
  }

  if (stage === "unavailable") {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            This feature is not available yet
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Connecting an AI assistant to Sorted is not open yet. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  if (stage === "need-login") {
    return <LoginScreen />;
  }

  if (stage === "error" || stage === "expired") {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            This request has expired
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            Please go back to the assistant you were connecting and try again.
          </p>
        </div>
      </div>
    );
  }

  if (!details) return null;

  return (
    <OAuthConsentCard
      clientName={details.client_name}
      redirectHost={details.redirect_host}
      scopes={details.scopes}
      onApprove={() => decide(true)}
      onDeny={() => decide(false)}
      busy={busy}
      error={error}
    />
  );
}
