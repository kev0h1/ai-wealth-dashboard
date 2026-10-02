"""Touch and viewport regression for the real Penny frame/composer preview.

Run with an isolated Next server (no API is called):
  python3 frontend/scripts/g191-keyboard.browser.py --url http://127.0.0.1:3191

QA inventory: touch-down/up must keep the input still and focus it; focus,
hardware keyboards and native will-show events alone cannot expand the panel;
visible keyboard docks once; send preserves focus; hide/reopen preserves draft;
pinch zoom and toolbar resizing do not trigger takeover; desktop stays floating.
Software keyboard geometry is simulated. This does not replace physical iOS QA.
"""
import argparse
import asyncio
from playwright.async_api import async_playwright, expect

VIEWPORT = """(() => {
  let height = null;
  const v = new EventTarget();
  Object.assign(v, {offsetTop:0, offsetLeft:0, scale:1});
  Object.defineProperties(v, {width:{get:()=>innerWidth}, height:{get:()=>height ?? innerHeight}});
  Object.defineProperty(window, 'visualViewport', {value:v, configurable:true});
  window.qaViewport = (h, top=0, scale=1) => {
    height=h; v.offsetTop=top; v.scale=scale; v.dispatchEvent(new Event('resize'));
  };
})()"""


async def check(browser, url, width, height, mode, screenshots, reproduce):
    context = await browser.new_context(viewport={"width": width, "height": height},
                                        is_mobile=width < 1024, has_touch=True,
                                        reduced_motion="reduce")
    context.set_default_timeout(8000)
    await context.add_init_script(VIEWPORT)

    async def route(request):
        if request.request.url.startswith(url) and "/api/" not in request.request.url:
            await request.continue_()
        else:
            await request.fulfill(status=200, content_type="application/json", body="{}")

    await context.route("**/*", route)
    page = await context.new_page()
    await page.goto(f"{url}/design/penny-keyboard?variant=b&state=long&mode={mode}", timeout=60000)
    await page.get_by_role("button", name="Open Penny", exact=True).tap()
    panel = page.locator('[data-penny-window]').first
    field = panel.locator('[data-penny-input]')
    await expect(panel).to_be_visible()
    await expect(panel).to_have_attribute("data-penny-typing", "false")
    initial = await field.bounding_box()
    cdp = await context.new_cdp_session(page)
    await cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart", "touchPoints": [{"x": initial["x"] + 30, "y": initial["y"] + 22}],
    })
    await page.wait_for_timeout(100)
    during = await field.bounding_box()
    await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    movement = abs(initial["y"] - during["y"])
    if reproduce:
        print({"input_moved_on_touch_down_px": movement,
               "expanded_without_keyboard": await panel.get_attribute("data-penny-typing"),
               "input_received_focus": await field.evaluate("el => el === document.activeElement")}, flush=True)
        await context.close()
        return
    assert movement < 1, f"Input moved {movement}px before touch-up"
    await expect(field).to_be_focused()
    await expect(panel).to_have_attribute("data-penny-typing", "false")
    await page.keyboard.type("A draft to keep")
    for signal in ["keyboardWillShow", "keyboardDidShow"]:
        await page.evaluate("name => window.dispatchEvent(new Event(name))", signal)
        await page.wait_for_timeout(40)
        await expect(panel).to_have_attribute("data-penny-typing", "false")
    if screenshots:
        await page.screenshot(path=f"{screenshots}/g191-{width}-{mode}-focused.png")

    if width < 1024:
        # Browser toolbar movement and pinch zoom cannot be mistaken for typing.
        await page.evaluate("h => qaViewport(h-60)", height)
        await expect(panel).to_have_attribute("data-penny-typing", "false")
        await page.evaluate("h => qaViewport(h-220, 0, 2)", height)
        await expect(panel).to_have_attribute("data-penny-typing", "false")
        keyboard = max(230, height - 320)
        await page.evaluate("h => qaViewport(h)", keyboard)
        await expect(panel).to_have_attribute("data-penny-typing", "true")
        box = await panel.bounding_box()
        assert abs(box["y"] + box["height"] - keyboard) < 2, box
        await expect(panel.locator('[data-penny-secondary]').first).not_to_be_visible()
        await expect(page.locator("html")).to_have_attribute("data-penny-typing", "true")
        composer = await field.bounding_box()
        assert composer["y"] + composer["height"] <= keyboard, composer
        if screenshots:
            await page.screenshot(path=f"{screenshots}/g191-{width}-{mode}-keyboard.png")
        await page.keyboard.press("Tab")
        send = panel.get_by_role("button", name="Ask Penny", exact=True)
        await expect(send).to_be_focused()
        await expect(panel).to_have_attribute("data-penny-typing", "true")
        send_box = await send.bounding_box()
        assert send_box["y"] + send_box["height"] <= keyboard, send_box
        await page.keyboard.press("Shift+Tab")
        await expect(field).to_be_focused()
        await panel.get_by_role("button", name="Ask Penny", exact=True).tap()
        await expect(field).to_be_focused()
        await expect(field).to_have_attribute("readonly", "")
        await expect(field).not_to_have_attribute("readonly", "", timeout=3000)
        await expect(field).to_be_focused()
        await page.keyboard.type("Draft after dismissal")
        await page.evaluate("h => qaViewport(h)", height)
        await expect(panel).to_have_attribute("data-penny-typing", "false")
        await expect(field).to_be_focused()
        await expect(field).to_have_value("Draft after dismissal")
        # Re-tap a still-focused input: no new focus event is required.
        await field.tap()
        await expect(panel).to_have_attribute("data-penny-typing", "false")
        await page.evaluate("h => qaViewport(h, 20)", keyboard)
        await expect(panel).to_have_attribute("data-penny-typing", "true")
        box = await panel.bounding_box()
        assert abs(box["y"] + box["height"] - keyboard - 20) < 2, box
        log = panel.locator('[data-penny-thread]')
        await log.hover()
        await page.mouse.wheel(0, -1600)
        await page.wait_for_timeout(100)
        before = await log.evaluate("el => el.scrollTop")
        await page.evaluate("h => qaViewport(h-25, 20)", keyboard)
        await page.wait_for_timeout(80)
        assert abs(before - await log.evaluate("el => el.scrollTop")) < 2
        await page.evaluate("h => qaViewport(h)", height)
        await expect(panel).to_have_attribute("data-penny-typing", "false")
    else:
        await page.evaluate("qaViewport(500)")
        await expect(panel).to_have_attribute("data-penny-typing", "false")

    await panel.get_by_role("button", name="Close", exact=True).tap()
    await expect(panel).not_to_be_visible()
    await expect(page.get_by_role("button", name="Open Penny", exact=True)).to_be_focused()
    await page.get_by_role("button", name="Open Penny", exact=True).tap()
    await expect(field).to_have_value("Draft after dismissal" if width < 1024 else "A draft to keep")
    await expect(panel).to_have_attribute("data-penny-typing", "false")
    await page.keyboard.press("Escape")
    await expect(panel).not_to_be_visible()
    await context.close()
    print(f"G191 touch sequence and keyboard lifecycle: {width}x{height} {mode} passed", flush=True)


async def main(args):
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True,
                                          args=["--no-sandbox", "--virtual-time-budget=4000"])
        cases = [(390, 844)] if args.reproduce else [(320, 740), (390, 844), (844, 390), (1365, 900)]
        for width, height in cases:
            for mode in ["dark"] if args.reproduce else ["light", "dark"]:
                await check(browser, args.url, width, height, mode, args.screenshots, args.reproduce)
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:3191")
    parser.add_argument("--screenshots", help="Existing directory for screenshot artifacts")
    parser.add_argument("--reproduce", action="store_true")
    asyncio.run(main(parser.parse_args()))
