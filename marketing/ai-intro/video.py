"""Stage 2: image-to-video via OpenRouter /videos. Use --dry-run to print payload + estimate only."""
import argparse
import base64
import json
import sys
import time
from pathlib import Path

import requests

from common import BASE, OUT, balance, guard, headers


def data_url(p):
    return "data:image/png;base64," + base64.b64encode(Path(p).read_bytes()).decode()


ap = argparse.ArgumentParser()
ap.add_argument("--first", required=True)
ap.add_argument("--last", required=True)
ap.add_argument("--prompt", required=True)
ap.add_argument("--model", default="google/veo-3.1-fast")
ap.add_argument("--duration", type=int, default=8)
ap.add_argument("--resolution", default="1080p")
ap.add_argument("--audio", action="store_true")
ap.add_argument("--name", default="take")
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()

models = requests.get(f"{BASE}/videos/models", headers=headers(), timeout=30).json()["data"]
m = next(x for x in models if x["id"] == a.model)
skus = m["pricing_skus"]
suffix = "" if a.resolution == "1080p" else f"_{a.resolution.lower()}"
sku = f"duration_seconds_{'with' if a.audio else 'without'}_audio{suffix}"
if sku not in skus:
    sys.exit(f"no pricing sku {sku}; have {list(skus)}")
est = round(float(skus[sku]) * a.duration, 4)

payload = {
    "model": a.model, "prompt": a.prompt, "duration": a.duration,
    "resolution": a.resolution, "aspect_ratio": "9:16", "generate_audio": a.audio,
    "frame_images": [
        {"type": "image_url", "image_url": {"url": data_url(a.first)}, "frame_type": "first_frame"},
        {"type": "image_url", "image_url": {"url": data_url(a.last)}, "frame_type": "last_frame"},
    ],
}
shown = json.loads(json.dumps(payload))
for f in shown["frame_images"]:
    f["image_url"]["url"] = f["image_url"]["url"][:40] + "...(base64)"
print(json.dumps(shown, indent=2))
print(f"sku={sku} ${skus[sku]}/s x {a.duration}s = est ${est:.2f}; balance ${balance():.2f}")
if a.dry_run:
    sys.exit(0)

guard(est)
r = requests.post(f"{BASE}/videos", headers=headers(), json=payload, timeout=120)
r.raise_for_status()
job = r.json()
print("submitted", job["id"])
while True:
    time.sleep(10)
    s = requests.get(job["polling_url"], headers=headers(), timeout=60).json()
    print(s["status"])
    if s["status"] == "completed":
        break
    if s["status"] == "failed":
        sys.exit(f"failed: {json.dumps(s)[:500]}")
d = OUT / "takes"
d.mkdir(parents=True, exist_ok=True)
out = d / f"{a.name}-{job['id']}.mp4"
c = requests.get(s["unsigned_urls"][0], headers=headers(), timeout=300)
c.raise_for_status()
out.write_bytes(c.content)
print(out, "cost", s.get("usage", {}).get("cost"), "balance", balance())
