"""Capture C41 App Store artwork from the localhost-only creative preview.

This deliberately has no publishing step.  The preview is fixture-only and every
request outside its local origin (and the small shell API fixture set) is refused.
"""
import argparse
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c41-app-store"
BASE_SOURCES = (
    "PRODUCT.md", "DESIGN.md", "frontend/components/SafeToSpendCard.tsx",
    "frontend/components/ForecastStatusBadge.tsx", "frontend/components/SafeToSpendDisclosures.tsx",
    "frontend/components/PooledLedgerExplainer.tsx", "frontend/components/SpendFromAccountList.tsx",
    "frontend/components/AccountMiniCard.tsx", "frontend/components/SyncNote.tsx",
    "frontend/components/MoneyText.tsx", "frontend/lib/spendFromAccount.ts",
    "frontend/lib/leftToSpendEvidence.ts", "frontend/lib/accountAvailability.ts",
    "frontend/components/SafeToSpendDisclosures.module.css", "frontend/lib/cashForecastStatus.ts",
    "frontend/lib/pennyScreenViews.ts", "frontend/lib/useIsDark.ts", "frontend/components/ColourProvider.tsx",
    "frontend/lib/balancesHidden.tsx",
    "frontend/components/PennyChart.tsx", "frontend/components/PennyTable.tsx",
    "frontend/lib/pennyChart.ts", "frontend/app/globals.css", "frontend/app/layout.tsx",
    "frontend/app/design/marketing-kit/fixtures.ts",
    "frontend/app/design/marketing-kit/capabilities/penny-fixtures.ts",
    "marketing/c41-app-store/specs.json", "marketing/c41-app-store/export_assets.py",
)
SHELL = {
    "/api/cashflow/at-risk-count": {"count": 0},
    "/api/categories": [],
    "/api/preferences": {"hide_net_worth": False, "preferencesReady": True},
}
SLOTS = {"header": (3840, 1646), "search": (3840, 2560)}
SAFE = {
    "header": {"x": 1097, "y": 493, "width": 1646, "height": 661},
    "search": {"x": 836, "y": 765, "width": 2168, "height": 1030},
}
THEMES = ("light", "dark")
VARIANTS = ("a", "b")
PROOFS = {"amount": 390, "penny": 480}
ART_PROOFS = {("header", "a"): ("amount",), ("header", "b"): (),
              ("search", "a"): ("amount",), ("search", "b"): ("penny",)}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_paths() -> list[str]:
    """Record the current component, fixture, typography and artboard sources."""
    creative = sorted((ROOT / "frontend/app/design/app-store-creative").glob("*.ts*"))
    creative += sorted((ROOT / "frontend/app/design/app-store-creative").glob("*.css"))
    paths = [ROOT / path for path in BASE_SOURCES] + creative
    assert all(path.is_file() for path in paths), "Missing capture source"
    unique = {path.relative_to(ROOT).as_posix(): path for path in paths}
    return sorted(unique)


def png_record(raw: bytes, path: Path, metadata: dict) -> dict:
    info = PngImagePlugin.PngInfo()
    info.add_text("Source", json.dumps(metadata, sort_keys=True, separators=(",", ":")))
    info.add_text("impeccable:prompt", "Origin: local Chrome capture of current Sorted production components and hand-set C41 typography, with fictional C22 fixtures only. No generated imagery or customer data. Source JSON records the route, exact source hashes and proof capture dependencies.")
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.save(path, pnginfo=info, optimize=True)
    with Image.open(path) as saved:
        saved.load()
        assert saved.mode == "RGB"
        width, height = saved.size
    return {"file": path.name, "width": width, "height": height,
            "bytes": path.stat().st_size, "sha256": digest(path), **metadata}


