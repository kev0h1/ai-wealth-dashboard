"""Bounded desktop/phone review and real browser playback of all four MP4s."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / ".impeccable/review/c22-next"
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3146")
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {"127.0.0.1", "localhost"}
    errors, playback = [], []
    REVIEW.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
        def guard(route):
            path = urlparse(route.request.url).path
            if path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[path]))
            elif "/api/" in path:
                errors.append(f"Unexpected API {route.request.method} {path}")
                route.abort()
            else:
                route.continue_()
        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: errors.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)
        def visit(query=""):
            response = page.goto(args.base + "/design/marketing-kit" + query, wait_until="networkidle")
            assert response.status == 200
            page.evaluate("document.fonts.ready")
            page.evaluate("Promise.all([...document.images].map(i=>i.decode()))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")
        for theme in ("light", "dark"):
            visit("?topic=original&mode=" + theme)
            assert page.get_by_role("heading", name="Images", exact=True).count() == 1
            assert page.get_by_role("heading", name="Videos", exact=True).count() == 1
            assert page.locator("video").count() == 2
            for index, story in enumerate(("balance", "account")):
                video = page.locator("video").nth(index)
                video.scroll_into_view_if_needed()
                result = video.evaluate("""async v => {
                    const event = type => new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(type+' timed out')),15000);v.addEventListener(type,()=>{clearTimeout(timeout);resolve()},{once:true});});
                    const bounded = promise => new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('play timed out')),15000);promise.then(value=>{clearTimeout(timeout);resolve(value)},error=>{clearTimeout(timeout);reject(error)});});
                    v.preload='auto';v.load();await bounded(v.play());
                    await event('timeupdate');
                    v.pause();
                    const elapsed=v.currentTime;
                    const seek=event('seeked');v.currentTime=9;await seek;
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                    const canvas=document.createElement('canvas');canvas.width=108;canvas.height=192;
                    const drawing=canvas.getContext('2d');drawing.drawImage(v,0,0,108,192);
                    const pixels=drawing.getImageData(0,0,108,192).data;let low=255,high=0;
                    for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;low=Math.min(low,value);high=Math.max(high,value);}
                    for(const t of v.textTracks)t.mode='hidden';
                    return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,elapsed,seek:v.currentTime,tracks:v.textTracks.length,cues:v.textTracks[0]?.cues?.length,muted:v.muted,frameContrast:high-low,lastCaption:[...(v.textTracks[0]?.cues??[])].at(-1)?.text};
                }""")
                assert result["width"] == 1080 and result["height"] == 1920 and abs(result["duration"] - 15) < .06 and result["elapsed"] > 0 and result["seek"] == 9 and result["tracks"] == 1 and result["cues"] == 5, result
                assert result["frameContrast"] > 80, result
                if story == "balance": assert "Coming soon" in result["lastCaption"], result
                playback.append({"story": story, "theme": theme, **result})
            for width in (1440, 390, 320):
                page.set_viewport_size({"width": width, "height": 900})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
                small = page.locator("button, a").evaluate_all("""els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.height<43.5;}).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height}))""")
                assert not small, (width, small)
                page.screenshot(path=str(REVIEW / f"gallery-{theme}-{width}.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 900})
            video = page.locator("video").first
            video.scroll_into_view_if_needed()
            for scene, seconds in (("working", 6), ("closing", 13)):
                video.evaluate("""async (v,time)=>{const seek=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('seek timed out')),15000);v.addEventListener('seeked',()=>{clearTimeout(timeout);resolve()},{once:true});});v.currentTime=time;await seek;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const track of v.textTracks)track.mode='showing';}""", seconds)
                video.screenshot(path=str(REVIEW / f"balance-{theme}-{scene}-phone.png"))
        page.get_by_role("button", name="Light", exact=True).click()
        page.get_by_role("button", name="Story", exact=True).click()
        assert "mode=light" in page.url and "format=story" in page.url, page.url
        expect(page.locator("#images img").first).to_have_attribute("src", "/design-media/c22/next/amount-light-story.png")
        assert all("-light-story.png" in src for src in page.locator("#images img").evaluate_all("els=>els.map(e=>e.src)"))
        assert page.locator("video source").first.get_attribute("src").endswith("balance-light.mp4")
        page.get_by_role("link", name="Watch the videos", exact=True).click()
        assert page.url.endswith("#videos")
        page.keyboard.press("Tab")
        assert page.evaluate("document.activeElement !== document.body")
        for query, selector in [("?round=crafted", "[data-crafted-artboard]"), ("?round=worlds&campaign=d", "[data-campaign-artboard]"), ("?library=1", "h1")]:
            visit(query)
            assert page.locator(selector).count(), query
        browser.close()
    assert not errors, errors
    (REVIEW / "browser-result.json").write_text(json.dumps({"errors": errors, "playback": playback, "galleryWidths": [320, 390, 1440], "controls": "pass", "archives": "pass"}, indent=2) + "\n")
    print("Gallery: 320/390/1440 px, controls, archives, four real play/pause/seek checks passed.")

if __name__ == "__main__":
    main()
