#!/usr/bin/env bash
# A142: regenerate the published legal PDFs and their freshness manifest.
#
# Outputs (all committed):
#   frontend/public/TERMS.pdf, PRIVACY.pdf   printed from the production-mode
#       /terms and /privacy pages (served at wealth.auriqltd.co.uk/TERMS.pdf
#       and /PRIVACY.pdf; these are the copies cited to Finexer).
#   <repo root>/TERMS.pdf, PRIVACY.pdf, SECURITY.pdf   full-text copies of the
#       root markdown, rendered through components/LegalDocument.tsx.
#   frontend/public/legal-pdf-manifest.json   sha256 of each markdown source,
#       export date, page count and MCP flag state; read by
#       scripts/check-legal-pdfs-fresh.mjs (npm run check:legal-pdfs-fresh).
#
# MCP flag: the public export runs with NEXT_PUBLIC_MCP_CONNECTOR unset, to
# match production (connector off, "AI assistants" sections stripped). Before
# the connector launches on production, run with MCP_CONNECTOR=on to export
# with the flag on (see DEPLOY.md). The root PDFs always carry the full text.
#
# FRN / appointed-representative flag: there is none. Verified 2026-10-05 by
# grepping frontend/content, lib/legalContent.ts, lib/featureFlags.ts and the
# app code: the only flag that changes the rendered legal pages is
# NEXT_PUBLIC_MCP_CONNECTOR. The FRN wording (A5) is plain markdown text.
#
# Run from anywhere:  bash frontend/scripts/export-legal-pdfs.sh
# Needs >= 3000 MB free memory and no other `next build` running (H95).
# Never run in the shared tree (it would build into the live .next); use a
# worktree. Never prints environment values.
set -euo pipefail

FRONTEND="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="$(cd "$FRONTEND/.." && pwd)"
MCP="${MCP_CONNECTOR:-off}"
TODAY="$(date +%F)"
cd "$FRONTEND"

case "$FRONTEND" in
  "$(cd /root/ai-wealth-dashboard/frontend && pwd -P)") echo "refusing to build in the shared tree; use a worktree" >&2; exit 1 ;;
esac
command -v google-chrome >/dev/null || { echo "google-chrome not found" >&2; exit 1; }
FREE_MB="$(free -m | awk '/^Mem:/{print $7}')"
if [ "${FREE_MB:-0}" -lt 3000 ]; then echo "only ${FREE_MB} MB available, need 3000" >&2; exit 1; fi
if pgrep -f "[n]ext/dist/bin/next build" >/dev/null 2>&1; then
  echo "another next build is running" >&2; exit 1
fi

PORT="$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$FRONTEND/.next" "$FRONTEND/out" "$ROOT/ai-wealth-dashboard" "$FRONTEND/ai-wealth-dashboard"
  rm -f /tmp/a142-*.html
}
trap cleanup EXIT

if [ "$MCP" = "on" ]; then export NEXT_PUBLIC_MCP_CONNECTOR=on; else unset NEXT_PUBLIC_MCP_CONNECTOR; fi

npx next build
npx next start -p "$PORT" >/tmp/a142-next-start.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT/terms" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "http://127.0.0.1:$PORT/terms" >/dev/null || { echo "server did not come up" >&2; exit 1; }

print_pdf() { # <url-or-file> <out>
  google-chrome --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer \
    --virtual-time-budget=4000 --print-to-pdf="$2" "$1" >/dev/null 2>&1
  [ -s "$2" ] || { echo "failed to write $2" >&2; exit 1; }
}

print_pdf "http://127.0.0.1:$PORT/terms" "$FRONTEND/public/TERMS.pdf"
print_pdf "http://127.0.0.1:$PORT/privacy" "$FRONTEND/public/PRIVACY.pdf"

kill "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""

for name in TERMS PRIVACY SECURITY; do
  node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs scripts/render-legal-html.mjs \
    "$ROOT/$name.md" "/tmp/a142-$name.html"
  print_pdf "file:///tmp/a142-$name.html" "$ROOT/$name.pdf"
done

MCP="$MCP" TODAY="$TODAY" FRONTEND="$FRONTEND" ROOT="$ROOT" node -e '
const fs=require("fs"),cp=require("child_process"),crypto=require("crypto"),path=require("path");
const {MCP,TODAY,FRONTEND,ROOT}=process.env;
const sha=f=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const pages=f=>{try{return Number(/^Pages:\s+(\d+)/m.exec(cp.execFileSync("pdfinfo",[f],{encoding:"utf8"}))[1])}catch{return null}};
const rel=f=>path.relative(path.join(FRONTEND,".."),f);
const entry=(pdf,src,flag)=>({pdf:rel(pdf),source:rel(src),source_sha256:sha(src),exported:TODAY,pages:pages(pdf),mcp_connector:flag});
const m={generated_by:"frontend/scripts/export-legal-pdfs.sh",entries:[
 entry(path.join(FRONTEND,"public/TERMS.pdf"),path.join(FRONTEND,"content/terms.md"),MCP),
 entry(path.join(FRONTEND,"public/PRIVACY.pdf"),path.join(FRONTEND,"content/privacy.md"),MCP),
 entry(path.join(ROOT,"TERMS.pdf"),path.join(ROOT,"TERMS.md"),"full-text"),
 entry(path.join(ROOT,"PRIVACY.pdf"),path.join(ROOT,"PRIVACY.md"),"full-text"),
 entry(path.join(ROOT,"SECURITY.pdf"),path.join(ROOT,"SECURITY.md"),"full-text")]};
fs.writeFileSync(path.join(FRONTEND,"public/legal-pdf-manifest.json"),JSON.stringify(m,null,2)+"\n");
'
echo "done: PDFs and manifest written (MCP flag: $MCP)"
