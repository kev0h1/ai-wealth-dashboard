"""Verify actual exported MP4 playback under the local production server's CSP."""
import argparse
import json
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from export_round import REVIEW, SHELL

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:3146")
args = parser.parse_args()
assert urlparse(args.base).hostname in {"127.0.0.1", "localhost"}
errors, results = [], []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
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
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}") if response.status >= 400 else None)
    for direction in ("receipt", "friday", "calendar"):
        for theme in ("light", "dark"):
            response = page.goto(f"{args.base}/design/marketing-kit?direction={direction}&mode={theme}&format=story", wait_until="networkidle")
            assert response.status == 200
            assert response.headers.get("content-security-policy"), "Use the production server with CSP"
            assert page.locator("video").evaluate("v=>v.paused && !v.autoplay && v.controls")
            video = page.locator("video")
            video.scroll_into_view_if_needed()
            # Event promises avoid wait_for_function's eval under the real CSP.
            dimensions = video.evaluate("""async v=>{
              v.muted=true;
              await new Promise((resolve,reject)=>{
                v.addEventListener('loadeddata',resolve,{once:true});
                v.addEventListener('error',()=>reject(new Error(v.error?.message)),{once:true});
                v.load();
              });
              return {width:v.videoWidth,height:v.videoHeight,duration:v.duration};
            }""")
            assert dimensions["width"] == 1080 and dimensions["height"] == 1920 and abs(dimensions["duration"] - 12) < .04, dimensions
            elapsed = video.evaluate("""async v=>{
              await v.play();
              await new Promise(resolve=>v.addEventListener('timeupdate',resolve,{once:true}));
              v.pause();return v.currentTime;
            }""")
            assert elapsed > 0
            video.evaluate("""async v=>{
              await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=10.5});
              if(v.seeking||v.readyState<2||v.currentTime<10.5)throw new Error('Seek did not settle');
            }""")
            assert video.evaluate("v=>!v.error && v.videoHeight===1920")
            cues = video.evaluate("""async v=>{
              const track=v.querySelector('track');
              if(track.readyState!==2)await new Promise(resolve=>track.addEventListener('load',resolve,{once:true}));
              return v.textTracks[0].cues.length;
            }""")
            assert cues == 3
            buttons = page.get_by_role("button")
            for button in buttons.all():
                if button.evaluate("el=>Boolean(el.closest('[inert]'))"):
                    continue
                box = button.bounding_box()
                assert box["height"] >= 44, (button.inner_text(), box)
            page.get_by_role("button", name="Story", exact=True).focus()
            assert page.evaluate("getComputedStyle(document.activeElement).outlineStyle !== 'none'")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            results.append({"direction": direction, "theme": theme, "play": "pass", "seek": "pass", "captions": 3, "noAutoplay": True, "touchTargets": "pass", "keyboardFocus": "pass"})
            print("PLAY", direction, theme, flush=True)
    manifest = page.request.get(args.base + "/design-media/c22/crafted/manifest.json")
    assert manifest.status == 200
    assert len([asset for asset in manifest.json()["assets"] if asset["kind"] == "film"]) == 6
    browser.close()
assert not errors, errors
(REVIEW / "playback-result.json").write_text(json.dumps({"errors": errors, "results": results}, indent=2) + "\n")
