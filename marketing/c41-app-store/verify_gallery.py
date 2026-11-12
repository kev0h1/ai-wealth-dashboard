"""Check the C41 review gallery locally and collect one batched evidence set."""
import argparse
import json
import re
from urllib.parse import urlencode, urlparse

from playwright.sync_api import sync_playwright, expect

from export_assets import ROOT, OUT, SHELL

REVIEW = ROOT / ".impeccable/review/c41"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:3151")
    parser.add_argument("--reuse-captures", action="store_true", help="Verify controls and downloads using the already inspected viewport captures")
    args = parser.parse_args()
    base = urlparse(args.base)
    assert base.scheme == "http" and base.hostname in {"localhost", "127.0.0.1"}
    REVIEW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((OUT / "manifest.json").read_text())
    errors, records, downloads = [], [], set()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        context = browser.new_context(reduced_motion="reduce")

        def guard(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != base.netloc:
                errors.append(f"External request: {route.request.url}"); route.abort()
            elif parsed.path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[parsed.path]))
            elif parsed.path.startswith("/api/"):
                errors.append(f"Unexpected API: {route.request.method} {parsed.path}"); route.abort()
            else:
                route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        page.set_default_navigation_timeout(180000)
        page.on("pageerror", lambda error: errors.append(str(error)))

        def visit(query):
            response = page.goto(f"{args.base}/design/app-store-creative?{urlencode(query)}", wait_until="domcontentloaded")
            assert response and response.status == 200
            page.get_by_role("heading", name="App Store creative", exact=True).wait_for()
            page.locator('[data-c41-gallery][data-c41-ready="true"]').wait_for()
            page.evaluate("document.fonts.ready")
            page.evaluate("Promise.all([...document.querySelectorAll('main img')].map(image => {image.loading = 'eager'; return image.decode()}))")
            page.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), query
            expect(page.locator("main article")).to_have_count(2)

        for theme in ("light", "dark"):
            for width in (320, 390, 1440):
                page.set_viewport_size({"width": width, "height": 1000 if width == 1440 else 844})
                for slot in ("header", "search"):
                    visit({"slot": slot, "mode": theme, "view": "safe"})
                    scheme = page.evaluate("getComputedStyle(document.documentElement).colorScheme")
                    assert ("dark" in scheme) == (theme == "dark"), (theme, scheme)
                    for link in page.locator("main nav a").all():
                        assert link.bounding_box()["height"] >= 44
                    for link in page.locator("main a[download]").all():
                        downloads.add(link.get_attribute("href"))
                    filename = f"{slot}-{theme}-{width}.png"
                    if args.reuse_captures:
                        assert (REVIEW / filename).is_file(), filename
                    else:
                        page.screenshot(path=str(REVIEW / filename), full_page=True)
                    records.append({"file": filename, "theme": theme, "width": width, "slot": slot, "view": "safe", "overflow": False})
        # Full-artwork and actual-size views preserve option downloads and URL
        # state, including after a refresh and browser Back.
        page.set_viewport_size({"width": 390, "height": 844})
        visit({"slot": "header", "mode": "dark", "view": "safe"})
        page.get_by_role("navigation", name="Placement").get_by_role("link", name="Search Results").click()
        expect(page).to_have_url(re.compile(r"[?&]slot=search(?:&|$)"))
        page.get_by_role("navigation", name="Artwork view").get_by_role("link", name="Full artwork", exact=True).click()
        expect(page).to_have_url(re.compile(r"[?&]view=full(?:&|$)"))
        page.reload(); expect(page.get_by_role("link", name="Full artwork", exact=True)).to_have_attribute("aria-current", "true")
        page.get_by_role("navigation", name="Artwork view").get_by_role("link", name="At 390 px", exact=True).click()
        expect(page).to_have_url(re.compile(r"[?&]view=small(?:&|$)"))
        assert page.locator("main article img").first.bounding_box()["width"] <= 390
        page.go_back(); expect(page).to_have_url(re.compile(r"[?&]view=full(?:&|$)"))
        visit({"state": "search", "mode": "light"})
        expect(page.get_by_role("heading", name="Search Results", exact=True)).to_be_visible()
        page.keyboard.press("Tab")
        focused = page.locator(":focus")
        assert focused.count() == 1
        assert focused.evaluate("element => getComputedStyle(element).outlineStyle !== 'none'")
        for path in sorted(downloads):
            response = page.request.get(args.base + path)
            assert response.status == 200, path
            body = response.body()
            assert body == (ROOT / "frontend/public" / path.lstrip("/")).read_bytes(), path
        browser.close()
    assert not errors, errors
    evidence = {"item": "C41", "galleryCaptures": records, "downloads": sorted(downloads),
                "controls": ["placement", "theme", "safe-area/full/390px view", "refresh", "history", "design-index state links", "keyboard focus", "44px targets"],
                "api": "shell fixtures only; unexpected API and external requests refused", "exportAssets": len(manifest["assets"])}
    (REVIEW / "browser.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(f"C41 gallery: {len(records)} viewport/theme/placement captures, {len(downloads)} exact downloads, URL controls, keyboard and 44px targets verified.")


if __name__ == "__main__":
    main()
