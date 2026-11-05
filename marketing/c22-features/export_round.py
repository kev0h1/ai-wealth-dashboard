"""Freeze real fixture-only UI states, then export the six new image stories."""
import argparse
import datetime
import hashlib
import io
import json
import re
from pathlib import Path
from urllib.parse import urlencode, urlparse
from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/features"
REVIEW = ROOT / ".impeccable/review/c22-features"
FEATURES = ("movement", "month", "spend", "split", "penny", "aside")
KINDS = ("movement", "penny-request", "penny-proposal", "penny-done", "aside-form", "aside-saved", "month-title", "month-spending", "month-categories", "spend", "spend-detail", "shape", "split", "split-card")
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}
DEPENDENCIES = [
 "frontend/app/month/story/StoryPlayer.tsx", "frontend/components/HomeBrief.tsx",
 "frontend/components/MoveRoute.tsx", "frontend/components/AccountMiniCard.tsx",
 "frontend/components/PennyConversation.tsx", "frontend/components/SetAsideSheet.tsx",
 "frontend/components/upcoming/SetAsideList.tsx", "frontend/components/SheetFrame.tsx",
 "frontend/components/AccountRadioPicker.tsx", "frontend/components/SpendPaceHero.tsx",
 "frontend/components/SpendHeader.tsx", "frontend/components/SpendShapeCard.tsx",
 "frontend/components/PaySplitComparison.tsx", "frontend/components/PaySplitComparison.module.css",
 "frontend/components/PaySplitBeyond.tsx", "frontend/lib/paySplitReference.ts",
 "frontend/lib/setAsideDisplay.ts", "frontend/lib/upcomingPlans.ts",
 "frontend/lib/companionItems.ts", "frontend/lib/coverPlanDue.ts",
 "frontend/lib/spendHero.ts", "frontend/lib/spendPeriod.ts",
 "frontend/lib/balancesHidden.ts", "frontend/lib/categories.ts",
 "frontend/lib/categoryIcons.ts", "frontend/lib/useCountUp.ts",
 "frontend/app/spend/shape/MoneyShapeHero.tsx", "frontend/app/globals.css",
 "frontend/components/MoneyText.tsx", "frontend/components/AllocationFields.tsx",
 "frontend/components/plans/PlanEditorSummary.tsx", "frontend/components/plans/PlanTrackingMethod.tsx",
 "frontend/components/plans/PlanCategoryTracking.tsx",
 "frontend/app/design/marketing-kit/features/ActionProof.tsx",
 "frontend/app/design/marketing-kit/features/action-fixtures.ts",
 "frontend/app/design/marketing-kit/features/InsightProof.tsx",
 "frontend/app/design/marketing-kit/features/insight-fixtures.ts",
]

