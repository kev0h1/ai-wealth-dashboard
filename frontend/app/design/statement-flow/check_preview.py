"""G272 local browser verification. Mock imports never send a PDF."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3142")
    args = parser.parse_args()
    assert urlparse(args.base_url).hostname in {"127.0.0.1", "localhost"}
    base = args.base_url.rstrip("/") + "/design/statement-flow"
    out = Path(__file__).resolve().parents[3] / ".impeccable/review/g272"
    out.mkdir(parents=True, exist_ok=True)
    errors = []
    shell_reads = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": True}}
    with sync_playwright() as runner:
        browser = runner.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, reduced_motion="reduce")

        def guard(route):
            request = route.request
            path = urlparse(request.url).path
            if path in shell_reads and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(shell_reads[path]))
            elif "/api/" in path:
                errors.append(f"Unexpected API: {request.method} {path}")
                route.abort()
            else:
                route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))

        def visit(**query):
            if page.get_by_role("dialog").count():
                page.keyboard.press("Escape")
                expect(page.get_by_role("dialog")).to_have_count(0)
            page.goto(base + "?" + urlencode(query), wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.get_by_role("dialog").wait_for()
            assert page.locator("html").evaluate("(node, dark) => node.classList.contains('dark') === dark", query.get("mode") == "dark")

        def capture(name):
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), name
            panel = page.locator("[data-sheet-frame]")
            assert panel.evaluate("node => node.scrollWidth <= node.clientWidth + 1"), name
            footer = page.locator("[data-sheet-footer]").bounding_box()
            assert footer and footer["y"] + footer["height"] <= page.viewport_size["height"] + 1
            page.screenshot(path=str(out / name))

        for variant in ("c", "d", "e"):
            for mode in ("light", "dark"):
                visit(variant=variant, mode=mode)
                expect(page.get_by_role("button", name="Import Statement", exact=True)).to_be_disabled()
                capture(f"mobile-{variant}-{mode}.png")
                page.get_by_text("When you add a new statement", exact=True).click()
                expect(page.get_by_text("Notes dated before", exact=False)).to_be_visible()

        visit(variant="e", mode="dark")
        tabs = page.get_by_role("tab")
        tabs.nth(0).focus()
        page.keyboard.press("ArrowRight")
        expect(tabs.nth(1)).to_be_focused()
        expect(tabs.nth(1)).to_have_attribute("aria-selected", "true")
        capture("mobile-e-trades-dark.png")
        page.keyboard.press("End")
        expect(tabs.nth(2)).to_have_attribute("aria-selected", "true")
        expect(page.get_by_text("Prices may be delayed.", exact=True)).to_be_visible()
        capture("mobile-e-prices-dark.png")

        # Real file/password controls with a fake importer. Requests are guarded.
        page.get_by_label("Password", exact=False).first.fill("example")
        page.get_by_role("button", name="Show investment statement password").click()
        expect(page.locator("#investment-password")).to_have_attribute("type", "text")
        page.get_by_label("Investment statement file", exact=True).set_input_files({"name": "example-statement.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4\nG272 fixture"})
        page.get_by_role("button", name="Import Statement", exact=True).click()
        expect(page.get_by_role("button", name="Analysing holdings…")).to_be_disabled()
        expect(page.get_by_text("Example provider Stocks and shares ISA imported")).to_be_visible()
        page.get_by_role("button", name="Done", exact=True).click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        page.get_by_label("Fixture import result", exact=False).select_option("error")
        page.get_by_role("button", name="Open option E", exact=True).click()
        page.get_by_label("Investment statement file", exact=True).set_input_files({"name": "unreadable.pdf", "mimeType": "application/pdf", "buffer": b"fixture"})
        page.get_by_role("button", name="Import Statement", exact=True).click()
        expect(page.get_by_role("dialog").get_by_role("alert")).to_contain_text("Try another statement")
        capture("mobile-e-error.png")

        for width, height, name in ((320, 740, "narrow"), (390, 500, "short"), (1440, 1000, "desktop")):
            page.set_viewport_size({"width": width, "height": height})
            for variant in ("c", "d", "e"):
                visit(variant=variant, mode="dark")
                capture(f"{name}-{variant}-dark.png")
        page.keyboard.press("Tab")
        assert page.locator("[data-sheet-frame]").evaluate("node => node.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)
        context.close()
        browser.close()
    assert not errors, errors
    print("PASS: C/D/E, themes, responsive bounds, tabs/keyboard, privacy disclosure, mock upload success/error/loading, no live API writes.")


if __name__ == "__main__":
    main()
