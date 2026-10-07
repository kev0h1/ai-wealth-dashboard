import { NextRequest } from "next/server";
import { publicBase, relayBackendCallback } from "@/lib/callbackRelay";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  if (process.env.MOBILE_EXPORT === "1") return new Response(null, { status: 204 });
  const { searchParams } = new URL(request.url);
  const consent = searchParams.get("fx_consent") || searchParams.get("consent") || "";
  const params = new URLSearchParams();
  if (consent) params.set("consent", consent);
  const state = searchParams.get("state");
  if (state) params.set("state", state);
  const error = searchParams.get("error");
  if (error) params.set("error", error);

  return relayBackendCallback({
    provider: "finexer",
    connectionId: consent || "unknown",
    backendUrl: `${BACKEND}/auth/finexer/callback?${params}`,
    publicBase: publicBase(request.headers),
  });
}
