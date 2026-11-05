"""Review store controls, native-sized downloads and responsive gallery layout."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / ".impeccable/review/c22-store"
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}
PLATFORMS = {"apple-medium": "iPhone · Medium", "apple-large": "iPhone · Large", "apple-classic": "iPhone · Classic", "play": "Google Play"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3146")
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {"localhost", "127.0.0.1"}
    REVIEW.mkdir(parents=True, exist_ok=True)
    errors, downloads = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        def guard(route):
            path = urlparse(route.request.url).path
            if path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[path]))
            elif "/api/" in path:
                errors.append(f"Unexpected API: {route.request.method} {path}")
                route.abort()
            else:
                route.continue_()
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
        for theme in ("light", "dark"):
            response = page.goto(args.base + "/design/marketing-kit?mode=" + theme, wait_until="networkidle")
            assert response.status == 200
            page.evaluate("document.fonts.ready")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
            for platform, label in PLATFORMS.items():
                page.get_by_role("button", name=label, exact=True).click()
                images = page.locator("#stores article img")
                expect(images).to_have_count(8)
                expect(images.first).to_have_attribute("src", f"/design-media/c22/store/amount-{theme}-{platform}.png")
                page.evaluate("Promise.all([...document.querySelectorAll('#stores img')].map(i=>{i.loading='eager';return i.decode()}))")
                assert f"store={platform}" in page.url and f"mode={theme}" in page.url
                zip_link = page.get_by_role("link", name="Download this set · ZIP", exact=True)
                assert zip_link.get_attribute("href") == f"/design-media/c22/store/sorted-{platform}-{theme}-upload.zip"
                pack = context.request.get(args.base + zip_link.get_attribute("href"))
                assert pack.status == 200 and pack.body()[:2] == b"PK"
                downloads.append({"theme": theme, "platform": platform, "bytes": len(pack.body())})
            for width in (1440, 390, 320):
                page.set_viewport_size({"width": width, "height": 900})
                page.evaluate("Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode()}))")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (theme, width)
                small = page.locator("button,a").evaluate_all("els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.height<43.5}).map(e=>e.textContent)")
                assert not small, (theme, width, small)
                page.screenshot(path=str(REVIEW / f"gallery-{theme}-{width}.png"), full_page=True)
            page.locator("#stores").screenshot(path=str(REVIEW / f"store-section-{theme}-phone.png"))
        page.get_by_role("button", name="iPhone · Medium", exact=True).click()
        page.get_by_role("button", name="Light", exact=True).click()
        page.get_by_role("button", name="Story", exact=True).click()
        expect(page.locator("#stores article img").first).to_have_attribute("src", "/design-media/c22/store/amount-light-apple-medium.png")
        assert all(value in page.url for value in ("store=apple-medium", "mode=light", "format=story"))
        page.keyboard.press("Tab")
        assert page.evaluate("document.activeElement !== document.body")
        listing = context.request.get(args.base + "/design-media/c22/listing-copy.json")
        assert listing.status == 200
        copy = listing.json()
        assert "left to spend" in json.dumps(copy).lower()
        assert "safe to spend" not in json.dumps(copy).lower()
        browser.close()
    assert not errors, errors
    (REVIEW / "browser-result.json").write_text(json.dumps({"errors": errors, "downloads": downloads, "widths": [320, 390, 1440], "controls": "pass", "copy": "pass"}, indent=2) + "\n")
    print("Store gallery passed both themes, four formats, eight ZIP downloads and 320/390/1440 layouts.")

if __name__ == "__main__":
    main()
