import { NextRequest } from "next/server";
import { publicBase, relayBackendCallback } from "@/lib/callbackRelay";
import { LEGACY_BANK_AVAILABLE } from "@/lib/legacyBankProvider";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  if (process.env.MOBILE_EXPORT === "1") return new Response(null, { status: 204 });
  // A67: this file cannot be conditionally compiled away — App Router routes
  // come from the filesystem, and the directory name is the redirect URI
  // registered in TrueLayer's own console, so renaming it is Kevin's
  // infrastructure step, not a code change. Refusing here is the equivalent:
  // in a production build there is no legacy provider, the backend mounts no
  // /auth/truelayer/callback to proxy to (app.core.config.TRUELAYER_ENABLED),
  // and this handler is a 404 rather than a proxy to a 404.
  if (!LEGACY_BANK_AVAILABLE) return new Response(null, { status: 404 });
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  const code = searchParams.get("code");
  if (code) params.set("code", code);
  const state = searchParams.get("state");
  if (state) params.set("state", state);
  const error = searchParams.get("error");
  if (error) params.set("error", error);

  return relayBackendCallback({
    provider: "truelayer",
    connectionId: state || "unknown",
    backendUrl: `${BACKEND}/auth/truelayer/callback?${params}`,
    publicBase: publicBase(request.headers),
  });
}
