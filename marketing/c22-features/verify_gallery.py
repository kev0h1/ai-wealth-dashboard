"""Check feature filters, responsive layouts and actual playback of every MP4."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / ".impeccable/review/c22-features"
FEATURES = {"movement":"Money movements", "month":"Month in review", "spend":"Spend", "split":"50/30/20", "penny":"Penny actions", "aside":"Set money aside"}
SHELL = {"/api/cashflow/at-risk-count":{"count":0}, "/api/categories":[], "/api/preferences":{"hide_net_worth":False}}
PLAY = """async v => {
 const event = type => new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(type+' timed out')),15000);v.addEventListener(type,()=>{clearTimeout(timeout);resolve()},{once:true});v.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('media error'))},{once:true});});
 const bounded = promise => new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('play timed out')),15000);promise.then(result=>{clearTimeout(timeout);resolve(result)},error=>{clearTimeout(timeout);reject(error)});});
 v.preload='auto';v.load();
 await bounded(v.play());await event('timeupdate');v.pause();const elapsed=v.currentTime;
 const seek=event('seeked');v.currentTime=9;await seek;
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const canvas=document.createElement('canvas');canvas.width=108;canvas.height=192;
 const drawing=canvas.getContext('2d');drawing.drawImage(v,0,0,108,192);
 const pixels=drawing.getImageData(0,0,108,192).data;let low=255,high=0;
 for(let i=0;i<pixels.length;i+=4){const value=(pixels[i]+pixels[i+1]+pixels[i+2])/3;low=Math.min(low,value);high=Math.max(high,value);}
 for(const t of v.textTracks)t.mode='hidden';
 return {width:v.videoWidth,height:v.videoHeight,duration:v.duration,elapsed,seek:v.currentTime,tracks:v.textTracks.length,cues:v.textTracks[0]?.cues?.length,frameContrast:high-low};
}"""

def main():
 parser=argparse.ArgumentParser();parser.add_argument("--base",default="http://127.0.0.1:3146");args=parser.parse_args()
 assert urlparse(args.base).hostname in {"127.0.0.1","localhost"}
 REVIEW.mkdir(parents=True,exist_ok=True)
 errors,playback=[],[]
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox","--autoplay-policy=no-user-gesture-required"])
  context=browser.new_context(viewport={"width":1440,"height":1000},reduced_motion="reduce")
  def guard(route):
   path=urlparse(route.request.url).path
   if path in SHELL and route.request.method=="GET": route.fulfill(status=200,content_type="application/json",body=json.dumps(SHELL[path]))
   elif "/api/" in path: errors.append(f"Unexpected API {route.request.method} {path}");route.abort()
   else: route.continue_()
  context.route("**/*",guard)
  page=context.new_page();page.on("pageerror",lambda e:errors.append(str(e)))
  page.on("response",lambda r:errors.append(f"HTTP {r.status}: {r.url}") if r.status>=400 else None)
  def visit(query):
   response=page.goto(args.base+"/design/marketing-kit"+query,wait_until="networkidle");assert response.status==200
   page.evaluate("document.fonts.ready");page.evaluate("Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode()}))")
   # Local development overlay only. Production run verifies the actual CSP.
   page.locator("nextjs-portal").evaluate_all("els=>els.forEach(e=>e.style.display='none')")
  def layout(width):
   page.set_viewport_size({"width":width,"height":900})
   assert page.evaluate("document.documentElement.scrollWidth<=innerWidth"),width
   small=page.locator("button,a").evaluate_all("els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&r.height<43.5}).map(e=>e.textContent)")
   assert not small,(width,small)
  for theme in ("light","dark"):
   visit("?mode="+theme)
   expect(page.locator("#images img")).to_have_count(9);expect(page.locator("video")).to_have_count(8)
   for width in (1440,390,320):
    layout(width);page.screenshot(path=str(REVIEW/f"gallery-{theme}-{width}.png"),full_page=True)
   for feature,title in FEATURES.items():
    page.get_by_role("button",name=title,exact=True).click()
    expect(page.locator("#images img")).to_have_attribute("src",f"/design-media/c22/features/{feature}-{theme}-feed.png")
    expect(page.locator("video")).to_have_count(1)
    expect(page.locator("video source")).to_have_attribute("src",f"/design-media/c22/features/{feature}-{theme}.mp4")
    assert page.get_by_role("link",name="Download MP4",exact=True).get_attribute("href").endswith(f"{feature}-{theme}.mp4")
    page.locator("video").scroll_into_view_if_needed()
    result=page.locator("video").evaluate(PLAY)
    assert (result["width"],result["height"],result["tracks"],result["cues"])==(1080,1920,1,5),result
    assert abs(result["duration"]-15)<.06 and result["elapsed"]>0 and result["seek"]==9,result
    assert result["frameContrast"]>80,result
    playback.append({"story":feature,"theme":theme,**result})
    layout(390);page.screenshot(path=str(REVIEW/f"feature-{feature}-{theme}-phone.png"),full_page=True)
    print("Played",feature,theme,flush=True)
   page.get_by_role("button",name="First round",exact=True).click()
   expect(page.locator("video")).to_have_count(2)
   for index,story in enumerate(("balance","account")):
    page.locator("video").nth(index).scroll_into_view_if_needed()
    result=page.locator("video").nth(index).evaluate(PLAY)
    assert result["elapsed"]>0 and result["cues"]==5 and result["frameContrast"]>80,result
    playback.append({"story":story,"theme":theme,**result})
  # Rapid sequential controls must preserve all three URL parameters.
  page.get_by_role("button",name="Light",exact=True).click()
  page.get_by_role("button",name="Story",exact=True).click()
  page.get_by_role("button",name="Penny actions",exact=True).click()
  expect(page.locator("#images img")).to_have_attribute("src","/design-media/c22/features/penny-light-story.png")
  assert all(s in page.url for s in ("mode=light","format=story","topic=penny")),page.url
  page.get_by_role("link",name="Watch the videos",exact=True).click();assert page.url.endswith("#videos")
  page.keyboard.press("Tab");assert page.evaluate("document.activeElement!==document.body")
  for query,selector in [("?round=crafted","[data-crafted-artboard]"),("?round=worlds&campaign=d","[data-campaign-artboard]"),("?library=1","h1")]:
   visit(query);assert page.locator(selector).count(),query
  browser.close()
 assert not errors,errors
 (REVIEW/"browser-result.json").write_text(json.dumps({"errors":errors,"playback":playback,"widths":[320,390,1440],"filters":"pass","archives":"pass","rapidControls":"pass"},indent=2)+"\n")
 print("All six feature filters, 320/390/1440 layouts and 16 actual MP4 play/pause/seek/caption checks passed.")

if __name__=="__main__":main()
