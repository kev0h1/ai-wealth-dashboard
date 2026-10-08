"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import RelayClaimScreen from "@/components/RelayClaimScreen";
import { APPLE_RELAY_PROMPT_FIXTURE } from "./fixtures";

// D9: the real components/RelayClaimScreen.tsx, the screen LoginScreen shows
// when a Hide My Email sign-in is refused with RELAY_INVITE_CLAIM.
// ?email=on|off picks whether the backend's email_claim_available is true.
// Stub network actions, no fetching, no session.
function Preview() {
  const on = useSearchParams().get("email") !== "off";
  return (
    <RelayClaimScreen
      prompt={APPLE_RELAY_PROMPT_FIXTURE}
      emailClaimAvailable={on}
      onSend={async () => "sent"}
      onVerify={async () => "invalid"}
      onVerified={() => {}}
      onBack={() => {}}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
