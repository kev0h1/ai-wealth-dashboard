import { NextRequest } from "next/server";
import { returnToAppPage } from "@/app/auth/returnToApp";
import { LEGACY_BANK_AVAILABLE } from "@/lib/legacyBankProvider";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

function publicBase(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "wealth.auriqltd.co.uk";
  return `${proto}://${host}`;
}

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
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const base = publicBase(request);

  const ua = request.headers.get("user-agent") || "";

  if (error || !code) {
    return returnToAppPage(`${base}/accounts?error=bank_auth_failed`, false, ua);
  }

  try {
    const params = new URLSearchParams();
    params.set("code", code);
    if (state) params.set("state", state);

    await fetch(`${BACKEND}/auth/truelayer/callback?${params}`, { redirect: "follow" });
  } catch {
    // sync may still have fired
  }

  return returnToAppPage(`${base}/accounts?syncing=1`, true, ua);
}