def assert_safe(page, artboard, slot: str) -> list[dict]:
    art = artboard.bounding_box()
    assert art, "missing artboard box"
    safe = SAFE[slot]
    keys = page.locator("[data-c41-key]")
    boxes = []
    for index in range(keys.count()):
        name = keys.nth(index).get_attribute("data-c41-key") or str(index)
        box = keys.nth(index).bounding_box()
        assert box, f"key {name} is hidden"
        relative = {"name": name, "x": box["x"] - art["x"], "y": box["y"] - art["y"],
                    "width": box["width"], "height": box["height"]}
        assert relative["x"] >= safe["x"] and relative["y"] >= safe["y"], (slot, relative, safe)
        assert relative["x"] + relative["width"] <= safe["x"] + safe["width"], (slot, relative, safe)
        assert relative["y"] + relative["height"] <= safe["y"] + safe["height"], (slot, relative, safe)
        boxes.append(relative)
    assert boxes, f"{slot} has no [data-c41-key] elements"
    proof_images = page.locator("[data-c41-proof-image]")
    for index in range(proof_images.count()):
        box = proof_images.nth(index).bounding_box()
        assert box, f"proof image {index} is hidden"
        relative = {"x": box["x"] - art["x"], "y": box["y"] - art["y"], "width": box["width"], "height": box["height"]}
        assert relative["x"] >= safe["x"] and relative["y"] >= safe["y"] and relative["x"] + relative["width"] <= safe["x"] + safe["width"] and relative["y"] + relative["height"] <= safe["y"] + safe["height"], (slot, "proof image", relative, safe)
    for index, left in enumerate(boxes):
        for right in boxes[index + 1:]:
            overlap = max(0, min(left["x"] + left["width"], right["x"] + right["width"]) - max(left["x"], right["x"])) * max(0, min(left["y"] + left["height"], right["y"] + right["height"]) - max(left["y"], right["y"]))
            assert overlap <= 0.5, f"overlapping C41 keys: {left['name']} / {right['name']}"
    return boxes


