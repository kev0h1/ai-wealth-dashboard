"""Export fictional production proof and campaign stills from a LOCAL preview.

  /usr/bin/python3 marketing/c22-crafted/export_round.py --base http://127.0.0.1:3146
  ... --proofs-only
  ... --verify-only    # final bounded confirmation, without replacing assets
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
OUT = ROOT / "frontend/public/design-media/c22/crafted"
REVIEW = ROOT / ".impeccable/review/c22-crafted"
DIRECTIONS = ("receipt", "friday", "calendar")
THEMES = ("light", "dark")
SIZES = {"feed": (1080, 1350), "story": (1080, 1920)}
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}

def save(raw, path, origin):
    meta = PngImagePlugin.PngInfo()
    meta.add_text("Source", json.dumps(origin, sort_keys=True))
    Image.open(io.BytesIO(raw)).convert("RGB").save(path, pnginfo=meta, optimize=True)
    with Image.open(path) as img:
        return {"file": path.name, "width": img.width, "height": img.height, "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **origin}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3146")
    parser.add_argument("--proofs-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--recapture", choices=[f"{d}-{f}-{t}" for d in DIRECTIONS for f in SIZES for t in THEMES])
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {"127.0.0.1", "localhost"}, "Local preview only"
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    if not args.verify_only:
        subprocess.run(["node", str(ROOT / "marketing/c22-crafted/render_films.mjs"), "--prepare"], check=True)
    errors, assets = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1080, "height": 1920}, reduced_motion="reduce")
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
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)

        def visit(query):
            response = page.goto(args.base + "/design/marketing-kit?" + urlencode(query), wait_until="networkidle")
            assert response.status == 200, response.status
            page.evaluate("document.fonts.ready")
            page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
            page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
            page.wait_for_timeout(100)

        for theme in THEMES:
            for feature in ("safe-to-spend", "upcoming"):
                if args.recapture:
                    continue
                visit({"crafted-proof": feature, "mode": theme})
                proof = page.locator("[data-crafted-proof]")
                assert proof.get_by_text("Alex Taylor", exact=False).count() == 1
                if feature == "safe-to-spend":
                    assert "312" in proof.inner_text(), proof.inner_text()
                if not args.verify_only:
                    assets.append(save(proof.screenshot(), OUT / f"proof-{feature}-{theme}.png", {"kind": "proof", "feature": feature, "theme": theme, "source": "frontend/app/design/marketing-kit/crafted/CraftedProof.tsx", "data": "fictional", "status": "review-draft"}))
                print("PROOF", feature, theme, proof.bounding_box())
        if args.proofs_only:
            (REVIEW / "proof-assets.json").write_text(json.dumps(assets, indent=2) + "\n")
            browser.close()
            assert not errors, errors
            return

        for direction in DIRECTIONS:
            for theme in THEMES:
                for form, (width, height) in SIZES.items():
                    if args.recapture and args.recapture != f"{direction}-{form}-{theme}":
                        continue
                    page.set_viewport_size({"width": width, "height": height})
                    visit({"direction": direction, "mode": theme, "format": form, "art": 1})
                    art = page.locator("[data-crafted-artboard]")
                    box = art.bounding_box()
                    assert box["width"] == width and box["height"] == height, box
                    assert art.locator("[data-marketing-proof]").count() >= 1
                    assert art.get_by_text("Fictional example.", exact=False).is_visible()
                    failures = art.evaluate("""root => {
                      const r=root.getBoundingClientRect();
                      return [...root.querySelectorAll('h2,p,small,b,strong,span')].filter(e=>e.textContent.trim() && !e.closest('[aria-hidden=true]')).flatMap(e=>{
                        const c=getComputedStyle(e),b=e.getBoundingClientRect();
                        if(c.opacity==='0'||c.display==='none'||!b.width||!b.height)return[];
                        return b.x<r.x-.5||b.right>r.right+.5||b.y<r.y-.5||b.bottom>r.bottom+.5?[e.textContent.slice(0,80)]:[];
                      });
                    }""")
                    assert not failures, (direction, theme, form, failures)
                    if direction == "calendar":
                        assert art.get_by_text("18", exact=True).is_visible()
                    filename = f"{direction}-{form}-{theme}.png"
                    if not args.verify_only:
                        assets.append(save(art.screenshot(), OUT / filename, {"kind": "still", "direction": direction, "theme": theme, "format": form, "source": "frontend/app/design/marketing-kit/crafted/CampaignCanvas.tsx", "data": "fictional", "status": "review-draft"}))
                    print("ART", filename)

        if args.recapture:
            previous = json.loads((OUT / "still-assets.json").read_text())
            replaced = {asset["file"] for asset in assets}
            (OUT / "still-assets.json").write_text(json.dumps([asset for asset in previous if asset["file"] not in replaced] + assets, indent=2) + "\n")
            browser.close()
            assert not errors, errors
            return

        for direction, theme, width in [("receipt", "light", 1440), ("receipt", "dark", 390), ("friday", "light", 390), ("calendar", "dark", 390), ("calendar", "light", 320)]:
            page.set_viewport_size({"width": width, "height": 900})
            visit({"direction": direction, "mode": theme})
            assert page.get_by_role("heading", level=1).inner_text() == "Money, without\nthe theatre."
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (direction, width)
            assert page.get_by_role("button", name="Dark", exact=True).get_attribute("aria-pressed") == str(theme == "dark").lower()
            # Every creative and its actual video/download remains available on phones.
            assert page.locator("video source").get_attribute("src") == f"/design-media/c22/crafted/{direction}-{theme}.mp4"
            page.screenshot(path=str(REVIEW / f"{direction}-{theme}-{width}.png"), full_page=True)
        page.get_by_role("button", name="Friday?", exact=True).click()
        assert page.locator("[data-crafted-artboard]").get_attribute("data-direction") == "friday"
        page.get_by_role("button", name="Story", exact=True).click()
        assert "format=story" in page.url
        page.get_by_role("button", name="Dark", exact=True).click()
        assert "mode=dark" in page.url
        # Invalid direction/format are recoverable; old explicit links stay available.
        visit({"direction": "unknown", "format": "unknown"})
        assert page.locator("[data-direction=receipt]").count() == 1
        visit({"round": "worlds", "campaign": "d"})
        assert page.locator("[data-campaign-artboard]").count() == 1
        visit({"library": 1})
        assert page.get_by_role("heading", name="The films", exact=True).is_visible()
        browser.close()
    assert not errors, errors
    if not args.verify_only:
        (OUT / "still-assets.json").write_text(json.dumps(assets, indent=2) + "\n")
    (REVIEW / "browser-result.json").write_text(json.dumps({"errors": errors, "stills": 12, "proofs": 4, "gallerySizes": [320, 390, 1440], "controls": "pass", "archives": "pass"}, indent=2) + "\n")

if __name__ == "__main__":
    main()
