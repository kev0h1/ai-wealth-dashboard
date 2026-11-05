"""Export C22 store artwork from real, fixture-only proof captures.

Run against a local preview only. This script writes review assets, never talks to
the product API, and records the production source hashes used by the artboards.
"""
import hashlib
import io
import json
import zipfile
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/store"
IDS = ("amount", "account", "spend", "month", "split", "movement", "penny", "aside")
PLATFORMS = ("apple-medium", "apple-large", "apple-classic", "play")
SIZES = {"apple-medium": (1206, 2622), "apple-large": (1320, 2868), "apple-classic": (1242, 2688), "play": (1080, 1920), "feature": (1024, 500)}
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}
SOURCES = ("frontend/app/design/marketing-kit/store/StoreCanvas.tsx", "frontend/app/design/marketing-kit/store/catalog.ts", "frontend/app/design/marketing-kit/store/store.module.css")
PROOFS = {
    "amount": "frontend/public/design-media/c22/next/proof-safe",
    "account": "frontend/public/design-media/c22/next/proof-accounts",
    "spend": "frontend/public/design-media/c22/features/proof-spend",
    "month": "frontend/public/design-media/c22/features/proof-month-spending",
    "split": "frontend/public/design-media/c22/features/proof-split-card",
    "movement": "frontend/public/design-media/c22/features/proof-movement",
    "penny": "frontend/public/design-media/c22/features/proof-penny-proposal",
    "aside": "frontend/public/design-media/c22/features/proof-aside-form",
}
ALTS = {
    "amount": "Left to spend estimate in the Sorted app with its account context.",
    "account": "Upcoming payment in the Sorted app showing an account shortfall.",
    "spend": "Pay-period spending pace in the Sorted app.",
    "month": "Month in review in the Sorted app showing income and spending.",
    "split": "A spending split comparison in the Sorted app.",
    "movement": "Suggested movement in the Sorted app explaining a payment gap.",
    "penny": "Penny proposal in the Sorted app awaiting the user confirmation.",
    "aside": "Annual-costs set-aside review in Sorted, showing its amount and paying account before saving.",
}

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def save(raw, path, source):
    info = PngImagePlugin.PngInfo(); info.add_text("Source", json.dumps(source, sort_keys=True))
    Image.open(io.BytesIO(raw)).convert("RGB").save(path, pnginfo=info, optimize=True)
    with Image.open(path) as image:
        assert image.mode == "RGB" and image.size == tuple(source["size"])
    return {"file": path.name, "width": image.width, "height": image.height, "bytes": path.stat().st_size, "sha256": digest(path), **source}

