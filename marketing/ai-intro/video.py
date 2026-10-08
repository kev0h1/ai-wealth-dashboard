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
ap.add_argument("--last", help="optional last frame")
ap.add_argument("--prompt", required=True)
ap.add_argument("--model", default="google/veo-3.1-fast")
ap.add_argument("--duration", type=int, default=8)
ap.add_argument("--resolution", default="1080p")
ap.add_argument("--audio", action="store_true")
ap.add_argument("--name", default="take")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--max-poll", type=int, default=900)
a = ap.parse_args()
MAX_POLL = a.max_poll

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
    ],
}
if a.last:
    payload["frame_images"].append({"type": "image_url", "image_url": {"url": data_url(a.last)}, "frame_type": "last_frame"})
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
print("submitted", job["id"], flush=True)
(OUT / "jobs.log").open("a").write(json.dumps({"id": job["id"], "name": a.name, "polling_url": job["polling_url"]}) + "\n")
deadline = time.time() + MAX_POLL
while True:
    time.sleep(10)
    if time.time() > deadline:
        sys.exit(f"timeout after {MAX_POLL}s; recover with: recover.py {job['id']}")
    s = requests.get(job["polling_url"], headers=headers(), timeout=60).json()
    print(s["status"], flush=True)
    if s["status"] == "completed":
        break
    if s["status"] == "failed":
        sys.exit(f"failed: {json.dumps(s)[:500]}")
print("job", job["id"], "urls", s.get("unsigned_urls"), "cost", s.get("usage", {}).get("cost"), flush=True)
d = OUT / "takes"
d.mkdir(parents=True, exist_ok=True)
out = d / f"{a.name}-{job['id']}.mp4"
for attempt in range(1, 5):
    try:
        c = requests.get(s["unsigned_urls"][0], headers=headers(), timeout=300)
        c.raise_for_status()
        break
    except requests.RequestException as e:
        print("download retry", attempt, e, flush=True)
        if attempt == 4:
            sys.exit(f"download failed; job {job['id']} is paid, recover via polling_url {job['polling_url']}")
        time.sleep(5 * attempt)
out.write_bytes(c.content)
print(out, "balance", balance(), flush=True)
