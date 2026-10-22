"""Capture current fictional product states and separately authored stills.

Run against the isolated local preview, never the authenticated live product.
Proofs are frozen before any still or film uses them. No image is invented.
"""
import argparse
import hashlib
import io
import json
import subprocess
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/next"
REVIEW = ROOT / ".impeccable/review/c22-next"
DEPENDENCIES = [
    "frontend/components/SafeToSpendCard.tsx", "frontend/components/ForecastStatusBadge.tsx",
    "frontend/components/upcoming/UpcomingAccountsCard.tsx", "frontend/components/upcoming/UpcomingRow.tsx",
    "frontend/components/AccountMiniCard.tsx", "frontend/lib/spendFromAccount.ts",
    "frontend/lib/upcomingAccountStatus.ts", "frontend/lib/cashForecastStatus.ts",
    "frontend/app/globals.css", "frontend/app/design/marketing-kit/fixtures.ts",
    "frontend/app/design/marketing-kit/next/ProofScene.tsx",
]
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(raw, name, origin):
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Source", json.dumps(origin, sort_keys=True))
    path = OUT / name
    Image.open(io.BytesIO(raw)).convert("RGB").save(path, pnginfo=meta, optimize=True)
    with Image.open(path) as img:
        return {"file": name, "width": img.width, "height": img.height, "bytes": path.stat().st_size, "sha256": digest(path), **origin}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3146")
    parser.add_argument("--proofs-only", action="store_true")
    parser.add_argument("--stills-only", action="store_true")
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {"localhost", "127.0.0.1"}, "Local preview only"
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    errors, assets = [], []
    dependencies = {name: digest(ROOT / name) for name in DEPENDENCIES if (ROOT / name).is_file()}
    origin = {"data": "fictional", "status": "creative-review-only", "productionUI": dependencies}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1080, "height": 1920}, device_scale_factor=3, reduced_motion="reduce")
        def guard(route):
            path = urlparse(route.request.url).path
            if path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[path]))
            elif "/api/" in path:
                errors.append(f"Unexpected API request: {route.request.method} {path}")
                route.abort()
            else:
                route.continue_()
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: errors.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)
        def visit(query):
            response = page.goto(args.base + "/design/marketing-kit?" + urlencode(query), wait_until="networkidle")
            assert response.status == 200
            page.evaluate("document.fonts.ready")
            page.evaluate("Promise.all([...document.images].map(i=>i.decode()))")
            page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")

        if not args.stills_only:
            for theme in ("light", "dark"):
                for kind in ("safe", "ledger", "working", "accounts", "payment"):
                    visit({"media-proof": kind, "mode": theme})
                    target = page.locator("[data-next-proof]")
                    if kind in {"ledger", "working"}:
                        target.locator("summary").click()
                        if kind == "working":
                            target = target.locator("details > div")
                    text = target.inner_text()
                    if kind in {"safe", "ledger", "working"}:
                        assert "312" in text, text
                    if kind == "safe":
                        assert "Monzo" in text and "estimated" in text.lower(), text
                    if kind == "accounts":
                        assert "120" in text and "short" in text.lower(), text
                    name = f"proof-{kind}-{theme}.png"
                    assets.append(save(target.screenshot(), name, {**origin, "kind": "proof", "feature": kind, "theme": theme, "source": "frontend/app/design/marketing-kit/next/ProofScene.tsx"}))
                    print(name, target.bounding_box(), flush=True)
            (OUT / "proof-assets.json").write_text(json.dumps(assets, indent=2) + "\n")
        if not args.proofs_only:
            for variant in ("amount", "account", "working"):
                for theme in ("light", "dark"):
                    for form, height in (("feed", 1350), ("story", 1920)):
                        page.set_viewport_size({"width": 1080, "height": height})
                        visit({"art": 1, "variant": variant, "mode": theme, "format": form})
                        art = page.locator("[data-next-artboard]")
                        box = art.bounding_box()
                        assert box["width"] == 1080 and box["height"] == height, box
                        assert art.get_by_text("Fictional example", exact=False).count(), art.inner_text()
                        assets.append(save(art.screenshot(scale="css"), f"{variant}-{theme}-{form}.png", {**origin, "kind": "still", "variant": variant, "theme": theme, "format": form, "source": "frontend/app/design/marketing-kit/next/PosterCanvas.tsx"}))
                        print("STILL", variant, theme, form, flush=True)
            (OUT / "still-assets.json").write_text(json.dumps([a for a in assets if a["kind"] == "still"], indent=2) + "\n")
        browser.close()
    assert not errors, errors
    print("Capture complete. No live API data read.")

if __name__ == "__main__":
    main()