def main():
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument("--base", default="http://127.0.0.1:3146")
    args = parser.parse_args(); assert urlparse(args.base).hostname in {"localhost", "127.0.0.1"}, "Local preview only"
    OUT.mkdir(parents=True, exist_ok=True)
    dependencies = {path: digest(ROOT / path) for path in SOURCES}
    proof_dependencies = {
        f"{proof}-{theme}.png": digest(ROOT / f"{proof}-{theme}.png")
        for proof in PROOFS.values() for theme in ("light", "dark")
    }
    proof_manifests = {
        path: digest(ROOT / path) for path in (
            "frontend/public/design-media/c22/next/proof-assets.json",
            "frontend/public/design-media/c22/features/proof-assets.json",
        )
    }
    records, errors = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        context = browser.new_context(reduced_motion="reduce")
        def guard(route):
            path = urlparse(route.request.url).path
            if path in SHELL and route.request.method == "GET": route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[path]))
            elif "/api/" in path: errors.append(f"Unexpected API request: {route.request.method} {path}"); route.abort()
            else: route.continue_()
        context.route("**/*", guard)
        page = context.new_page(); page.on("pageerror", lambda error: errors.append(str(error)))
        for theme in ("light", "dark"):
            for platform in PLATFORMS:
                width, height = SIZES[platform]; page.set_viewport_size({"width": width, "height": height})
                for item in IDS:
                    query = urlencode({"store-art": item, "platform": platform, "mode": theme})
                    response = page.goto(f"{args.base}/design/marketing-kit?{query}", wait_until="networkidle"); assert response.status == 200
                    page.evaluate("document.fonts.ready"); page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
                    page.add_style_tag(content="nextjs-portal{display:none!important}")
                    target = page.locator("[data-store-artboard]"); assert target.bounding_box()["width"] == width and target.bounding_box()["height"] == height
                    record = {"data": "fictional", "status": "creative-review-only", "id": item, "theme": theme, "platform": platform, "size": [width, height], "alt": ALTS[item], "source": "frontend/app/design/marketing-kit/store/StoreCanvas.tsx", "dependencies": dependencies, "proof": f"{PROOFS[item]}-{theme}.png", "proofHash": proof_dependencies[f"{PROOFS[item]}-{theme}.png"], "proofManifests": proof_manifests}
                    records.append(save(target.screenshot(scale="css"), OUT / f"{item}-{theme}-{platform}.png", record))
            width, height = SIZES["feature"]; page.set_viewport_size({"width": width, "height": height})
            for item in ("amount",):
                query = urlencode({"store-art": item, "platform": "feature", "mode": theme})
                response = page.goto(f"{args.base}/design/marketing-kit?{query}", wait_until="networkidle"); assert response.status == 200
                page.evaluate("document.fonts.ready"); page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
                page.add_style_tag(content="nextjs-portal{display:none!important}")
                target = page.locator("[data-store-artboard]"); assert target.bounding_box()["width"] == width and target.bounding_box()["height"] == height
                record = {"data": "fictional", "status": "creative-review-only", "id": item, "theme": theme, "platform": "feature", "size": [width, height], "alt": ALTS[item], "source": "frontend/app/design/marketing-kit/store/StoreCanvas.tsx", "dependencies": dependencies, "proof": f"{PROOFS[item]}-{theme}.png", "proofHash": proof_dependencies[f"{PROOFS[item]}-{theme}.png"], "proofManifests": proof_manifests}
                records.append(save(target.screenshot(scale="css"), OUT / f"feature-{item}-{theme}.png", record))
        browser.close()
    assert not errors, errors
    uploads = {"assets": records, "packs": []}
    for theme in ("light", "dark"):
        for platform in PLATFORMS:
            selected = [r for r in records if r["theme"] == theme and r["platform"] == platform]
            pack = OUT / f"sorted-{platform}-{theme}-upload.zip"
            # Store wording is supplied by the typed catalog at build time; the manifest keeps
            # each exact filename and provenance beside the upload ZIP.
            with zipfile.ZipFile(pack, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for record in selected: archive.write(OUT / record["file"], record["file"])
                archive.writestr("upload-order-and-alt-text.json", json.dumps([{"file": r["file"], "alt": r["alt"]} for r in selected], indent=2) + "\n")
            uploads["packs"].append({"file": pack.name, "theme": theme, "platform": platform, "members": [r["file"] for r in selected], "bytes": pack.stat().st_size, "sha256": digest(pack)})
    for theme in ("light", "dark"):
        selected = [r for r in records if r["theme"] == theme and r["platform"] == "feature"]
        pack = OUT / f"sorted-play-feature-{theme}-upload.zip"
        with zipfile.ZipFile(pack, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for record in selected: archive.write(OUT / record["file"], record["file"])
            archive.writestr("upload-order-and-alt-text.json", json.dumps([{"file": r["file"], "alt": r["alt"]} for r in selected], indent=2) + "\n")
        uploads["packs"].append({"file": pack.name, "theme": theme, "platform": "feature", "members": [r["file"] for r in selected], "bytes": pack.stat().st_size, "sha256": digest(pack)})
    uploads.update({"item": "C22", "generated": "local fixture-only export", "status": "creative-review-only", "formats": SIZES})
    (OUT / "manifest.json").write_text(json.dumps(uploads, indent=2) + "\n")
    print(f"Exported {len(records)} RGB store assets with fictional data.")

if __name__ == "__main__": main()
