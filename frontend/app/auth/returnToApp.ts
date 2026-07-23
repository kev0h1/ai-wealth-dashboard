import { NextResponse } from "next/server";

// Returns an HTML page that hands control back to the native app via the
// wealthdash:// deep link (which closes the in-app Chrome Custom Tab /
// SFSafariViewController and triggers a WebView reload). Desktop/web users,
// where the custom scheme does nothing, get a clean 302 redirect instead.
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
  h1{color:${color};font-size:24px;margin:0 0 12px}
  p{color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px}
  .btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:14px;font-size:16px;font-weight:600;
       cursor:pointer;border:none;-webkit-tap-highlight-color:transparent}
</style></head>
<body>
  <div class="icon">${icon}</div>
  <h1>${heading}</h1>
  <p>${sub}</p>
  <button class="btn" onclick="returnToApp()">Return to app</button>
  <script>
    var FALLBACK=${JSON.stringify(fallbackUrl)};
    function returnToApp(){window.location.href='wealthdash://auth-complete';}
    // Auto-attempt the deep link; if we're still here after a beat (desktop
    // web, where wealthdash:// does nothing) fall back to the web page.
    setTimeout(function(){
      var t=Date.now();
      window.location.href='wealthdash://auth-complete';
      setTimeout(function(){
        if(Date.now()-t<1800){window.location.href=FALLBACK;}
      },1500);
    },600);
  </script>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
