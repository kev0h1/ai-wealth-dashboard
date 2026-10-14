"""Local-only G267 interaction and visual verification. No application writes."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlencode, urlparse

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3140")
    args = parser.parse_args()
    assert urlparse(args.base_url).hostname in {"127.0.0.1", "localhost"}
    base = args.base_url.rstrip("/") + "/design/plan-editor"
    out = Path(__file__).resolve().parents[3] / ".impeccable/review/g267"
    out.mkdir(parents=True, exist_ok=True)
    errors = []
    shell_reads = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": True}}
    with sync_playwright() as runner:
        browser = runner.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)

        def guard(route):
            request = route.request
            path = urlparse(request.url).path
            if path in shell_reads and request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(shell_reads[path]))
            elif "/api/" in path:
                errors.append(f"Unexpected request: {request.method} {path}")
                route.abort()
            else:
                route.continue_()

        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, reduced_motion="reduce")
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))

        def visit(**query):
            page.goto(base + "?" + urlencode(query), wait_until="networkidle")
            page.evaluate("document.fonts.ready")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
            page.get_by_role("dialog").first.wait_for()

        def capture(name):
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), name
            footer = page.locator("[data-sheet-footer]").last.bounding_box()
            assert footer and footer["y"] >= 0 and footer["y"] + footer["height"] <= page.viewport_size["height"] + 1, (name, footer)
            page.screenshot(path=str(out / name), full_page=False)

        # Bounded capture matrix: both options, both kinds, both themes, dense
        # states and desktop. Screenshots are evidence of this preview only.
        for variant in ("a", "b"):
            for mode in ("light", "dark"):
                visit(variant=variant, mode=mode)
                assert page.get_by_role("dialog").count() == 1
                assert page.get_by_text("£80", exact=True).count() >= 1
                capture(f"mobile-{variant}-{mode}.png")
        visit(variant="a", state="tight")
        assert page.get_by_text("more than the", exact=False).is_visible()
        capture("mobile-a-tight.png")
        visit(variant="a", kind="set-aside", mode="dark")
        assert page.get_by_text("Kept in the paying account", exact=True).is_visible()
        assert page.get_by_text("Check it yourself", exact=True).is_visible()
        assert page.get_by_role("progressbar").count() == 0
        capture("mobile-a-set-aside-dark.png")

        # A edits one part inside the same frame, keeps the draft and confirms.
        visit(variant="a")
        page.get_by_role("button", name="Change details").click()
        page.get_by_label("Total to save (£)", exact=True).fill("2000")
        assert page.get_by_text("£100", exact=True).is_visible()
        page.get_by_label("Name", exact=True).fill("Japan, a longer trip with the family")
        page.get_by_role("button", name="Keep these changes", exact=True).click()
        expect(page.locator('[data-return-focus="details"]')).to_be_focused()
        assert page.get_by_text("Japan, a longer trip with the family", exact=True).count() >= 1
        page.get_by_role("button", name="Change paying account").click()
        radios = page.get_by_role("radio")
        assert radios.count() == 4
        assert page.get_by_text("Bills account", exact=True).count() == 0
        page.get_by_role("radio", name="Personal current account", exact=False).click()
        page.get_by_role("button", name="Use this account", exact=True).click()
        expect(page.locator('[data-return-focus="source"]')).to_be_focused()
        page.get_by_role("button", name="Keep these changes", exact=True).click()
        expect(page.locator('[data-return-focus="source"]')).to_be_focused()
        assert page.get_by_text("No matching transfer yet", exact=True).is_visible()
        page.get_by_role("button", name="Confirm plan", exact=True).click()
        assert page.get_by_text("Choose a transfer reference or", exact=False).is_visible()
        assert page.locator("[data-editor-error]").evaluate("node => node === document.activeElement")
        page.get_by_role("button", name="Check it yourself", exact=False).click()
        page.get_by_role("button", name="Keep these changes", exact=True).click()
        page.get_by_role("button", name="Confirm plan", exact=True).click()
        page.get_by_role("heading", name="Your example is ready").wait_for()

        # Refreshed summary controls, rather than disconnected DOM references,
        # receive keyboard focus after destination and tracking edits too.
        visit(variant="a")
        page.get_by_role("button", name="Change savings pots", exact=True).click()
        page.get_by_role("button", name="Holiday Monzo", exact=False).click()
        page.get_by_role("button", name="Use these choices", exact=True).click()
        expect(page.locator('[data-return-focus="destination"]')).to_be_focused()
        page.get_by_role("button", name="Keep these changes", exact=True).click()
        expect(page.locator('[data-return-focus="destination"]')).to_be_focused()
        page.get_by_role("button", name="Change transfer rule", exact=False).click()
        page.get_by_role("button", name="Keep these changes", exact=True).click()
        expect(page.locator('[data-return-focus="tracking"]')).to_be_focused()

        # B uses three short steps, actual date picker and an explicit final save.
        visit(variant="b", mode="dark")
        page.get_by_role("button", name="Target date,", exact=False).click()
        assert page.get_by_role("dialog").count() == 2
        page.get_by_role("button", name="Cancel", exact=True).last.click()
        assert page.get_by_role("dialog").count() == 1
        page.get_by_role("button", name="Choose accounts", exact=True).click()
        assert page.get_by_role("heading", name="Where the money goes").is_visible()
        capture("mobile-b-accounts-dark.png")
        page.get_by_role("button", name="Check the transfer", exact=True).click()
        assert page.get_by_text("Japan transfer", exact=True).is_visible()
        capture("mobile-b-tracking-dark.png")
        page.get_by_role("button", name="Choose a different payment", exact=True).click()
        assert page.get_by_text("Costa Coffee", exact=True).count() == 0
        assert page.get_by_text("McDonald's", exact=True).count() == 0
        page.get_by_role("textbox", name="Search transfers").fill("Japan")
        assert page.get_by_role("button", name="Japan transfer", exact=False).count() == 1
        assert page.get_by_role("button", name="Holiday transfer", exact=False).count() == 0
        capture("mobile-b-payment-search.png")
        page.get_by_role("button", name="Japan transfer", exact=False).click()
        page.get_by_text("Transfer reference", exact=True).click()
        assert page.get_by_text("ALEX TAYLOR JAPAN", exact=True).is_visible()
        page.get_by_role("button", name="Confirm plan", exact=True).click()
        page.get_by_role("heading", name="Your example is ready").wait_for()

        # Set-aside has no target/progress; receiving account is optional.
        visit(variant="b", kind="set-aside")
        assert page.get_by_role("button", name="Target date,", exact=False).count() == 0
        page.get_by_role("radio", name="Just this period", exact=True).click()
        page.get_by_role("button", name="Choose accounts", exact=True).click()
        page.get_by_role("button", name="Check the transfer", exact=True).click()
        page.get_by_role("button", name="Confirm set-aside", exact=True).click()
        page.get_by_role("heading", name="Your example is ready").wait_for()
        assert page.get_by_text("this pay period", exact=True).is_visible()

        # Empty/unassigned and partial states remain actionable without writes.
        visit(variant="a", state="unassigned")
        page.get_by_role("button", name="Confirm plan", exact=True).click()
        assert page.get_by_text("Choose the account this money will come from.", exact=True).is_visible()
        visit(variant="b", state="no-match")
        page.get_by_role("button", name="Choose accounts", exact=True).click()
        page.get_by_role("button", name="Check the transfer", exact=True).click()
        assert page.get_by_text("No suitable transfer", exact=False).is_visible()
        page.get_by_role("button", name="Enter a transfer reference", exact=True).click()
        page.get_by_label("Transfer reference", exact=True).fill("JAPAN SAVING")
        page.get_by_role("button", name="Exactly this", exact=True).click()
        page.get_by_role("button", name="Use this reference", exact=True).click()
        assert page.get_by_text("JAPAN SAVING", exact=True).first.is_visible()
        capture("mobile-b-no-match-rule.png")
        visit(variant="a", state="partial")
        page.get_by_role("button", name="Confirm plan", exact=True).click()
        assert page.get_by_text("Choose what to do with last period’s £20", exact=False).is_visible()
        page.get_by_role("button", name="Roll over £20", exact=True).click()
        assert page.get_by_text("Next period would be", exact=False).is_visible()
        capture("mobile-a-partial.png")

        # The persistent action is visible in a smaller visual viewport too.
        page.set_viewport_size({"width": 390, "height": 500})
        visit(variant="b")
        capture("short-viewport-b.png")
        page.set_viewport_size({"width": 320, "height": 740})
        visit(variant="a", mode="dark")
        capture("narrow-a-dark.png")
        page.set_viewport_size({"width": 1440, "height": 1000})
        for variant in ("a", "b"):
            visit(variant=variant)
            panel = page.locator("[data-sheet-frame]").bounding_box()
            assert panel and panel["width"] <= 500
            capture(f"desktop-{variant}.png")
        page.keyboard.press("Tab")
        assert page.locator("[data-sheet-frame]").evaluate("node => node.contains(document.activeElement)")
        page.keyboard.press("Escape")
        page.wait_for_timeout(350)
        assert page.get_by_role("dialog").count() == 0
        context.close()
        browser.close()
    assert not errors, errors
    print("PASS: G267 variants, goals/set-asides, account restrictions, transfer filtering, edits, confirmation, date picker, partial choices, responsive bounds, focus and API guard.")


if __name__ == "__main__":
    main()