def add_member(archive: zipfile.ZipFile, name: str, payload: bytes) -> None:
    entry = zipfile.ZipInfo(name, date_time=(2026, 11, 12, 0, 0, 0))
    entry.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(entry, payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3151")
    args = parser.parse_args()
    parsed = urlparse(args.base)
    assert parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}, "Local preview only"
    OUT.mkdir(parents=True, exist_ok=True)
    source_hashes = {path: digest(ROOT / path) for path in source_paths()}
    errors: list[str] = []
    proofs, assets = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
        context = browser.new_context(device_scale_factor=3, reduced_motion="reduce")

        def guard(route):
            request = route.request
            url = urlparse(request.url)
            if url.netloc != parsed.netloc:
                errors.append(f"External request: {request.method} {request.url}"); route.abort(); return
            if url.path in SHELL and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[url.path])); return
            if url.path.startswith("/api/"):
                errors.append(f"Unexpected API request: {request.method} {url.path}"); route.abort(); return
            route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        page.set_default_navigation_timeout(180000)
        page.on("pageerror", lambda error: errors.append(f"Page error: {error}"))
        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
        for proof, width in PROOFS.items():
            for theme in THEMES:
                page.set_viewport_size({"width": width, "height": 1600})
                page.clock.set_fixed_time(datetime(2026, 10 if proof == "amount" else 11, 8 if proof == "amount" else 17, 12, tzinfo=timezone.utc))
                response = page.goto(f"{args.base}/design/app-store-creative?{urlencode({'proof': proof, 'mode': theme})}", wait_until="domcontentloaded")
                assert response and response.status == 200
                page.evaluate("document.fonts.ready")
                target = page.locator("[data-c41-proof]")
                page.locator('[data-c41-ready="true"]').wait_for()
                page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
                page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                page.add_style_tag(content="nextjs-portal{display:none!important}")
                box = target.bounding_box(); assert box and round(box["width"]) == width, (proof, theme, box)
                assert target.evaluate("element => element.scrollWidth <= element.clientWidth"), "Proof content overflows its capture"
                assert box["x"] >= 0 and box["x"] + box["width"] <= page.viewport_size["width"], "Proof extends beyond the viewport"
                metadata = {"kind": "proof", "proof": proof, "theme": theme, "cssWidth": width,
                            "route": "/design/app-store-creative", "query": {"proof": proof, "mode": theme},
                            "deviceScaleFactor": 3, "data": "fictional", "status": "creative-review-only", "source": "frontend/app/design/app-store-creative/CreativeProof.tsx", "origin": "local Chrome production UI capture", "sourceHashes": source_hashes,
                            "provenance": {"origin": "impeccable:prompt", "sources": source_hashes}}
                proofs.append(png_record(target.screenshot(scale="device"), OUT / f"proof-{proof}-{theme}.png", metadata))
        # The source modules need 3x capture density. Masters are already at
        # Apple's native pixel dimensions, so avoid a 3x compositor allocation.
        context.close()
        context = browser.new_context(device_scale_factor=1, reduced_motion="reduce")
        context.route("**/*", guard)
        page = context.new_page()
        page.set_default_navigation_timeout(180000)
        page.on("pageerror", lambda error: errors.append(f"Page error: {error}"))
        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
        for slot, size in SLOTS.items():
            for variant in VARIANTS:
                for theme in THEMES:
                    page.set_viewport_size({"width": size[0], "height": size[1]})
                    query = {"export": "1", "slot": slot, "variant": variant, "mode": theme}
                    response = page.goto(f"{args.base}/design/app-store-creative?{urlencode(query)}", wait_until="domcontentloaded")
                    assert response and response.status == 200
                    page.evaluate("document.fonts.ready")
                    page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
                    page.add_style_tag(content="nextjs-portal{display:none!important}")
                    artboard = page.locator("[data-c41-artboard]")
                    box = artboard.bounding_box(); assert box and (round(box["width"]), round(box["height"])) == size, (slot, box)
                    key_boxes = assert_safe(page, artboard, slot)
                    proof_images = page.locator("[data-c41-proof-image]")
                    expected_proofs = ART_PROOFS[(slot, variant)]
                    assert proof_images.count() >= len(expected_proofs), f"{slot}/{variant}/{theme} missing proof imagery"
                    metadata = {"slot": slot, "variant": variant, "theme": theme, "size": list(size),
                                "alt": artboard.get_attribute("data-c41-alt"),
                                "safe": SAFE[slot], "keyBoxes": key_boxes, "origin": "local Chrome artboard capture", "data": "fictional", "status": "creative-review-only", "source": "frontend/app/design/app-store-creative/CreativeCanvas.tsx",
                                "sourceHashes": source_hashes, "provenance": {"origin": "impeccable:prompt", "sources": source_hashes},
                                "proofs": [{"file": proof["file"], "sha256": proof["sha256"]} for proof in proofs if proof["theme"] == theme and proof["proof"] in expected_proofs]}
                    filename = f"sorted-{slot}-{variant}-{theme}-{size[0]}x{size[1]}.png"
                    assets.append(png_record(artboard.screenshot(scale="css"), OUT / filename, metadata))
        browser.close()
    assert not errors, "\n".join(errors)
    # Search is supplied to a second placement at the requested 3:2 derivative size.
    derivatives = []
    for asset in assets:
        if asset["slot"] != "search":
            continue
        filename = f"sorted-search-{asset['variant']}-{asset['theme']}-1920x1280.png"
        image = Image.open(OUT / asset["file"]).convert("RGB").resize((1920, 1280), Image.Resampling.LANCZOS)
        raw = io.BytesIO(); image.save(raw, format="PNG")
        metadata = {**{key: value for key, value in asset.items() if key not in {"file", "width", "height", "bytes", "sha256", "size"}},
                    "size": [1920, 1280], "derivativeOf": asset["file"], "safe": {key: value / 2 for key, value in asset["safe"].items()},
                    "keyBoxes": [{key: value if key == "name" else value / 2 for key, value in box.items()} for box in asset["keyBoxes"]]}
        derivatives.append(png_record(raw.getvalue(), OUT / filename, metadata))
    assets.extend(derivatives)
    assets.sort(key=lambda record: record["file"])
    pack = OUT / "sorted-app-store-creative-options.zip"
    upload_metadata = [{"file": item["file"], "slot": item["slot"], "variant": item["variant"], "theme": item["theme"], "alt": item["alt"]} for item in assets]
    with zipfile.ZipFile(pack, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for item in assets:
            add_member(archive, item["file"], (OUT / item["file"]).read_bytes())
        add_member(archive, "alt-text-and-slots.json", (json.dumps(upload_metadata, indent=2) + "\n").encode())
    manifest = {"item": "C41", "specChecked": "2026-11-12", "captured": datetime.now().astimezone().date().isoformat(),
                "origin": "local fixture-only Chrome export", "assets": assets, "proofs": proofs,
                "moneyFixtures": [{"name": "October left to spend", "total": 312, "parts": [610, -188, -110]}, {"name": "November spending by day 10", "total": 860, "parts": [240, 220, 180, 120, 100]}, {"name": "Usual spending by day 10", "total": 740, "parts": [120, 220, 180, 120, 100]}],
                "packs": [{"file": pack.name, "sha256": digest(pack), "bytes": pack.stat().st_size,
                           "members": [item["file"] for item in assets]}],
                "specs": {"masters": SLOTS, "searchDerivative": [1920, 1280], "safe": SAFE,
                          "proofWidths": PROOFS, "artProofs": {f"{slot}-{variant}": list(proofs) for (slot, variant), proofs in ART_PROOFS.items()},
                          "officialPsd": {"header": "4200f416adcf3affb70d5847c1d0554fc39b7405110ec527bdea92bfb82f93b0", "search": "7bb57a3c33cc4402d1c82e85a0211cf0f2f2b1c05cf7f36e4710092226dea056"},
                          "sourceHashes": source_hashes}}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"C41: exported {len(assets)} opaque RGB artwork PNGs and {len(proofs)} proof PNGs.")


if __name__ == "__main__":
    main()
