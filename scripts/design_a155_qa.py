"""Local, fixture-only browser check for A155. Requires installed Playwright.

Run with A155_PREVIEW_URL set to an isolated dev server. Screenshots are written
to A155_QA_OUTPUT (defaults to /tmp/a155-consent-qa), never into production.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("A155_PREVIEW_URL", "http://127.0.0.1:3195")
OUT = Path(os.environ.get("A155_QA_OUTPUT", "/tmp/a155-consent-qa"))
VARIANTS = os.environ.get("A155_QA_VARIANTS", "g,h,i").split(",")
OUT.mkdir(parents=True, exist_ok=True)
results = []


def fit(page):
    bounds = page.evaluate("""() => ({
      width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth,
      dialog: (() => {const r = document.querySelector('[data-sheet-frame]')?.getBoundingClientRect();
        return r ? {x:r.x, y:r.y, right:r.right, bottom:r.bottom} : null;})()
    })""")
    assert not bounds["overflow"], bounds
    box = bounds["dialog"]
    if box:
        assert box["right"] > box["x"] and box["bottom"] > box["y"], bounds
        assert box["x"] >= -1 and box["right"] <= bounds["width"] + 1, bounds
        assert box["y"] >= -1 and box["bottom"] <= bounds["height"] + 1, bounds
    return bounds


def shot(page, name):
    page.screenshot(path=str(OUT / f"{name}.png"), scale="css")
    results.append({"screen": name, **fit(page)})


def wait_step(page):
    # Shared sheet's 280ms entrance and 150ms body change have settled.
    page.wait_for_timeout(350)


def fixed_search(page):
    """A row must never paint between the heading and search, or behind it.

    Bounding boxes alone miss the reported iPhone defect. Verify ownership,
    contiguous edges AND the painted/hit-tested surface at both strip edges.
    """
    geometry = page.evaluate("""() => {
      const sheet = document.querySelector('[data-sheet-frame]');
      const header = sheet.querySelector('header').getBoundingClientRect();
      const search = sheet.querySelector('[data-journey-search]');
      const strip = search.getBoundingClientRect();
      const body = sheet.querySelector('[data-sheet-body]');
      const input = search.querySelector('input').getBoundingClientRect();
      const rect = body.getBoundingClientRect();
      const hits = [strip.top + 2, strip.bottom - 2].every(y =>
        search.contains(document.elementFromPoint(strip.x + strip.width / 2, y)));
      const canvas = document.createElement('canvas');
      const paint = canvas.getContext('2d');
      paint.fillStyle = getComputedStyle(search).backgroundColor;
      paint.fillRect(0, 0, 1, 1);
      return {headerBottom:header.bottom, stripTop:strip.top, stripBottom:strip.bottom,
        bodyTop:rect.top, inputTop:input.top, inputHeight:input.height,
        outside:!body.contains(search), opaque:getComputedStyle(search).backgroundColor,
        alpha:paint.getImageData(0, 0, 1, 1).data[3], scroll:body.scrollTop, hits};
    }""")
    assert geometry["outside"] and geometry["hits"], geometry
    assert abs(geometry["stripTop"] - geometry["headerBottom"]) < 1, geometry
    assert abs(geometry["stripBottom"] - geometry["bodyTop"]) < 1, geometry
    assert geometry["inputTop"] - geometry["stripTop"] == 12, geometry
    assert geometry["inputHeight"] == 44, geometry
    assert geometry["alpha"] == 255, geometry
    return geometry


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
    for width, height, mode in [(390, 844, "light"), (390, 844, "dark"), (1280, 900, "light"), (1280, 900, "dark"), (320, 640, "light")]:
        context = browser.new_context(viewport={"width": width, "height": height}, is_mobile=width < 600, has_touch=width < 600, reduced_motion="reduce")
        page = context.new_page()
        errors, connections = [], []
        page.on("pageerror", lambda error: errors.append(str(error)))

        def route(request):
            url = request.request.url
            if "/finexer/" in url or "/connections" in url:
                connections.append(url)
            if not url.startswith(BASE) or "/api/" in url:
                request.abort()
            else:
                request.continue_()

        context.route("**/*", route)
        for variant in VARIANTS:
            prefix = f"{variant}-{width}-{mode}"
            page.goto(f"{BASE}/design/bank-consent-journeys?variant={variant}&mode={mode}", wait_until="networkidle")
            expect(page.get_by_role("dialog")).to_have_count(1)
            search = page.get_by_role("searchbox", name="Search banks")
            wait_step(page)
            shot(page, f"{prefix}-choose")
            if variant == "g":
                fixed_search(page)
            assert search.bounding_box()["height"] == 44
            assert search.evaluate("e => getComputedStyle(e).fontSize") == "16px"
            initial_search_top = search.bounding_box()["y"]
            page.get_by_role("button", name="Choose Barclays", exact=True).hover()
            page.mouse.wheel(0, 350)
            wait_step(page)
            assert search.bounding_box()["y"] >= 0
            assert search.bounding_box()["y"] <= initial_search_top + 1
            if variant == "g":
                assert fixed_search(page)["scroll"] > 0
                shot(page, f"{prefix}-scrolled")
                page.mouse.wheel(0, 1000)
                wait_step(page)
                fixed_search(page)
                shot(page, f"{prefix}-deep-scroll")
            search.fill("zzq")
            expect(page.get_by_role("heading", name="No banks found")).to_be_visible()
            if width == 390 and mode == "light":
                shot(page, f"{prefix}-noresults")
            page.get_by_role("button", name="Show all banks").click()
            expect(search).to_be_focused()
            search.fill("  mOnZo  ")
            assert search.bounding_box()["height"] == 44
            expect(page.get_by_role("button", name="Choose Monzo", exact=True)).to_be_visible()
            page.get_by_role("button", name="Choose Monzo", exact=True).click()
            wait_step(page)
            expect(page.get_by_role("dialog")).to_have_count(1)
            if variant != "i":
                expect(page.locator("[data-agent-disclosure]")).to_contain_text("firm reference number 925695")
                shot(page, f"{prefix}-review")
                page.get_by_role("button", name="Change bank", exact=True).click()
                wait_step(page)
                expect(search).to_have_value("  mOnZo  ")
                if variant == "g":
                    fixed_search(page)
                page.get_by_role("button", name="Clear search", exact=True).click()
                expect(search).to_be_focused()
                search.fill("natwest")
                page.get_by_role("button", name="Choose NatWest", exact=True).click()
                wait_step(page)
                expect(page.locator("[data-selected-bank]")).to_contain_text("NatWest")
                page.get_by_role("button", name="Continue to Finexer", exact=True).click()
            wait_step(page)
            frame = page.frame_locator("iframe")
            if variant == "i":
                page.get_by_role("button", name="Back in preview", exact=True).click()
                wait_step(page)
                expect(search).to_have_value("  mOnZo  ")
                search.fill("natwest")
                page.get_by_role("button", name="Choose NatWest", exact=True).click()
                wait_step(page)
            expect(frame.get_by_text("Your Accounts", exact=True)).to_be_visible()
            if variant == "i":
                expect(frame.locator("[data-sorted=agency-disclosure]")).to_contain_text("firm reference number 925695")
                expect(page.get_by_text("Proposed intro. Needs Finexer approval.")).to_be_visible()
            shot(page, f"{prefix}-provider")
            # Provider controls are inert: no consent is given by clicking NEXT.
            frame.get_by_role("button", name="NEXT", exact=True).click()
            expect(page.get_by_role("heading", name="Finexer consent", exact=True)).to_be_visible()
            if width == 320 or (width == 390 and mode == "dark"):
                page.get_by_role("button", name="Continue preview", exact=True).scroll_into_view_if_needed()
                shot(page, f"{prefix}-provider-bottom")
            page.get_by_role("button", name="Continue preview", exact=True).click()
            wait_step(page)
            expect(page.get_by_text("No bank has been connected. No permission has been given.")).to_be_visible()
            if width == 390 and mode == "light":
                shot(page, f"{prefix}-end")
            page.get_by_role("button", name="Compare journeys", exact=True).click()
            expect(page.get_by_role("dialog")).to_have_count(0)
            page.get_by_role("button", name=f"Try {variant.upper()}", exact=True).click()
            wait_step(page)
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).to_have_count(0)
            expect(page.get_by_role("button", name=f"Try {variant.upper()}", exact=True)).to_be_focused()
            print(f"PASS {prefix}: choose, scroll, filter, review, return and handoff", flush=True)
        page.get_by_role("heading", name="Bank connection journeys", exact=True).scroll_into_view_if_needed()
        shot(page, f"landing-{width}-{mode}")
        assert not errors, errors
        assert not connections, connections
        context.close()

    # Off-happy path: retries and Back preserve the chosen bank; local dismissal
    # restores the launcher, including a keyboard-only and browser Back cycle.
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    context.route("**/*", lambda request: request.continue_() if request.request.url.startswith(BASE) and "/api/" not in request.request.url else request.abort())
    for variant in VARIANTS:
        page.goto(f"{BASE}/design/bank-consent-journeys?variant={variant}&state=error", wait_until="networkidle")
        wait_step(page)
        if variant == "g":
            page.get_by_role("searchbox").fill("monzo")
            page.get_by_role("button", name="Choose Monzo", exact=True).click()
            wait_step(page)
            page.get_by_role("button", name="Continue to Finexer", exact=True).click()
            expect(page.locator("[data-sheet-frame]").get_by_role("alert")).to_contain_text("Finexer did not open")
            expect(page.locator("[data-selected-bank]")).to_contain_text("Monzo")
            shot(page, "g-error")
            page.get_by_role("button", name="Continue to Finexer", exact=True).click()
            wait_step(page)
            expect(page.get_by_role("dialog")).to_have_count(0)
            page.get_by_role("button", name="Back in preview", exact=True).click()
            expect(page.get_by_role("searchbox")).to_be_visible()
            continue
        expect(page.get_by_role("heading", name="Finexer did not open", exact=True)).to_be_visible()
        shot(page, f"{variant}-error")
        page.get_by_role("button", name="Try again in preview").click()
        wait_step(page)
        if variant != "i":
            expect(page.locator("[data-selected-bank]")).to_contain_text("Monzo")
            page.get_by_role("button", name="Continue to Finexer", exact=True).click()
            wait_step(page)
        page.get_by_role("button", name="Back in preview", exact=True).click()
        wait_step(page)
        expect(page.get_by_role("dialog")).to_have_count(1)

    for state, text in [("loading", "Loading banks"), ("empty", "No banks are available right now"), ("load-error", "We could not load banks"), ("pending", "Opening Finexer")]:
        page.goto(f"{BASE}/design/bank-consent-journeys?variant=g&state={state}", wait_until="networkidle")
        wait_step(page)
        fixed_search(page)
        if state == "pending":
            page.get_by_role("searchbox").fill("monzo")
            page.get_by_role("button", name="Choose Monzo", exact=True).click()
            wait_step(page)
            page.get_by_role("button", name="Continue to Finexer", exact=True).click()
            expect(page.get_by_role("button", name="Opening Finexer", exact=False)).to_be_disabled()
        else:
            expect(page.get_by_text(text, exact=False).first).to_be_visible()
        shot(page, f"g-{state}")
        if state == "load-error":
            page.get_by_role("button", name="Try again", exact=True).click()
            expect(page.get_by_role("button", name="Choose Monzo", exact=True)).to_have_count(1)

    # Short viewport approximates the space left by mobile browser/keyboard UI.
    # This is not a claim of real iOS keyboard or Safari testing.
    page.set_viewport_size({"width": 390, "height": 450})
    page.goto(f"{BASE}/design/bank-consent-journeys?variant=g", wait_until="networkidle")
    wait_step(page)
    page.get_by_role("searchbox").click()
    page.keyboard.type("monzo")
    expect(page.get_by_role("searchbox")).to_be_focused()
    fixed_search(page)
    shot(page, "g-short-viewport-search")
    page.get_by_role("button", name="Choose Monzo", exact=True).click()
    wait_step(page)
    expect(page.get_by_role("button", name="Continue to Finexer", exact=True)).to_be_in_viewport()
    shot(page, "g-short-viewport-review")
    page.set_viewport_size({"width": 390, "height": 844})

    page.goto(f"{BASE}/design/bank-consent-journeys", wait_until="networkidle")
    page.get_by_role("button", name="Dark theme", exact=True).click()
    assert page.locator("html").evaluate("e => e.classList.contains('dark')")
    page.get_by_role("button", name="Light theme", exact=True).click()
    page.get_by_role("button", name="Try G", exact=True).focus()
    page.keyboard.press("Enter")
    wait_step(page)
    page.get_by_role("searchbox").fill("monzo")
    page.get_by_role("button", name="Choose Monzo", exact=True).click()
    wait_step(page)
    page.go_back()
    wait_step(page)
    expect(page.get_by_role("searchbox")).to_have_value("monzo")
    page.keyboard.press("Escape")
    expect(page.get_by_role("dialog")).to_have_count(0)
    expect(page.get_by_role("button", name="Try G", exact=True)).to_be_focused()
    context.close()
    browser.close()

print(json.dumps({"screenshots": str(OUT), "captures": len(results), "viewports": sorted({(r["width"], r["height"]) for r in results}), "status": "passed"}, indent=2))
