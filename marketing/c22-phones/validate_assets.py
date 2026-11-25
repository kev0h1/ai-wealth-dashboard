"""Check the final C22 phone assets, source provenance and download packs."""
import json
from pathlib import Path
import subprocess
import zipfile

from PIL import Image

from export_assets import ROOT, OUT, catalog, digest, source_hashes


def main():
    data = catalog()
    manifest = json.loads((OUT / "manifest.json").read_text())
    assert manifest["item"] == "C22" and manifest["status"] == "design-review-only"
    assert manifest["renderScale"] == 3
    assert manifest["dependencies"] == source_hashes(), "Export source has changed"
    expected = {
        f"{variant}-{format_id}-{theme}-{index:02}-{story}.png"
        for variant in ("a", "b") for format_id in data["formatIds"]
        for theme in ("light", "dark") for index, story in enumerate(data["storyIds"], 1)
    }
    assert len(manifest["assets"]) == len(expected) == 16 * len(data["storyIds"])
    assert {record["file"] for record in manifest["assets"]} == expected
    for record in manifest["assets"]:
        path = OUT / record["file"]
        size = data["formats"][record["format"]]
        assert record["sha256"] == digest(path) and record["bytes"] == path.stat().st_size
        assert record["sourceFingerprint"] == manifest["sourceFingerprint"]
        assert record["data"] == "fictional" and record["asOf"] == "2026-11-17"
        assert record["period"] == [data["scenario"]["periodStart"], data["scenario"]["periodEnd"]]
        assert record["size"] == [size["width"], size["height"]]
        with Image.open(path) as image:
            image.load()
            assert image.mode == "RGB" and list(image.size) == record["size"]
            embedded = json.loads(image.info["Source"])
            assert all(embedded[key] == value for key, value in record.items() if key not in {"file", "bytes", "sha256"})
    assert len(manifest["packs"]) == 16
    for pack in manifest["packs"]:
        path = OUT / pack["file"]
        assert pack["sha256"] == digest(path) and pack["bytes"] == path.stat().st_size
        assert len(pack["members"]) == len(data["storyIds"])
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None
            assert archive.namelist() == pack["members"] + ["order-and-provenance.json"]
            order = json.loads(archive.read("order-and-provenance.json"))
            assert [item["story"] for item in order] == data["storyIds"]
            assert [item["file"] for item in order] == pack["members"]
            assert all(item["theme"] == pack["theme"] and item["format"] == pack["format"] and item["variant"] == pack["variant"] for item in order)
            for item in order:
                assert archive.read(item["file"]) == (OUT / item["file"]).read_bytes()
    assert set(path.name for path in OUT.glob("*.png")) == expected
    assert manifest["unexpectedRequests"] == []
    subprocess.run(["node", "--no-warnings", "--experimental-loader", "../marketing/c22-phones/fixture-loader.mjs", "../marketing/c22-phones/verify_fixture.mjs"], cwd=ROOT / "frontend", check=True)
    print(f"C22 phones: {len(expected)} RGB PNGs, 16 ordered ZIPs, exact sizes and current source provenance passed.")


if __name__ == "__main__":
    main()
