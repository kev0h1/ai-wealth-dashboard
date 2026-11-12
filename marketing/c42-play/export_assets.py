"""Reproduce C42 locally, reusing C22's actual production fixture interactions.

No live product API or store uploads. Every generated raster records its origin.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.parse import urlencode, urlparse

from PIL import Image, PngImagePlugin
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c42"
REVIEW = ROOT / ".impeccable/review/c42"
THEMES = ("light", "dark")
IDS = ("launch", "charts", "plans")
SHELL = {"/api/cashflow/at-risk-count": {"count": 0}, "/api/categories": [], "/api/preferences": {"hide_net_worth": False}}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_png(raw, path, source):
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Source", json.dumps(source, sort_keys=True))
    metadata.add_text("impeccable:prompt", "Origin: browser capture of coded C42 artwork using real Sorted production components with fictional fixtures; no generated imagery. " + json.dumps(source, sort_keys=True))
    Image.open(io.BytesIO(raw)).convert("RGB").save(path, pnginfo=metadata, optimize=True)


def capture_proofs(base):
    # Reuse the approved fixture choreography, including the real local Create
    # goal confirmation, while writing only C42's separate media directory.
    spec = importlib.util.spec_from_file_location("c22_capture", ROOT / "marketing/c22-features/export_round.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.OUT = OUT
    module.REVIEW = REVIEW
    module.KINDS = ("movement", "movement-sources", "spend-insight", "spend-expenses", "penny-chart", "penny-proposal")
    previous = sys.argv
    try:
        sys.argv = [str(spec.origin), "--base", base, "--proofs-only"]
        module.main()
    finally:
        sys.argv = previous
    for path in OUT.glob("proof-*.png"):
        with Image.open(path) as image:
            source = json.loads(image.info["Source"])
        save_png(path.read_bytes(), path, source)


def capture_art(base):
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1920, "height": 1080}, reduced_motion="reduce")

        def guard(route):
            parsed = urlparse(route.request.url)
            if parsed.path in SHELL and route.request.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps(SHELL[parsed.path]))
            elif "/api/" in parsed.path or (parsed.hostname not in {"127.0.0.1", "localhost"} and parsed.scheme in {"http", "https"}):
                errors.append(f"Unexpected network request: {route.request.method} {parsed.path}")
                route.abort()
            else:
                route.continue_()

        context.route("**/*", guard)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))

        def visit(query):
            response = page.goto(base + "/design/play-extras?" + urlencode(query), wait_until="networkidle")
            assert response.status == 200
            page.evaluate("document.fonts.ready")
            page.evaluate("Promise.all([...document.images].map(image => image.decode()))")
            page.add_style_tag(content="nextjs-portal{display:none!important}")

        visit({"copy": "1"})
        copy = json.loads(page.locator("[data-export-copy]").inner_text())
        copy.update({
            "status": "creative-review-only",
            "locale": "en-GB",
            "imageSafeArea": {"left": 192, "top": 162, "right": 1728, "bottom": 864},
            "videoUpload": {"channel": "Sorted YouTube channel, selected by Kevin", "privacy": ["public", "unlisted"], "embedding": True, "ageRestricted": False, "ads": False, "monetisationClaims": False, "playField": "A single YouTube video URL, not a playlist or channel URL"},
            "sources": ["https://support.google.com/googleplay/android-developer/answer/9866151?hl=en", "https://support.google.com/googleplay/android-developer/answer/12929944?hl=en"],
            "conditions": "Promotional images are templates, subject to app eligibility and a genuine new in-app launch or major update. Confirm release date, audience and discoverable in-app destination before scheduling. No offer terms or discounts are invented.",
        })
        (OUT / "play-copy.json").write_text(json.dumps(copy, indent=2, ensure_ascii=False) + "\n")

        for theme in THEMES:
            for index, shot in enumerate(copy["shots"]):
                visit({"shot": index, "mode": theme})
                target = page.locator("[data-film-artboard]")
                box = target.bounding_box()
                assert (box["width"], box["height"]) == (1920, 1080), box
                save_png(target.screenshot(scale="css"), OUT / f"shot-{index}-{theme}.png", {"item": "C42", "kind": "film-frame", "shot": index, "theme": theme, "proof": f"proof-{shot['proof']}-{theme}.png", "data": "fictional", "source": "frontend/app/design/play-extras/FilmFrame.tsx"})
            for item in IDS:
                visit({"art": item, "export": "1", "mode": theme})
                target = page.locator("[data-promotional-artboard]")
                target.locator(".recharts-surface path").first.wait_for(state="attached")
                box = target.bounding_box()
                assert (box["width"], box["height"]) == (1920, 1080), box
                # No visible text may enter these images. The live production
                # plot retains its native labels outside the explicit crop.
                visible_text = target.locator("svg text").evaluate_all("els=>els.filter(el=>{const r=el.getBoundingClientRect();const p=el.closest('[aria-hidden]')?.getBoundingClientRect();return p&&r.right>p.left&&r.left<p.right&&r.bottom>p.top&&r.top<p.bottom}).map(el=>el.textContent)")
                assert not visible_text, visible_text
                save_png(target.screenshot(scale="css"), OUT / f"{item}-{theme}.png", {"item": "C42", "kind": "promotional-image", "id": item, "theme": theme, "data": "fictional", "source": "frontend/app/design/play-extras/PromotionalCanvas.tsx", "alt": copy["promotions"][item]["alt"], "safeArea": copy["imageSafeArea"], "status": "event-template-only"})
                print("ART", item, theme, flush=True)
        browser.close()
    assert not errors, errors
    return copy


def encode(copy):
    lines, start = ["WEBVTT", "", "NOTE Original instrumental sound. Captions describe the fictional on-screen examples.", ""], 0
    for shot in copy["shots"]:
        end = start + shot["seconds"]
        lines.extend([f"00:00:{start:02}.000 --> 00:00:{end:02}.000", shot["caption"], ""])
        start = end
    assert start == 30
    (OUT / "promo.en-GB.vtt").write_text("\n".join(lines) + "\n")
    original = ROOT / "frontend/public/design-media/c22/features"
    for theme in THEMES:
        sequence = REVIEW / f"sequence-{theme}.txt"
        sequence.write_text("".join(f"file '{OUT / f'shot-{index}-{theme}.png'}'\nduration {shot['seconds']}\n" for index, shot in enumerate(copy["shots"])) + f"file '{OUT / f'shot-{len(copy['shots']) - 1}-{theme}.png'}'\n")
        print("ENCODING", theme, flush=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-f", "concat", "-safe", "0", "-i", str(sequence), "-i", str(original / "penny-sound.wav"), "-i", str(original / "movement-sound.wav"), "-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo[a];[2:a]aresample=48000,aformat=channel_layouts=stereo[b];[a][b]concat=n=2:v=0:a=1,afade=t=in:d=0.04,afade=t=out:st=29.5:d=0.5[sound]", "-map", "0:v", "-map", "[sound]", "-vf", "fps=30", "-t", "30", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-tune", "stillimage", "-x264-params", "rc-lookahead=10:sync-lookahead=0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-threads", "2", str(OUT / f"promo-{theme}.mp4")], check=True)
        save_png((OUT / f"shot-0-{theme}.png").read_bytes(), OUT / f"promo-{theme}-poster.png", {"item": "C42", "kind": "video-poster", "origin": f"shot-0-{theme}.png", "originSha256": digest(OUT / f"shot-0-{theme}.png"), "data": "fictional"})
        print("FILM", theme, flush=True)


def manifest():
    proof = json.loads((OUT / "proof-assets.json").read_text())
    sources = {**proof[0]["productionUI"]}
    for folder in (ROOT / "frontend/app/design/play-extras", ROOT / "marketing/c42-play"):
        for path in folder.iterdir():
            if path.is_file() and path.suffix in {".tsx", ".ts", ".css", ".py"}:
                sources[str(path.relative_to(ROOT))] = digest(path)
    for name in ("penny-sound.wav", "movement-sound.wav"):
        path = ROOT / "frontend/public/design-media/c22/features" / name
        sources[str(path.relative_to(ROOT))] = digest(path)
    sources["marketing/c22-features/export_round.py"] = digest(ROOT / "marketing/c22-features/export_round.py")
    assets = []
    for path in sorted(OUT.iterdir()):
        if path.name == "manifest.json" or path.suffix == ".zip":
            continue
        record = {"file": path.name, "bytes": path.stat().st_size, "sha256": digest(path)}
        if path.suffix == ".png":
            with Image.open(path) as image:
                record.update({"width": image.width, "height": image.height, "mode": image.mode, "origin": json.loads(image.info["Source"])})
        assets.append(record)
    data = {"item": "C42", "date": "2026-11-12", "status": "creative-review-only", "productionUIRevision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(), "data": "fictional", "video": {"width": 1920, "height": 1080, "seconds": 30, "fps": 30, "frames": 900, "codec": "H.264", "audio": "Original C22 penny and movement instrumental motifs, AAC", "captions": "promo.en-GB.vtt", "productVisible": "Every shot, including the first frame"}, "safeArea": {"left": 192, "top": 162, "right": 1728, "bottom": 864}, "sourceDependencies": sources, "assets": assets}
    (OUT / "manifest.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    for theme in THEMES:
        with zipfile.ZipFile(OUT / f"sorted-play-{theme}.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            for name in [f"promo-{theme}.mp4", f"promo-{theme}-poster.png", "promo.en-GB.vtt", "play-copy.json", "manifest.json", *(f"{item}-{theme}.png" for item in IDS)]:
                archive.write(OUT / name, name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3152")
    parser.add_argument("--proofs-only", action="store_true")
    parser.add_argument("--skip-proofs", action="store_true")
    parser.add_argument("--index-only", action="store_true")
    parser.add_argument("--art-only", action="store_true")
    parser.add_argument("--encode-only", action="store_true")
    args = parser.parse_args()
    if urlparse(args.base).hostname not in {"127.0.0.1", "localhost"}:
        parser.error("Only a loopback preview is allowed")
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    if args.index_only:
        manifest()
        return
    if args.encode_only:
        encode(json.loads((OUT / "play-copy.json").read_text()))
        manifest()
        return
    if not args.skip_proofs:
        capture_proofs(args.base)
    if args.proofs_only:
        return
    copy = capture_art(args.base)
    if args.art_only:
        return
    encode(copy)
    manifest()


if __name__ == "__main__":
    main()
