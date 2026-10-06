"""Generate N 9:16 stills. Usage: still.py "prompt" N [--model M] [--prefix name]"""
import argparse
import base64
import subprocess
import time

import requests

from common import BASE, OUT, guard, headers

ap = argparse.ArgumentParser()
ap.add_argument("prompt")
ap.add_argument("n", type=int, nargs="?", default=1)
ap.add_argument("--model", default="google/gemini-3-pro-image")
ap.add_argument("--prefix", default="still")
ap.add_argument("--est", type=float, default=0.15, help="estimated cost per image")
a = ap.parse_args()

d = OUT / "stills"
d.mkdir(parents=True, exist_ok=True)
for i in range(1, a.n + 1):
    guard(a.est)
    body = {
        "model": a.model,
        "messages": [{"role": "user", "content": a.prompt}],
        "modalities": ["image", "text"],
        "image_config": {"aspect_ratio": "9:16"},
    }
    r = requests.post(f"{BASE}/chat/completions", headers=headers(), json=body, timeout=300)
    if r.status_code != 200:
        print("error", r.status_code, r.text[:400]); continue
    msg = r.json()["choices"][0]["message"]
    imgs = msg.get("images") or []
    if not imgs:
        print("no image returned:", (msg.get("content") or "")[:300]); continue
    url = imgs[0]["image_url"]["url"]
    raw = d / f"{a.prefix}-{i}-{int(time.time())}.raw"
    raw.write_bytes(base64.b64decode(url.split(",", 1)[1]))
    png = raw.with_suffix(".png")
    # Force exactly 1080x1920: scale to cover then centre-crop (no-op if already 9:16)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-vf",
                    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", str(png)], check=True)
    raw.unlink()
    print(png)
