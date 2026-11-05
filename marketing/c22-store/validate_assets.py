"""Validate C22 store export dimensions, provenance and pixel format."""
import hashlib
import json
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/store"
SIZES = {"apple-medium": (1206, 2622), "apple-large": (1320, 2868), "apple-classic": (1242, 2688), "play": (1080, 1920), "feature": (1024, 500)}
IDS = {"amount", "account", "spend", "month", "split", "movement", "penny", "aside"}

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    manifest = json.loads((OUT / "manifest.json").read_text())
    records = manifest["assets"]
    assert manifest["item"] == "C22" and manifest["status"] == "creative-review-only"
    assert len(records) == 66, f"expected 66 assets, got {len(records)}"
    seen = set()
    for record in records:
        path = OUT / record["file"]; assert path.is_file(), path
        assert record["sha256"] == digest(path), path
        expected = SIZES[record["platform"]]; assert tuple(record["size"]) == expected
        with Image.open(path) as image:
            assert image.size == expected and image.mode == "RGB", (path, image.size, image.mode)
            origin = json.loads(image.info["Source"])
            assert all(origin[key] == record[key] for key in ("id", "theme", "platform", "proof", "proofHash", "dependencies", "proofManifests")), path
        assert record["data"] == "fictional" and record["id"] in IDS
        assert record["dependencies"] == {key: digest(ROOT / key) for key in record["dependencies"]}, f"stale source: {path}"
        proof = ROOT / record["proof"]; assert record["proofHash"] == digest(proof), f"stale proof: {path}"
        assert record["proofManifests"] == {key: digest(ROOT / key) for key in record["proofManifests"]}, f"stale proof manifest: {path}"
        assert record["file"] not in seen; seen.add(record["file"])
    normal = [r for r in records if r["platform"] != "feature"]
    assert len(normal) == 64 and {r["platform"] for r in normal} == {"apple-medium", "apple-large", "apple-classic", "play"}
    expected_files = {f"{item}-{theme}-{platform}.png" for item in IDS for theme in ("light", "dark") for platform in ("apple-medium", "apple-large", "apple-classic", "play")}
    expected_files |= {f"feature-amount-{theme}.png" for theme in ("light", "dark")}
    assert seen == expected_files
    assert len([r for r in records if r["platform"] == "feature"]) == 2
    assert len(manifest["packs"]) == 10
    for pack in manifest["packs"]:
        path = OUT / pack["file"]; assert path.is_file(), path
        assert pack["bytes"] == path.stat().st_size and pack["sha256"] == digest(path)
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
        assert set(pack["members"]).issubset(names)
        assert "upload-order-and-alt-text.json" in names
    print("C22 store assets: 66 RGB exports, exact platform dimensions and current provenance.")

if __name__ == "__main__": main()
