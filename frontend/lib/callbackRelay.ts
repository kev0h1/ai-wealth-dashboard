// Transparent relay of the backend's bank-callback decision (A68). Providers land
// on the Next route (FINEXER_RETURN_URL points at the frontend), which forwards to
// the backend callback and hands back exactly what the backend decided: a 303 to
// the web app, or the hashed-CSP hand-off page for a native connect. Plain Response
// (no next/server) so it can be tested under node.
import { bankHandoffHtml, bankHandoffCsp } from "@wealth/shared";

export function publicBase(headers: Pick<Headers, "get">): string {
  const proto = headers.get("x-forwarded-proto") || "https";
  const host = headers.get("x-forwarded-host") || headers.get("host") || "wealth.auriqltd.co.uk";
  return `${proto}://${host}`;
}

async function errorPage(provider: string, connectionId: string): Promise<Response> {
  const page = bankHandoffHtml(false, { provider, connectionId, autoReturn: false });
  return new Response(page, {
    status: 502,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": await bankHandoffCsp(page),
    },
  });
}

/** `backendUrl` is the full backend callback URL including the forwarded query. */
export async function relayBackendCallback(opts: {
  provider: string;
  connectionId: string;
  backendUrl: string;
  publicBase: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.backendUrl, { redirect: "manual" });
  } catch {
    return errorPage(opts.provider, opts.connectionId);
  }

  if (res.status === 303) {
    const location = res.headers.get("location");
    if (location) {
      // Keep path and query exactly; only the origin is pinned to the public host
      // the user is actually on, because the backend's APP_URL may name a
      // different host than this environment's (UAT vs production).
      const loc = new URL(location, opts.publicBase);
      const target = new URL(opts.publicBase);
      target.pathname = loc.pathname;
      target.search = loc.search;
      return Response.redirect(target.toString(), 303);
    }
  }

  const csp = res.headers.get("content-security-policy");
  if (res.status === 200 && csp && (res.headers.get("content-type") ?? "").startsWith("text/html")) {
    return new Response(await res.text(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": csp },
    });
  }

  return errorPage(opts.provider, opts.connectionId);
}
