"""Validate C41 App Store export pixels, safe-area evidence and provenance."""
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c41-app-store"
SLOTS = {"header": (3840, 1646), "search": (3840, 2560)}
SAFE = {"header": {"x": 1097, "y": 493, "width": 1646, "height": 661}, "search": {"x": 836, "y": 765, "width": 2168, "height": 1030}}
ART_PROOFS = {("header", "a"): {"amount"}, ("header", "b"): set(), ("search", "a"): {"amount"}, ("search", "b"): {"penny"}}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def contained(box, safe):
    return box["x"] >= safe["x"] and box["y"] >= safe["y"] and box["x"] + box["width"] <= safe["x"] + safe["width"] and box["y"] + box["height"] <= safe["y"] + safe["height"]


def main() -> None:
    manifest = json.loads((OUT / "manifest.json").read_text())
    assert manifest["item"] == "C41" and manifest["specChecked"] == "2026-11-12"
    assert manifest["origin"] == "local fixture-only Chrome export"
    assets, proofs = manifest["assets"], manifest["proofs"]
    assert len(assets) == 12 and len(proofs) == 4, (len(assets), len(proofs))
    source_hashes = manifest["specs"]["sourceHashes"]
    assert source_hashes == {path: digest(ROOT / path) for path in source_hashes}, "stale source dependency"
    seen = set()
    for item in [*assets, *proofs]:
        path = OUT / item["file"]
        assert path.is_file() and item["sha256"] == digest(path) and item["bytes"] == path.stat().st_size
        assert item["file"] not in seen; seen.add(item["file"])
        with Image.open(path) as image:
            image.load()
            assert image.mode == "RGB" and "transparency" not in image.info, f"non-opaque PNG: {path}"
            assert (image.width, image.height) == (item["width"], item["height"])
            embedded = json.loads(image.info["Source"])
            assert image.info["impeccable:prompt"].startswith("Origin:"), "Missing raster origin"
            assert embedded == {key: value for key, value in item.items() if key not in {"file", "width", "height", "bytes", "sha256"}}
    expected = {f"sorted-{slot}-{variant}-{theme}-{width}x{height}.png" for slot, (width, height) in SLOTS.items() for variant in ("a", "b") for theme in ("light", "dark")}
    expected |= {f"sorted-search-{variant}-{theme}-1920x1280.png" for variant in ("a", "b") for theme in ("light", "dark")}
    assert {item["file"] for item in assets} == expected
    for item in assets:
        expected_size = (1920, 1280) if "derivativeOf" in item else SLOTS[item["slot"]]
        assert (item["width"], item["height"]) == expected_size
        assert item["sourceHashes"] == source_hashes and item["data"] == "fictional"
        if "derivativeOf" not in item:
            boxes, safe = item["keyBoxes"], SAFE[item["slot"]]
            assert boxes and all(contained(box, safe) for box in boxes), f"unsafe key: {item['file']}"
            for index, left in enumerate(boxes):
                for right in boxes[index + 1:]:
                    assert min(left["x"] + left["width"], right["x"] + right["width"]) <= max(left["x"], right["x"]) or min(left["y"] + left["height"], right["y"] + right["height"]) <= max(left["y"], right["y"]), f"overlap: {item['file']}"
        else:
            parent = next(candidate for candidate in assets if candidate["file"] == item["derivativeOf"])
            assert parent["slot"] == "search"
            assert item["safe"] == {key: value / 2 for key, value in parent["safe"].items()}
            assert all(contained(box, item["safe"]) for box in item["keyBoxes"])
    assert {(item["proof"], item["theme"]) for item in proofs} == {(proof, theme) for proof in ("amount", "penny") for theme in ("light", "dark")}
    for proof in proofs:
        assert proof["data"] == "fictional" and proof["sourceHashes"] == source_hashes
        assert proof["width"] == proof["cssWidth"] * 3
    for item in assets:
        assert all((OUT / proof["file"]).is_file() and proof["sha256"] == digest(OUT / proof["file"]) for proof in item["proofs"])
        expected_proofs = ART_PROOFS[(item["slot"], item["variant"])]
        assert {Path(proof["file"]).stem.split("-")[1] for proof in item["proofs"]} == expected_proofs
    # Fixture sums are optional, but if a route elects to record them they must reconcile.
    for fixture in manifest.get("moneyFixtures", []):
        assert fixture["total"] == sum(fixture["parts"]), f"fixture does not reconcile: {fixture.get('name')}"
    assert len(manifest["packs"]) == 1
    pack = manifest["packs"][0]; pack_path = OUT / pack["file"]
    assert pack_path.is_file() and pack["sha256"] == digest(pack_path) and pack["bytes"] == pack_path.stat().st_size
    with zipfile.ZipFile(pack_path) as archive:
        names = archive.namelist(); expected_members = set(pack["members"])
        assert set(names) == expected_members | {"alt-text-and-slots.json"} and len(names) == len(set(names))
        assert archive.testzip() is None
        for member in pack["members"]:
            assert archive.read(member) == (OUT / member).read_bytes()
        slots = json.loads(archive.read("alt-text-and-slots.json"))
        assert [entry["file"] for entry in slots] == pack["members"]
    print("C41: 12 opaque RGB exports, 4 proof captures, current provenance and safe boxes verified.")


if __name__ == "__main__":
    main()