def digest(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()

def save(raw, name, origin):
 path = OUT / name
 meta = PngImagePlugin.PngInfo()
 meta.add_text("Source", json.dumps(origin, sort_keys=True))
 Image.open(io.BytesIO(raw)).convert("RGB").save(path, pnginfo=meta, optimize=True)
 with Image.open(path) as image:
  return {"file": name, "width": image.width, "height": image.height, "bytes": path.stat().st_size, "sha256": digest(path), **origin}

def main():
 parser = argparse.ArgumentParser()
 parser.add_argument("--base", default="http://127.0.0.1:3146")
 parser.add_argument("--proofs-only", action="store_true")
 parser.add_argument("--stills-only", action="store_true")
 args = parser.parse_args()
 assert urlparse(args.base).hostname in {"127.0.0.1", "localhost"}
 OUT.mkdir(parents=True, exist_ok=True)
 REVIEW.mkdir(parents=True, exist_ok=True)
 deps = {file: digest(ROOT / file) for file in DEPENDENCIES if (ROOT / file).is_file()}
 origin = {"data": "fictional", "status": "creative-review-only", "productionUI": deps}
 errors, proofs, stills = [], [], []
 with sync_playwright() as pw:
  browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
  context = browser.new_context(viewport={"width": 422, "height": 1100}, device_scale_factor=3, reduced_motion="reduce")
  def guard(route):
   path = urlparse(route.request.url).path
   if path in SHELL and route.request.method == "GET":
    route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[path]))
   elif "/api/" in path:
    errors.append(f"Unexpected API: {route.request.method} {path}")
    route.abort()
   else: route.continue_()
  context.route("**/*", guard)
  page = context.new_page()
  # Keep the fixture period current without pausing timers needed by the UI.
  page.clock.set_fixed_time(datetime.datetime(2026, 10, 8, 12, tzinfo=datetime.UTC))
  page.on("pageerror", lambda e: errors.append(str(e)))
  page.on("response", lambda r: errors.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)
  def visit(query):
   response = page.goto(args.base + "/design/marketing-kit?" + urlencode(query), wait_until="networkidle")
   assert response.status == 200
   page.evaluate("document.fonts.ready")
   page.evaluate("Promise.all([...document.images].map(i=>i.decode()))")
   page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
   page.add_style_tag(content="nextjs-portal{display:none!important}")
  if not args.stills_only:
   for theme in ("light", "dark"):
    for kind in KINDS:
     # Completed states come from the real local confirmation/save interaction.
     if kind in {"penny-done", "aside-saved"}: continue
     page.set_viewport_size({"width": 422, "height": 780 if kind == "aside-form" else 1100})
     visit({"feature-proof": kind, "mode": theme})
     target = page.locator("[data-feature-proof]").first
     if kind == "aside-form":
      # The final sheet calls this plan type "A set-aside". Selecting the
      # shipped control keeps the subsequent fixture flow inside real UI.
      page.get_by_role("button", name="A set-aside", exact=False).click()
      page.get_by_label("What are you setting money aside for?").fill("Annual costs")
      page.get_by_role("button", name="Continue", exact=True).click()
      page.get_by_label("Amount", exact=True).fill("200")
      page.get_by_role("button", name="Continue", exact=True).click()
      page.get_by_role("radio", name=re.compile("Everyday", re.I)).click()
      page.get_by_role("button", name="Continue", exact=True).click()
      page.get_by_role("button", name="Keep it in the paying account", exact=True).click()
      page.get_by_role("button", name="Continue", exact=True).click()
      page.get_by_role("button", name="Review set-aside", exact=True).click()
      target = page.locator("[data-sheet-frame]")
     path = "ActionProof.tsx" if kind in {"movement", "penny-request", "penny-proposal", "aside-form"} else "InsightProof.tsx"
     item_origin = {**origin, "kind": "proof", "feature": kind, "theme": theme, "source": "frontend/app/design/marketing-kit/features/" + path}
     if kind == "spend-detail":
      instrument = target.get_by_role("button", name="View your pay split", exact=True)
      instrument_box = instrument.bounding_box()
      assert instrument_box and instrument_box["width"] >= 300, instrument_box
      assert "50%" in instrument.inner_text(), instrument.inner_text()
      # Keep the card header and real comparison together so this proof carries
      # the completed-period amount as well as the interaction instrument.
      assert "£2,400" in target.inner_text(), target.inner_text()
      item_origin["excerpt"] = "SpendShapeCard with its completed-period 50/30/20 comparison"
     proofs.append(save(target.screenshot(), f"proof-{kind}-{theme}.png", item_origin))
     print("PROOF", kind, theme, target.bounding_box(), flush=True)
     if kind == "penny-proposal":
      target.get_by_role("button", name="Confirm", exact=False).click()
      assert "is set up" in target.inner_text()
      proofs.append(save(target.screenshot(), f"proof-penny-done-{theme}.png", {**item_origin, "feature": "penny-done", "transition": "local confirmation before done"}))
     if kind == "aside-form":
      page.get_by_role("button", name="Save set-aside", exact=True).click()
      target = page.locator("[data-feature-proof]").first
      target.get_by_text("Annual costs", exact=True).wait_for()
      proofs.append(save(target.screenshot(), f"proof-aside-saved-{theme}.png", {**item_origin, "feature": "aside-saved", "transition": "local save before list"}))
     if kind == "split":
      rows = target.get_by_role("button", name="View Fixed breakdown", exact=True).locator("..").locator("..")
      proofs.append(save(rows.screenshot(), f"proof-split-rows-{theme}.png", {**item_origin, "feature": "split-rows", "excerpt": "Actual PaySplitComparison numeric rows, with column labels"}))
   (OUT / "proof-assets.json").write_text(json.dumps(proofs, indent=2) + "\n")
  if not args.proofs_only:
   for feature in FEATURES:
    for theme in ("light", "dark"):
     for form, height in (("feed", 1350), ("story", 1920)):
      page.set_viewport_size({"width": 1080, "height": height})
      visit({"art": 1, "variant": feature, "mode": theme, "format": form})
      art = page.locator("[data-feature-artboard]")
      box = art.bounding_box()
      assert box["width"] == 1080 and box["height"] == height, box
      assert art.get_by_text("Fictional example", exact=False).count()
      stills.append(save(art.screenshot(scale="css"), f"{feature}-{theme}-{form}.png", {**origin, "kind": "still", "feature": feature, "theme": theme, "format": form, "source": "frontend/app/design/marketing-kit/features/FeaturePoster.tsx"}))
      print("STILL", feature, theme, form, flush=True)
   (OUT / "still-assets.json").write_text(json.dumps(stills, indent=2) + "\n")
  browser.close()
 assert not errors, errors
 print("Current UI frozen; no live data read and no bank actions performed.")

if __name__ == "__main__": main()
