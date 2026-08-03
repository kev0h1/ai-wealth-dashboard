import { NextResponse } from "next/server";

// Returns an HTML page that hands control back to the native app via the
// wealthdash:// deep link (which closes the in-app Chrome Custom Tab /
// SFSafariViewController) or lets web/UAT users continue in the browser.
//
// WHY the auto-fire was removed (interim fix, approved 2026-07):
//   The native app opens bank auth via WebBrowser.openAuthSessionAsync(url,
//   "wealthdash://auth-complete"), which uses a Chrome Custom Tab carrying the
//   *system browser's* User-Agent — indistinguishable from ordinary mobile Chrome.
//   Auto-firing the deep link therefore hijacks UAT sessions in mobile Chrome.
//   PROPER FIX (deferred until next native rebuild): mark the flow at initiation
//   (e.g. a short-lived server-side token passed in the callback URL) so the
//   callback can tell the two cases apart without UA sniffing.

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function returnToAppPage(fallbackUrl: string, ok: boolean, userAgent = ""): NextResponse {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  if (!isMobile) {
    // Desktop web: skip the deep-link dance and go straight to the fallback URL.
    return NextResponse.redirect(fallbackUrl);
  }

  const heading = ok ? "Bank connected!" : "Couldn't connect";
  const sub = ok
    ? "Your account has been linked.<br>Transactions are syncing in the background."
    : "Something went wrong connecting your bank.<br>Please try again from the app.";
  const color = ok ? "#34d399" : "#f87171";
  const icon = ok ? "&#10003;" : "&#33;";
  const html = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       text-align:center;padding:60px 24px;background:#0f172a;color:#e2e8f0;margin:0}
  .icon{font-size:56px;margin-bottom:16px}
  h1{color:${color};font-size:30px;font-weight:700;letter-spacing:-0.025em;margin:0 0 12px}
  p{color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 32px}
  .actions{display:flex;flex-direction:column;gap:12px;align-items:center}
  .btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:10px 16px;border-radius:12px;font-size:14px;font-weight:600;
       cursor:pointer;border:none;-webkit-tap-highlight-color:transparent;width:220px;box-sizing:border-box}
  .btn-secondary{background:transparent;color:#94a3b8;border:1px solid #334155;
                 font-size:14px;font-weight:500;padding:10px 16px}
</style></head>
<body>
  <div class="icon">${icon}</div>
  <h1>${heading}</h1>
  <p>${sub}</p>
  <div class="actions">
    <a class="btn" href="${escHtml(fallbackUrl)}">Continue</a>
    <button class="btn btn-secondary" onclick="window.location.href='wealthdash://auth-complete'">Return to app</button>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
