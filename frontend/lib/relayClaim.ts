// D9: client side of the Apple Hide My Email relay claim. Pure and
// dependency-free so the refusal decoding is testable under plain Node
// (scripts/relay-claim.test.mjs).
//
// The backend refuses a closed-sign-up Apple sign-in with 403 and a stable
// `detail.code`: "INVITE_ONLY" for an ordinary address, "RELAY_INVITE_CLAIM"
// for a privaterelay.appleid.com address (carrying a signed claim_token). The
// client switches on the code only, never on message text.

export const RELAY_INVITE_CLAIM_CODE = "RELAY_INVITE_CLAIM";
export const INVITE_ONLY_CODE = "INVITE_ONLY";
export const RELAY_SEND_CODE_PATH = "/auth/apple/relay/send-code";
export const RELAY_VERIFY_CODE_PATH = "/auth/apple/relay/verify-code";

export type AppleRefusal =
  | { kind: "invite_only" }
  | { kind: "relay_claim"; claimToken: string; prompt: string };

export function classifyAppleRefusal(status: number, body: unknown): AppleRefusal | null {
  if (status !== 403) return null;
  const detail = (body as { detail?: { code?: unknown; claim_token?: unknown; link_existing_prompt?: unknown } } | null)?.detail;
  if (!detail || typeof detail !== "object") return null;
  if (detail.code === INVITE_ONLY_CODE) return { kind: "invite_only" };
  if (detail.code === RELAY_INVITE_CLAIM_CODE && typeof detail.claim_token === "string" && detail.claim_token) {
    return {
      kind: "relay_claim",
      claimToken: detail.claim_token,
      prompt: typeof detail.link_existing_prompt === "string" ? detail.link_existing_prompt : "",
    };
  }
  return null;
}

export type ClaimVerifyOutcome = "ok" | "invalid" | "locked" | "failed";

export function classifyVerifyStatus(status: number): ClaimVerifyOutcome {
  if (status === 429) return "locked";
  if (status === 401) return "invalid";
  return status >= 200 && status < 300 ? "ok" : "failed";
}
