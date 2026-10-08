"""C22 campaign worlds browser QA and still exporter.

Run against the local design preview, never a deployed host:
  /usr/bin/python3 app/design/marketing-kit/check_worlds.py --base-url http://127.0.0.1:3134
"""
import argparse
import hashlib
import io
import json
import struct
import zlib
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parents[2]
OUT = FRONTEND / "public/design-media/c22/worlds"
REVIEW = FRONTEND / ".impeccable/review/c22-worlds"
CAMPAIGNS = ("c", "d", "e")
SIZES = {"feed": (1080, 1350), "story": (1080, 1920)}
SHELL_READS = {
    "/api/cashflow/at-risk-count": {"count": 0},
    "/api/categories": [],
    "/api/preferences": {"hide_net_worth": False},
}


def tag_scenes() -> None:
    """Embed prompt provenance without decoding or changing generated pixels."""
    for name in ("real-life", "payday-path", "penny"):
        destination = OUT / f"{name}.png"
        source = json.loads((OUT / f"{name}.prompt.json").read_text())
        raw = destination.read_bytes()
        assert raw[:8] == b"\x89PNG\r\n\x1a\n"
        payload = b"Source\0" + json.dumps(source, sort_keys=True).encode("ascii")
        chunk = b"tEXt" + payload
        metadata = struct.pack(">I", len(payload)) + chunk + struct.pack(">I", zlib.crc32(chunk))
        chunks = [raw[:8]]
        offset = 8
        while offset < len(raw):
            length = struct.unpack(">I", raw[offset:offset + 4])[0]
            kind = raw[offset + 4:offset + 8]
            data = raw[offset + 8:offset + 8 + length]
            if kind == b"IEND":
                chunks.append(metadata)
            if not (kind == b"tEXt" and data.startswith(b"Source\0")):
                chunks.append(raw[offset:offset + length + 12])
            offset += length + 12
        destination.write_bytes(b"".join(chunks))


def png(raw: bytes, destination: Path, source: dict) -> dict:
    """Normalise Playwright's capture to RGB and retain auditable provenance."""
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Source", json.dumps(source, sort_keys=True))
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.save(destination, pnginfo=metadata, optimize=True)
    return {
        "file": destination.name,
        "width": image.width,
        "height": image.height,
        "bytes": destination.stat().st_size,
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        **source,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3134")
    parser.add_argument("--browser", default="/usr/bin/google-chrome")
    parser.add_argument("--captures-only", action="store_true", help="Capture/export the bounded review set without interaction assertions")
    args = parser.parse_args()
    parsed_base = urlparse(args.base_url)
    assert parsed_base.hostname in {"127.0.0.1", "localhost"}, "Use a local preview server, never UAT or production"
    base = args.base_url.rstrip("/") + "/design/marketing-kit"
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    tag_scenes()
    errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)

        def guard(route):
            request = route.request
            request_url = urlparse(request.url)
            if request_url.path in SHELL_READS and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL_READS[request_url.path]))
            elif "/api/" in request_url.path:
                errors.append(f"Unexpected API request: {request.method} {request.url}")
                route.abort()
            else:
                route.continue_()

        def make_page(width: int, height: int):
            context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion="reduce")
            context.route("**/*", guard)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
            page.on("requestfailed", lambda request: errors.append(f"Request failed: {request.url}: {request.failure}")
                                         if request.failure != "net::ERR_ABORTED" else None)
            return context, page

        def visit(page, query: dict[str, object] | None = None):
            suffix = "?" + urlencode(query) if query else ""
            page.goto(base + suffix, wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.add_style_tag(content="nextjs-portal { display:none!important; }")
            page.wait_for_timeout(100)

        # Gallery review captures use real responsive layout, not a scaled artboard.
        gallery_captures = [
            ("desktop-c.png", 1440, 1000, "c"),
            ("mobile-c.png", 390, 900, "c"),
            ("mobile-d.png", 390, 900, "d"),
            ("mobile-e.png", 390, 900, "e"),
            ("narrow-e.png", 320, 900, "e"),
        ]
        for filename, width, height, campaign in gallery_captures:
            context, page = make_page(width, height)
            visit(page, {"campaign": campaign})
            assert page.get_by_role("heading", name="Less screenshot. More campaign.").is_visible()
            assert page.get_by_role("link", name="Product proof and copy").get_attribute("href") == "?library=1"
            assert page.locator("[data-campaign-artboard]").count() == 1
            assert page.locator("[data-campaign-scene]").count() == 1
            assert page.locator("[data-marketing-proof]").count() >= 1
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (filename, "horizontal overflow")
            page.screenshot(path=str(REVIEW / filename), full_page=True)
            context.close()

        assets = []
        # Exact routes deliberately receive an exact matching viewport: element screenshots
        # prove the artwork dimensions even when the surrounding page changes later.
        exact_captures = [(campaign, canvas) for campaign in CAMPAIGNS for canvas in SIZES]
        for campaign, canvas in exact_captures:
            width, height = SIZES[canvas]
            context, page = make_page(width, height)
            query = {"campaign": campaign, "canvas": canvas, "art": 1}
            visit(page, query)
            artboard = page.locator("[data-campaign-artboard]")
            assert artboard.count() == 1
            box = artboard.bounding_box()
            assert box and round(box["width"]) == width and round(box["height"]) == height, (campaign, canvas, box)
            raw = artboard.screenshot()
            filename = f"{campaign}-{canvas}.png"
            source = {
                "ticket": "C22",
                "campaign": campaign,
                "canvas": canvas,
                "kind": "campaign-world",
                "source": "browser composition",
                "props": "actual production props",
                "scene": "generated blank-screen scene separately",
                "status": "synthetic/draft",
                "synthetic": True,
            }
            asset = png(raw, OUT / filename, source)
            assert (asset["width"], asset["height"]) == (width, height), asset
            assets.append(asset)
            # The requested review set is the three feed versions plus E story.
            if canvas == "feed" or campaign == "e":
                (REVIEW / f"exact-{campaign}-{canvas}.png").write_bytes(raw)
            context.close()

        if not args.captures_only:
            context, page = make_page(390, 900)
            visit(page)
            # Button controls are intentionally named assertions, rather than brittle order checks.
            for campaign, label in (("c", "C · Real life"), ("d", "D · Payday path"), ("e", "E · Ask Penny")):
                button = page.get_by_role("button", name=label, exact=True)
                button.click()
                assert urlparse(page.url).query.startswith(f"campaign={campaign}") or f"campaign={campaign}" in page.url
                assert page.locator("[data-campaign-artboard]").count() == 1
            for canvas, label in (("feed", "Feed"), ("story", "Story")):
                page.get_by_role("button", name=label, exact=True).click()
                assert f"canvas={canvas}" in page.url
            page.get_by_role("button", name="C · Real life", exact=True).focus()
            page.keyboard.press("Tab")
            assert page.evaluate("document.activeElement instanceof HTMLButtonElement"), "keyboard focus left campaign controls"
            visit(page, {"campaign": "invalid", "canvas": "invalid"})
            assert page.locator("[data-campaign-artboard]").count() == 1
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "invalid query fallback overflowed"
            context.close()
        browser.close()

    assert not errors, errors
    manifest = {
        "ticket": "C22",
        "status": "synthetic/draft",
        "exports": sorted(assets, key=lambda asset: asset["file"]),
    }
    (OUT / "exports.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("PASS: six RGB campaign worlds, responsive gallery captures, controls, fallback, focus, and API guard.")


if __name__ == "__main__":
    main()
