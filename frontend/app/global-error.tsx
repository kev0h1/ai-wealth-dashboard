"use client";

// G215: last-resort boundary that replaces the root layout, so it cannot rely on
// Tailwind, fonts, providers or the theme class. Self-contained: inline tokens from
// DESIGN.md (canvas, ink, indigo primary) and prefers-color-scheme for dark. The
// thrown error is never shown. Plain <a>, not next/link, because the router may be
// the thing that broke.
const CSS = `
:root{--canvas:#f0f2f7;--border:#e2e8f0;--ink:#0f172a;--secondary:#475569;--primary:#4f46e5;--hover:#4338ca;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--canvas:#0f172a;--border:#334155;--ink:#f1f5f9;--secondary:#94a3b8}}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{display:flex;flex-direction:column;max-width:430px;min-height:100vh;min-height:100dvh;margin:0 auto;padding:28px 24px max(24px,env(safe-area-inset-bottom))}
.brand{margin:0;padding-bottom:20px;border-bottom:1px solid var(--border);color:var(--secondary);font-size:12px}
.brand strong{color:var(--ink);font-size:16px;font-weight:600}
.verdict{padding:clamp(40px,12vh,112px) 0 48px}
h1{margin:0;font-size:30px;font-weight:700;line-height:1.2;letter-spacing:-.025em;text-wrap:balance}
p.msg{max-width:280px;margin:16px 0 0;color:var(--secondary);text-wrap:pretty}
.actions{margin-top:auto;padding-top:24px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
a.primary,button.secondary{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;padding:12px 16px;border:0;border-radius:12px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
a.primary{background:var(--primary);color:#fff}
a.primary:hover{background:var(--hover)}
button.secondary{min-height:44px;background:transparent;color:var(--secondary)}
a:focus-visible,button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
`;

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Sorted</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <main aria-labelledby="heading">
          <p className="brand"><strong>Sorted</strong> by Auriq</p>
          <div className="verdict">
            <h1 id="heading">Something went wrong</h1>
            <p className="msg">Sorted couldn’t start properly. Nothing has changed in your accounts. Try again, or head back to Home.</p>
          </div>
          <div className="actions">
            <a className="primary" href="/">Back to Home</a>
            <button type="button" className="secondary" onClick={reset}>Try again</button>
          </div>
        </main>
      </body>
    </html>
  );
}
