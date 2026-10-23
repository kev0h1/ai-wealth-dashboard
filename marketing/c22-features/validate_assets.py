"""Validate deliverables, production-source freshness and full film decoding."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/features"
FEATURES = ("movement", "month", "spend", "split", "penny", "aside")

def digest(path):
 return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
 manifest = json.loads((OUT / "manifest.json").read_text())
 assert manifest["status"] == "creative-review-only"
 for source, expected in manifest["sourceDependencies"].items():
  assert digest(ROOT / source) == expected, f"Stale source: {source}"
 assets = {a["file"]: a for a in manifest["assets"]}
 assert len(assets) == len(manifest["assets"])
 for name, asset in assets.items():
  assert Path(name).name == name
  path = OUT / name
  assert path.stat().st_size == asset["bytes"] and digest(path) == asset["sha256"], name
  if name.endswith(".png"):
   with Image.open(path) as image:
    assert image.size == (asset["width"], asset["height"]), name
    origin = json.loads(image.info["Source"])
    assert origin["data"] == "fictional", name
    assert all(manifest["sourceDependencies"][file] == expected for file, expected in origin["productionUI"].items()), name
    image.verify()
  if asset["kind"] == "film":
   info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))
   video = next(s for s in info["streams"] if s["codec_type"] == "video")
   audio = next(s for s in info["streams"] if s["codec_type"] == "audio")
   assert (video["codec_name"], video["width"], video["height"], video["avg_frame_rate"], int(video["nb_frames"])) == ("h264",1080,1920,"30/1",450), name
   assert video["pix_fmt"] in {"yuv420p", "yuvj420p"} and audio["codec_name"] == "aac", name
   assert abs(float(info["format"]["duration"]) - 15) < .06, name
   decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], capture_output=True, check=True)
   assert not decoded.stderr, (name, decoded.stderr)
   volume = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, check=True)
   mean = re.search(r"mean_volume: ([-\d.]+) dB", volume.stderr)
   assert mean and -55 < float(mean.group(1)) < -10, f"Missing or excessive sound: {name}"
   print("Decoded", name, "450 frames and AAC sound", flush=True)
 for feature in FEATURES:
  for theme in ("light", "dark"):
   for form, height in (("feed",1350),("story",1920)):
    a = assets[f"{feature}-{theme}-{form}.png"]
    assert (a["width"],a["height"],a["kind"]) == (1080,height,"still")
   assert assets[f"{feature}-{theme}.mp4"]["kind"] == "film"
  assert (OUT / f"{feature}.vtt").read_text().count(" --> ") == 5
  assert assets[f"{feature}-sound.wav"]["kind"] == "sound"
 assert sum(a["kind"] == "still" for a in assets.values()) == 24
 assert sum(a["kind"] == "film" for a in assets.values()) == 12
 assert sum(a["kind"] == "proof" for a in assets.values()) == 30
 # The previous approved exports must remain byte-for-byte intact.
 old = ROOT / "frontend/public/design-media/c22/next"
 previous = json.loads((old / "manifest.json").read_text())
 for asset in previous["assets"]:
  assert digest(old / asset["file"]) == asset["sha256"], f"Approved asset changed: {asset['file']}"
 print("24 new PNGs, 12 films, 30 fresh UI proofs; approved 12 PNGs and 4 films preserved.")

if __name__ == "__main__": main()
