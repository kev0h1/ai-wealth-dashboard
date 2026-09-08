"use client";

// TEMPORARY PREVIEW — delete after design review.
// F2: /oauth/consent's real card (app/oauth/consent/OAuthConsentCard.tsx)
// against a static fixture, no fetching, no session. Approve/Deny just log
// to the console here — the live page wires them to
// api.decideOAuthRequest and window.location.assign.
//
// ?mode=light|dark

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import OAuthConsentCard from "@/app/oauth/consent/OAuthConsentCard";
import { OAUTH_SCOPE_LABELS } from "@/lib/oauthScopes";

const FIXTURE = {
  clientName: "Claude",
  redirectHost: "claude.ai",
  // F4: sourced from the shared label map (lib/oauthScopes.ts) so this
  // fixture can't drift from the "Connected assistants" card's own scope
  // wording — both are kept word for word in sync with the backend's
  // SCOPE_DESCRIPTIONS (backend/app/routers/oauth.py).
  scopes: Object.entries(OAUTH_SCOPE_LABELS).map(([scope, description]) => ({ scope, description })),
};

function PreviewBody() {
  const params = useSearchParams();
  const dark = params.get("mode") === "dark";
  return (
    <div className={dark ? "dark bg-[#0f172a] min-h-dvh" : "bg-[#f0f2f7] min-h-dvh"}>
      <OAuthConsentCard
        clientName={FIXTURE.clientName}
        redirectHost={FIXTURE.redirectHost}
        scopes={FIXTURE.scopes}
        onApprove={() => console.log("approve")}
        onDeny={() => console.log("deny")}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PreviewBody />
    </Suspense>
  );
}
