"""Check the actual C42 hand-off, including complete media decode and provenance."""
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c42"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = json.loads((OUT / "manifest.json").read_text())
    for name, expected in manifest["sourceDependencies"].items():
        assert digest(ROOT / name) == expected, f"Stale source: {name}"
    for record in manifest["assets"]:
        path = OUT / record["file"]
        assert digest(path) == record["sha256"], f"Asset changed: {path.name}"
        if path.suffix == ".png":
            with Image.open(path) as image:
                assert image.mode == "RGB", path.name
                assert "Source" in image.info and "impeccable:prompt" in image.info, path.name
                if not path.name.startswith("proof-"):
                    assert image.size == (1920, 1080), (path.name, image.size)
                if path.name.split("-")[0] in {"launch", "charts", "plans"}:
                    difference = ImageChops.difference(image, Image.new("RGB", image.size, image.getpixel((0, 0))))
                    red, green, blue = difference.split()
                    foreground = ImageChops.lighter(ImageChops.lighter(red, green), blue).point(lambda value: 255 if value > 8 else 0)
                    bounds = foreground.getbbox()
                    assert bounds and bounds[0] >= 192 and bounds[1] >= 162 and bounds[2] <= 1728 and bounds[3] <= 864, (path.name, bounds)
    for theme in ("light", "dark"):
        movie = OUT / f"promo-{theme}.mp4"
        streams = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(movie)]))
        video = next(stream for stream in streams["streams"] if stream["codec_type"] == "video")
        audio = next(stream for stream in streams["streams"] if stream["codec_type"] == "audio")
        assert (video["width"], video["height"], video["codec_name"], video["pix_fmt"]) == (1920, 1080, "h264", "yuv420p")
        assert int(video["nb_frames"]) == 900 and video["avg_frame_rate"] == "30/1"
        assert abs(float(streams["format"]["duration"]) - 30) < 0.1
        assert audio["codec_name"] == "aac" and audio["channels"] == 2
        decoded = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(movie), "-f", "null", "-"], capture_output=True, text=True)
        assert decoded.returncode == 0 and not decoded.stderr, decoded.stderr
        sound = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(movie), "-vn", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, check=True)
        peak = float(re.search(r"max_volume: ([-\d.]+) dB", sound.stderr)[1])
        mean = float(re.search(r"mean_volume: ([-\d.]+) dB", sound.stderr)[1])
        assert -45 < mean < -5 and peak < 0, (theme, mean, peak)
        with zipfile.ZipFile(OUT / f"sorted-play-{theme}.zip") as archive:
            assert archive.testzip() is None
            expected = {f"promo-{theme}.mp4", f"promo-{theme}-poster.png", "promo.en-GB.vtt", "play-copy.json", "manifest.json", *(f"{item}-{theme}.png" for item in ("launch", "charts", "plans"))}
            assert set(archive.namelist()) == expected
            for name in expected:
                assert hashlib.sha256(archive.read(name)).hexdigest() == digest(OUT / name)
        print(f"FILM {theme}: 900 frames decoded; original audio mean {mean} dB, peak {peak} dB; ZIP verified")
    captions = (OUT / "promo.en-GB.vtt").read_text()
    assert captions.startswith("WEBVTT\n") and captions.count(" --> ") == 7 and "00:00:30.000" in captions
    copy = json.loads((OUT / "play-copy.json").read_text())
    assert sum(shot["seconds"] for shot in copy["shots"]) == 30
    for promotion in copy["promotions"].values():
        assert len(promotion["tagline"]) <= 48
        assert len(promotion["alt"]) <= 140
    assert "—" not in json.dumps(copy, ensure_ascii=False)
    print(f"PASS: {len(manifest['assets'])} asset hashes, RGB/provenance, current production sources, captions, Play copy and safe-area metadata")


if __name__ == "__main__":
    main()
