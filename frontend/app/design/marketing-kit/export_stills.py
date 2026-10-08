"""Export real DOM proofs and campaign PNGs. Run with the local preview server.

/usr/bin/python3 app/design/marketing-kit/export_stills.py --base-url http://127.0.0.1:3132
Requires Playwright, Pillow and an installed Chromium. No account credentials.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parents[2]
CONTENT = json.loads((HERE / "content.json").read_text())
OUT = FRONTEND / "public/design-media/c22"
SOURCES = {
    "safe-to-spend": ["components/SafeToSpendCard.tsx"],
    "connect": ["components/bank-connect/BankConnectionParts.tsx"],
    "upcoming": ["components/upcoming/UpcomingHeroCard.tsx", "components/upcoming/UpcomingAccountsCard.tsx"],
    "suggestions": ["components/HomeBrief.tsx", "components/CoverPlanSourcesCard.tsx"],
    "payday": ["components/PaydayPlanCard.tsx"],
    "investments": ["components/InvestmentMiniCard.tsx"],
    "penny": ["components/PennyConversation.tsx"],
}


def validate_copy():
    limits = {"name": 30, "subtitle": 30, "promotionalText": 170, "description": 4000, "shortDescription": 80, "keywords": 100}
    for field, limit in limits.items():
        value = CONTENT["store"][field]
        length = len(value.encode()) if field == "keywords" else len(value)
        assert length <= limit, f"{field}: {length} > {limit}"
    assert "\u2014" not in json.dumps(CONTENT, ensure_ascii=False), "Use British copy without em dashes"


def save_png(raw, path, provenance):
    info = PngImagePlugin.PngInfo()
    info.add_text("Source", json.dumps(provenance, sort_keys=True))
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.save(path, pnginfo=info, optimize=True)
    return {"file": path.name, "width": image.width, "height": image.height, "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **provenance}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3132")
    parser.add_argument("--browser", default="/usr/bin/google-chrome")
    parser.add_argument("--sample", action="store_true", help="Only feed/story in A light and B dark, plus all proof plates")
    parser.add_argument("--proof-only", action="store_true")
    parser.add_argument("--features", nargs="+", choices=[f["id"] for f in CONTENT["features"]], help="Export a bounded feature batch; manifest includes all existing PNGs")
    args = parser.parse_args()
    assert urlparse(args.base_url).hostname in {"127.0.0.1", "localhost"}, "Use a local fixture server, never production"
    validate_copy()
    OUT.mkdir(parents=True, exist_ok=True)
    assets = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.browser, headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, reduced_motion="reduce")
        # The shared app shell mounts read-only providers on /design routes.
        # Stub only those known shell reads. Proof components must make no calls.
        def guard(route):
            parsed = urlparse(route.request.url)
            shell = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}
            if parsed.path in shell and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(shell[parsed.path]))
            elif "/api/" in parsed.path or parsed.hostname not in {"127.0.0.1", "localhost", None}:
                if "/api/" in parsed.path:
                    errors.append(route.request.url)
                route.abort()
            else:
                route.continue_()
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        def visit(query):
            page.goto(args.base_url + "/design/marketing-kit?" + urlencode(query), wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.add_style_tag(content="nextjs-portal { display:none!important; }")
            page.wait_for_timeout(100)
            assert not errors, errors
        for feature in CONTENT["features"]:
            if args.features and feature["id"] not in args.features:
                continue
            for theme in ("light", "dark"):
                visit({"feature": feature["id"], "theme": theme, "plate": 1})
                origin = {"feature": feature["id"], "theme": theme, "kind": "production-proof", "status": "review-draft",
                          "source": SOURCES[feature["id"]], "fixture": "app/design/marketing-kit/fixtures.ts", "synthetic": True}
                assets.append(save_png(page.locator("[data-proof-plate]").screenshot(), OUT / f"proof-{feature['id']}-{theme}.png", origin))
                if feature["id"] in ("suggestions", "connect", "penny"):
                    visit({"feature": feature["id"], "theme": theme, "plate": 1, "expanded": 1})
                    assets.append(save_png(page.locator("[data-proof-plate]").screenshot(), OUT / f"detail-{feature['id']}-{theme}.png", {**origin, "kind": "expanded-production-proof"}))
        context.close()
        if not args.proof_only:
            context = browser.new_context(reduced_motion="reduce")
            context.route("**/*", guard)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            for feature in CONTENT["features"]:
                if args.features and feature["id"] not in args.features:
                    continue
                for format_id, size in CONTENT["formats"].items():
                    if args.sample and format_id not in ("feed", "story"):
                        continue
                    page.set_viewport_size({"width": size["width"], "height": size["height"]})
                    for direction in ("a", "b"):
                        for theme in ("light", "dark"):
                            if args.sample and ((direction == "a") != (theme == "light")):
                                continue
                            visit({"feature": feature["id"], "theme": theme, "format": format_id, "direction": direction, "export": 1})
                            clipping = page.locator("[data-artboard]").evaluate("""root => {
                              const box=root.getBoundingClientRect();
                              return [...root.querySelectorAll('h1,footer,[data-marketing-proof]')].map(el=>({name:el.tagName,rect:el.getBoundingClientRect().toJSON()})).filter(x=>x.rect.left<box.left-1||x.rect.right>box.right+1||x.rect.bottom>box.bottom+1);
                            }""")
                            assert not clipping, (feature["id"], format_id, clipping)
                            filename = f"{direction}-{feature['id']}-{format_id}-{theme}.png"
                            origin = {"feature": feature["id"], "theme": theme, "direction": direction, "format": format_id, "kind": "campaign-still", "status": "review-draft", "source": SOURCES[feature["id"]], "synthetic": True}
                            asset = save_png(page.locator("[data-artboard]").screenshot(), OUT / filename, origin)
                            assert (asset["width"], asset["height"]) == (size["width"], size["height"])
                            assets.append(asset)
                            print(filename, flush=True)
            context.close()
        browser.close()
    assets = []
    for path in sorted(OUT.glob("*.png")):
        with Image.open(path) as image:
            origin = json.loads(image.info["Source"])
            assets.append({"file": path.name, "width": image.width, "height": image.height, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **origin})
    previous = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {}
    assets.extend(asset for asset in previous.get("assets", []) if asset.get("kind") == "film")
    manifest = {"ticket": "C22", "status": "review-draft-not-for-publication", "completeStills": sum(a["kind"] == "campaign-still" for a in assets) == 196,
                "specificationsChecked": "2026-10-08", "sources": CONTENT["sources"], "reviewChecks": CONTENT["reviewChecks"], "assets": assets}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (OUT / "listing-copy.json").write_text(json.dumps(CONTENT["store"], indent=2) + "\n")
    print(f"Indexed {sum(a['kind'] != 'film' for a in assets)} PNGs; no live API requests.")


if __name__ == "__main__":
    main()
