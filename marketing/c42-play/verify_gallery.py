"""One batched C42 browser review: layouts, controls, real playback and guides."""
import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / ".impeccable/review/c42"
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3152")
    args = parser.parse_args()
    if urlparse(args.base).hostname not in {"localhost", "127.0.0.1"}:
        parser.error("Only a loopback preview is allowed")
    REVIEW.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        context = browser.new_context(reduced_motion="reduce")
        context.set_default_timeout(15000)
        context.set_default_navigation_timeout(30000)

        def guard(route):
            parsed = urlparse(route.request.url)
            if parsed.path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[parsed.path]))
            elif "/api/" in parsed.path or (parsed.hostname not in {"localhost", "127.0.0.1"} and parsed.scheme in {"http", "https"}):
                errors.append(f"Unexpected request: {route.request.method} {parsed.path}")
                route.abort()
            else:
                route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))

        def wait_until(expression, seconds=10):
            # Poll through the automation protocol. Playwright's in-page
            # wait_for_function string evaluator conflicts with the real
            # production CSP, which intentionally excludes unsafe-eval.
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if page.evaluate(expression):
                    return
                page.wait_for_timeout(80)
            raise AssertionError(f"Browser condition timed out: {expression}")

        def visit(query):
            response = page.goto(args.base + "/design/play-extras" + query, wait_until="networkidle")
            assert response.status == 200
            page.evaluate("document.fonts.ready")
            page.locator('img[loading="lazy"]').evaluate_all("els=>els.forEach(image=>image.loading='eager')")
            wait_until("[...document.images].every(image=>image.complete && image.naturalWidth>0)")
            page.evaluate("Promise.all([...document.images].map(image=>image.decode()))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), query

        for width in (320, 390, 1440):
            page.set_viewport_size({"width": width, "height": 900 if width == 1440 else 844})
            for theme in ("light", "dark"):
                print("CHECK", width, theme, flush=True)
                visit(f"?mode={theme}")
                assert page.get_by_role("button", name=theme.title(), exact=True).get_attribute("aria-pressed") == "true"
                assert page.locator("video").evaluate("video=>video.paused && !video.autoplay && !video.loop")
                money_fonts = page.locator(".money").evaluate_all("els=>els.map(el=>({family:getComputedStyle(el).fontFamily,numerals:getComputedStyle(el).fontVariantNumeric}))")
                assert len(money_fonts) >= 7 and all("mono" in item["family"].lower() and "tabular-nums" in item["numerals"] for item in money_fonts), money_fonts
                if width != 320:
                    page.screenshot(path=str(REVIEW / f"gallery-{width}-{theme}.png"), full_page=True)
                # Real MP4 load, decode, muted playback, seek and captions in
                # the actual Next route with its Content-Security-Policy.
                page.locator("video").evaluate("video=>{video.muted=true}")
                page.locator("video").focus()
                page.keyboard.press("Space")
                wait_until("document.querySelector('video').currentTime > 0.25")
                assert page.locator("video").evaluate("video=>video.videoWidth===1920 && video.videoHeight===1080 && video.duration===30")
                wait_until("document.querySelector('video').textTracks[0]?.mode==='showing'")
                page.locator("video").evaluate("video=>{video.pause();video.currentTime=27}")
                wait_until("Math.abs(document.querySelector('video').currentTime-27)<0.1 && !document.querySelector('video').seeking && document.querySelector('video').readyState>=2")
                video_pixels = page.locator("video").evaluate("video=>{const canvas=document.createElement('canvas');canvas.width=192;canvas.height=108;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,192,108);const pixels=ctx.getImageData(0,0,192,108).data;let min=255,max=0;for(let i=0;i<pixels.length;i+=4){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i])}return max-min}")
                assert video_pixels > 40
                page.get_by_text("Read the film transcript", exact=True).click()
                assert page.locator("ol li").count() == 7
                page.get_by_text("Play copy and event conditions", exact=True).first.click()
                assert page.get_by_text("Sorted launch: your money in one place", exact=True).is_visible()
                opposite = "dark" if theme == "light" else "light"
                page.get_by_role("button", name=opposite.title(), exact=True).click()
                page.wait_for_url(f"**mode={opposite}*")
                assert page.locator("video").evaluate("video=>video.paused")
                results.append({"width": width, "theme": theme, "playback": "passed", "captions": "showing", "seek": 27, "pictureRange": video_pixels})

        page.set_viewport_size({"width": 390, "height": 844})
        visit("?mode=dark")
        page.keyboard.press("Tab")
        assert page.evaluate("document.activeElement.tagName==='A'")
        for item in ("launch", "charts", "plans"):
            visit(f"?art={item}&mode=dark&safe=1")
            assert page.locator("figure img").is_visible()
            assert page.locator('[class*="cropGuide"]').is_visible()
            if item == "charts":
                page.screenshot(path=str(REVIEW / "safe-area-phone.png"), full_page=True)
        # Direct index query links and invalid selectors remain usable.
        visit("?state=dark")
        assert page.get_by_role("button", name="Dark", exact=True).get_attribute("aria-pressed") == "true"
        visit("?mode=light&art=unknown&shot=99")
        assert page.get_by_role("heading", name="Google Play extras", exact=True).is_visible()
        for name in ("promo-light.mp4", "promo-dark.mp4", "promo.en-GB.vtt", "sorted-play-light.zip", "sorted-play-dark.zip", "manifest.json", "play-copy.json"):
            response = context.request.get(args.base + "/design-media/c42/" + name)
            assert response.status == 200, (name, response.status)
        browser.close()
    assert not errors, errors
    (REVIEW / "browser-results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"PASS: {len(results)} layout/playback cases, both themes, captions, seek, keyboard, guides, URL state and downloads; no unexpected API calls")


if __name__ == "__main__":
    main()
