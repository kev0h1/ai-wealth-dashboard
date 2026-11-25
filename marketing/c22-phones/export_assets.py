"""Export the fixture-only C22 phone round directly from production components.

This captures the final coded composition at 3x. It never enlarges a previously
captured screenshot, talks to a bank, or publishes artwork to either store.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urlparse
import zipfile

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright
from layout_checks import check_layout

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/phones"
SOURCE = ROOT / "frontend/app/design/marketing-phones"
SHELL_GETS = {
    "/api/cashflow/at-risk-count": {"count": 0},
    "/api/categories": [],
    "/api/preferences": {"hide_net_worth": False, "dark_mode": False},
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def catalog() -> dict:
    code = (
        'import { FORMATS, FORMAT_IDS, STORY_IDS, STORIES, SCENARIO } from '
        '"./frontend/app/design/marketing-phones/catalog.ts";'
        'process.stdout.write(JSON.stringify({formats:FORMATS,formatIds:FORMAT_IDS,stories:STORIES,storyIds:STORY_IDS,scenario:SCENARIO}));'
    )
    return json.loads(subprocess.check_output(
        ["node", "--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", code],
        cwd=ROOT, text=True,
    ))


def source_hashes() -> dict[str, str]:
    """Record the direct production renderers and their checked-in UI dependencies.

    Taking a complete components/lib snapshot also covers indirect imports and
    shared financial formatters without pretending a partial hand-written list
    is a transitive dependency graph.
    """
    paths = list(SOURCE.glob("*.tsx")) + list(SOURCE.glob("*.ts")) + list(SOURCE.glob("*.css"))
    for directory in (ROOT / "frontend/components", ROOT / "frontend/lib", ROOT / "shared"):
        paths.extend(p for p in directory.rglob("*") if p.is_file() and p.suffix in {".ts", ".tsx", ".css", ".json"} and "node_modules" not in p.parts)
    paths.extend([ROOT / "frontend/app/globals.css", ROOT / "frontend/package-lock.json", ROOT / "frontend/app/components/SpendPage.tsx"])
    # Imported frozen pure-engine goal data is a fixture input, not an image.
    fixture_directory = ROOT / "frontend/app/design/marketing-kit/capabilities"
    paths.extend(p for p in fixture_directory.iterdir() if p.suffix in {".ts", ".json"})
    paths.extend([Path(__file__).resolve(), ROOT / "marketing/c22-phones/validate_assets.py", ROOT / "marketing/c22-phones/layout_checks.py", ROOT / "marketing/c22-phones/verify_fixture.mjs", ROOT / "marketing/c22-phones/fixture-loader.mjs"])
    return {str(p.relative_to(ROOT)): digest(p) for p in sorted(set(paths))}


def save_rgb(raw: bytes, destination: Path, provenance: dict) -> dict:
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Source", json.dumps(provenance, sort_keys=True))
    with Image.open(io.BytesIO(raw)) as image:
        assert list(image.size) == provenance["size"], (image.size, provenance["size"])
        image.convert("RGB").save(destination, pnginfo=metadata, optimize=True)
    return {**provenance, "file": destination.name, "bytes": destination.stat().st_size, "sha256": digest(destination)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3158")
    parser.add_argument("--variants", nargs="+", choices=("a", "b"), default=["a", "b"])
    args = parser.parse_args()
    assert urlparse(args.base).hostname in {"127.0.0.1", "localhost"}, "Use a local preview only"
    data = catalog()
    dependencies = source_hashes()
    source_fingerprint = hashlib.sha256(json.dumps(dependencies, sort_keys=True).encode()).hexdigest()
    OUT.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    metrics: list[dict] = []
    errors: list[str] = []
    shell_requests: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path="/usr/bin/google-chrome", headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--virtual-time-budget=4000"],
        )
        for theme in ("light", "dark"):
            context = browser.new_context(device_scale_factor=3, reduced_motion="reduce", color_scheme=theme)
            context.add_init_script("""(() => {
              const NativeDate = Date;
              const frozen = NativeDate.parse(C22_CAPTURE_DATE);
              window.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : [frozen])); }
                static now() { return frozen; }
              };
            })();""".replace("C22_CAPTURE_DATE", json.dumps(data["scenario"]["asOf"] + "T09:41:00Z")))
            context.add_init_script(f"localStorage.setItem('wd_dark', '{1 if theme == 'dark' else 0}');")

            def guard(route):
                parsed = urlparse(route.request.url)
                path = parsed.path
                if path in SHELL_GETS and route.request.method == "GET":
                    shell_requests.append(path)
                    body = dict(SHELL_GETS[path]) if isinstance(SHELL_GETS[path], dict) else SHELL_GETS[path]
                    if path.endswith("preferences"):
                        body["dark_mode"] = theme == "dark"
                    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
                elif "/api/" in path:
                    errors.append(f"Unexpected API request: {route.request.method} {path}")
                    route.abort()
                elif parsed.hostname not in {"localhost", "127.0.0.1"} and parsed.scheme in {"http", "https"}:
                    errors.append(f"Unexpected external asset: {parsed.hostname}{path}")
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", guard)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            for variant in args.variants:
                for format_id in data["formatIds"]:
                    size = data["formats"][format_id]
                    page.set_viewport_size({"width": size["cssWidth"], "height": size["cssHeight"]})
                    for order, story in enumerate(data["storyIds"], 1):
                        query = urlencode({"export": "1", "variant": variant, "format": format_id, "mode": theme, "story": story})
                        url = f"{args.base}/design/marketing-phones?{query}"
                        response = page.goto(url, wait_until="networkidle")
                        assert response and response.status == 200, url
                        page.evaluate("document.fonts.ready")
                        page.wait_for_selector("[data-c22-product]")
                        page.wait_for_selector('[data-c22-viewport-ready="true"]')
                        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
                        page.add_style_tag(content="nextjs-portal{display:none!important}")
                        target = page.locator("[data-c22-artboard]")
                        bounds = target.bounding_box()
                        assert bounds and abs(bounds["width"] - size["cssWidth"]) < .01 and abs(bounds["height"] - size["cssHeight"]) < .01, bounds
                        geometry = target.evaluate("""node => {
                          const a = node.getBoundingClientRect();
                          const screen = node.querySelector('[data-c22-screen]').getBoundingClientRect();
                          const phoneElement = node.querySelector('[data-c22-phone]');
                          const phone = phoneElement.getBoundingClientRect();
                          const stage = phoneElement.parentElement.getBoundingClientRect();
                          const copy = node.querySelector('[data-c22-copy]').getBoundingClientRect();
                          const product = node.querySelector('[data-c22-product]');
                          const scale = product.getBoundingClientRect().width / product.clientWidth;
                          const visibleHeight = Math.max(0, Math.min(screen.bottom,a.bottom,stage.bottom)-Math.max(screen.top,a.top,stage.top));
                          const proofImages = [...node.querySelectorAll('img')].map(n=>n.getAttribute('src')).filter(s=>s && /proof-|design-media\\/c22/.test(s));
                          const rows = [...node.querySelectorAll('[data-balanced-row]')].map(row=> {
                            const content = row.querySelector('[data-row-content]');
                            if (!content) return null;
                            const r=row.getBoundingClientRect(), c=content.getBoundingClientRect();
                            return {name:row.getAttribute('data-balanced-row'),top:(c.top-r.top)/scale,bottom:(r.bottom-c.bottom)/scale};
                          }).filter(Boolean);
                          const closed = [...node.querySelectorAll('summary')].filter(el=>!el.parentElement.open)
                            .concat([...node.querySelectorAll('[data-schedule-disclosure] > button[aria-expanded="false"]')])
                            .filter(el=>el.getBoundingClientRect().height>0);
                          const disclosures = closed.map(el=>{
                            const r=el.getBoundingClientRect(), range=document.createRange();
                            range.selectNodeContents(el); const c=range.getBoundingClientRect();
                            return {label:el.innerText,top:(c.top-r.top)/scale,bottom:(r.bottom-c.bottom)/scale,height:r.height/scale};
                          });
                          const status=node.querySelector('[class*="statusBar"]');
                          const radius=parseFloat(getComputedStyle(node.querySelector('[data-c22-screen]')).borderTopLeftRadius);
                          const inside=(x,y)=>{
                            if(x<screen.left||x>screen.right||y<screen.top||y>screen.bottom)return false;
                            const cx=Math.max(screen.left+radius,Math.min(x,screen.right-radius));
                            const cy=Math.max(screen.top+radius,Math.min(y,screen.bottom-radius));
                            return Math.hypot(x-cx,y-cy)<=radius+.5;
                          };
                          const statusInside=[...status.children].every(el=>{
                            const r=el.getBoundingClientRect();
                            return [[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom]].every(([x,y])=>inside(x,y));
                          });
                          return {visibleScreenRatio:visibleHeight/a.height, screenWidth:screen.width,
                            productWidth:product.clientWidth, copyGap:phone.top-copy.bottom,
                            fullPhoneContained:phone.top>=Math.max(a.top,stage.top) && phone.bottom<=Math.min(a.bottom,stage.bottom) && phone.left>=a.left && phone.right<=a.right,
                            productScrollHeight:product.scrollHeight, productClientHeight:product.clientHeight,
                            proofImages, balancedRows:rows, disclosures, statusInside, text:node.innerText};
                        }""")
                        assert not geometry["proofImages"], geometry["proofImages"]
                        assert .75 <= geometry["visibleScreenRatio"] <= .905, (variant, format_id, story, geometry["visibleScreenRatio"])
                        assert geometry["productWidth"] >= 320, (format_id, geometry["productWidth"])
                        assert geometry["copyGap"] >= 11.5, (variant, format_id, story, geometry["copyGap"])
                        if variant == "a":
                            assert geometry["fullPhoneContained"], (format_id, story, geometry)
                        assert geometry["statusInside"], (variant, format_id, "Clipped illustrated status bar")
                        assert all(abs(row["top"]-row["bottom"]) <= 1.01 for row in geometry["disclosures"]), (variant, format_id, story, geometry["disclosures"])
                        assert all(abs(row["top"]-row["bottom"]) <= 1.01 for row in geometry["balancedRows"]), (variant, format_id, story, geometry["balancedRows"])
                        assert "until 30 October" not in geometry["text"] and "Chart my spending" not in geometry["text"]
                        assert not errors, errors
                        geometry["fidelity"] = check_layout(target, format_id, story)
                        filename = f"{variant}-{format_id}-{theme}-{order:02}-{story}.png"
                        provenance = {
                            "item": "C22", "status": "design-review-only", "data": "fictional",
                            "variant": variant, "format": format_id, "theme": theme, "story": story,
                            "order": order, "size": [size["width"], size["height"]],
                            "model": size["modelLabel"], "deviceFrame": "coded illustration, not a native simulator capture",
                            "render": "direct production components at deviceScaleFactor 3, no screenshot intermediate",
                            "sourceFingerprint": source_fingerprint,
                            "persona": data["scenario"]["person"], "asOf": data["scenario"]["asOf"],
                            "period": [data["scenario"]["periodStart"], data["scenario"]["periodEnd"]],
                            "alt": f"{data['stories'][story]['title']}. {data['stories'][story]['caption']}",
                        }
                        records.append(save_rgb(target.screenshot(scale="device", animations="disabled"), OUT / filename, provenance))
                        metrics.append({"file": filename, **geometry})
                        print(f"Captured {filename}", flush=True)
            context.close()
        browser.close()
    assert not errors, errors
    assert dependencies == source_hashes(), "Source changed during export; capture only a settled implementation"
    packs = []
    for variant in args.variants:
        for format_id in data["formatIds"]:
            for theme in ("light", "dark"):
                selected = [r for r in records if r["variant"] == variant and r["format"] == format_id and r["theme"] == theme]
                assert [r["story"] for r in selected] == data["storyIds"]
                path = OUT / f"sorted-{variant}-{format_id}-{theme}.zip"
                with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    for record in selected:
                        archive.write(OUT / record["file"], record["file"])
                    archive.writestr("order-and-provenance.json", json.dumps(selected, indent=2) + "\n")
                packs.append({"file": path.name, "variant": variant, "format": format_id, "theme": theme, "members": [r["file"] for r in selected], "bytes": path.stat().st_size, "sha256": digest(path)})
    manifest = {
        "item": "C22", "status": "design-review-only", "renderScale": 3,
        "sourceFingerprint": source_fingerprint, "dependencies": dependencies,
        "formats": data["formats"], "scenario": data["scenario"], "order": data["storyIds"], "assets": records, "packs": packs,
        "shellGetStubs": sorted(set(shell_requests)), "unexpectedRequests": [],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    evidence = ROOT / "marketing/c22-phones/export-review.json"
    evidence.write_text(json.dumps({"item": "C22", "errors": errors, "assets": metrics}, indent=2) + "\n")
    print(f"Exported {len(records)} RGB PNGs and {len(packs)} ordered ZIPs.")


if __name__ == "__main__":
    main()
