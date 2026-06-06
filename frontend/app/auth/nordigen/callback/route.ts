import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

function publicBase(request: NextRequest): string {
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "wealth.auriqltd.co.uk";
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const base = publicBase(request);

  try {
    // Forward all query params (ref, error, etc.) to the backend
    await fetch(`${BACKEND}/auth/nordigen/callback?${searchParams.toString()}`, {
      redirect: "follow",
    });
  } catch {
    // sync task may still have fired
  }

  const ref = searchParams.get("ref") || "";
  return NextResponse.redirect(`${base}/accounts?nordigen=connected&ref=${ref}`);
}
