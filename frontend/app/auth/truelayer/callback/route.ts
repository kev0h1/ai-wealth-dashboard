import { NextRequest } from "next/server";
import { returnToAppPage } from "@/app/auth/returnToApp";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

function publicBase(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "wealth.auriqltd.co.uk";
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  if (process.env.MOBILE_EXPORT === "1") return new Response(null, { status: 204 });
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
