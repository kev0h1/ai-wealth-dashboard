"use client";

import RelayClaimScreen from "@/components/RelayClaimScreen";
import { APPLE_RELAY_PROMPT_FIXTURE } from "./fixtures";

// D9: the real components/RelayClaimScreen.tsx, the screen LoginScreen shows
// when a Hide My Email sign-in is refused with RELAY_INVITE_CLAIM. Stub
// network actions, no fetching, no session.
export default function Page() {
  return (
    <RelayClaimScreen
      prompt={APPLE_RELAY_PROMPT_FIXTURE}
      onSend={async () => "sent"}
      onVerify={async () => "invalid"}
      onVerified={() => {}}
      onBack={() => {}}
    />
  );
}
