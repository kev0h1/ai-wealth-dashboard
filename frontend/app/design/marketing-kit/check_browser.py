"""C22 review workbench interaction and viewport checks; local fixtures only."""
import json
import sys
from time import monotonic, sleep
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / ".impeccable/review/c22"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3132/design/marketing-kit"

def wait_video(page, predicate):
    # Playwright wait_for_function uses page-side eval, refused by production CSP.
    video = page.locator("video")
    video.wait_for(state="visible")
    deadline = monotonic() + 15
    while monotonic() < deadline:
        if video.evaluate(predicate):
            return
        sleep(.1)
    raise AssertionError(f"Video did not reach expected state: {predicate}")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
    errors = []
    def request_failed(request):
        # Switching or closing a native video intentionally cancels range reads.
        parsed = urlparse(request.url)
        if request.failure == "net::ERR_ABORTED" and parsed.netloc == "127.0.0.1:3132" and parsed.path.startswith("/design-media/c22/") and parsed.path.endswith(".mp4"):
            return
        errors.append(f"Request failed: {request.url}: {request.failure}")
    def guard(route):
        parsed = urlparse(route.request.url)
        shell = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}
        if parsed.path in shell and route.request.method == "GET":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(shell[parsed.path]))
        elif "/api/" in parsed.path:
            errors.append(route.request.url)
            route.abort()
        else:
            route.continue_()
    for width, theme in [(1440, "light"), (390, "light"), (390, "dark"), (320, "dark")]:
        context = browser.new_context(viewport={"width": width, "height": 900}, reduced_motion="reduce")
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
        page.on("requestfailed", request_failed)
        page.goto(BASE + f"?library=1&theme={theme}", wait_until="networkidle")
        page.evaluate("document.fonts.ready")
        page.add_style_tag(content="nextjs-portal{display:none!important}")
        assert page.get_by_role("heading", name="Sorted, out in the world.").is_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, "horizontal overflow")
        page.screenshot(path=str(OUT / f"workbench-{width}-{theme}.png"))
        if "--captures-only" in sys.argv:
            context.close()
            continue
        page.get_by_label("Story", exact=True).select_option("upcoming")
        page.get_by_label("Format", exact=True).select_option("story")
        page.get_by_role("button", name="B · The question", exact=True).click()
        assert page.get_by_role("heading", name="Will each account cover its payments?").is_visible()
        assert "direction=b" in page.url and "feature=upcoming" in page.url
        page.get_by_role("button", name="Dark" if theme == "light" else "Light", exact=True).click()
        page.get_by_role("button", name="Light" if theme == "light" else "Dark", exact=True).click()
        page.get_by_role("button", name="A · Answer first", exact=True).click()
        page.get_by_label("Story", exact=True).select_option("safe-to-spend")
        page.get_by_label("Format", exact=True).select_option("feed")
        page.get_by_role("button", name="Open player", exact=True).click()
        page.get_by_label("Film", exact=True).select_option("penny")
        wait_video(page, "el => el.readyState >= 1")
        assert page.locator("video").evaluate("el => el.paused && !el.autoplay && el.videoWidth === 1080 && el.videoHeight === 1920")
        page.locator("video").evaluate("el => el.play()")
        wait_video(page, "el => el.currentTime > 0")
        page.locator("video").evaluate("el => el.pause()")
        page.get_by_role("button", name="Close player", exact=True).click()
        # Off-happy-path: reload with malformed filters falls back to real content.
        page.goto(BASE + "?feature=invalid&format=invalid&theme=invalid", wait_until="networkidle")
        assert page.get_by_label("Story", exact=True).input_value() == "safe-to-spend"
        assert page.get_by_label("Format", exact=True).input_value() == "feed"
        # Keyboard-only controls and a second dense proof at minimum width.
        page.get_by_label("Story", exact=True).focus()
        page.keyboard.press("Tab")
        assert page.get_by_label("Format", exact=True).evaluate("el=>el===document.activeElement")
        page.get_by_label("Story", exact=True).select_option("suggestions")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        context.close()
    browser.close()
    assert not errors, errors
    print("PASS: four viewport/theme combinations, controls round-trip, film open/close, URL state, malformed query, keyboard focus, no unexpected API requests.")
