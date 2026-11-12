"""Read Apple's exact art safe areas without installing a PSD renderer.

Download the two official PSDs linked in specs.json and pass their paths:
python3 marketing/c41-app-store/verify_apple_templates.py header.psd search.psd
This command is read-only. Apple templates are not redistributed in the pack.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path


def safe_layer(path):
    raw = path.read_bytes()
    assert raw[:6] == b"8BPS\x00\x01", "Expected a version 1 Photoshop file"
    assert struct.unpack_from(">H", raw, 22)[0] == 16, "Expected Apple's 16-bit template"
    height, width = struct.unpack_from(">II", raw, 14)
    at = 26
    for _ in range(2):  # colour-mode data, then image resources
        length = struct.unpack_from(">I", raw, at)[0]
        at += 4 + length
    mask_length = struct.unpack_from(">I", raw, at)[0]
    end = at + 4 + mask_length
    at = raw.index(b"8BIMLr16", at, end) + 8
    length = struct.unpack_from(">I", raw, at)[0]
    at += 4
    layer_end = at + length
    count = abs(struct.unpack_from(">h", raw, at)[0])
    at += 2
    for _ in range(count):
        top, left, bottom, right = struct.unpack_from(">4i", raw, at)
        at += 16
        channels = struct.unpack_from(">H", raw, at)[0]
        at += 2 + channels * 6 + 12
        extra_length = struct.unpack_from(">I", raw, at)[0]
        at += 4
        extra_end = at + extra_length
        assert extra_end <= layer_end
        for _ in range(2):  # mask data, then blending ranges
            size = struct.unpack_from(">I", raw, at)[0]
            at += 4 + size
        size = raw[at]
        name = raw[at + 1:at + 1 + size].decode("macroman")
        if name == "Art Safe Area":
            return {"size": [width, height], "safe": {"x": left, "y": top, "width": right - left, "height": bottom - top}, "templateSha256": hashlib.sha256(raw).hexdigest()}
        at = extra_end
    raise ValueError("No Art Safe Area layer found")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("header", type=Path)
    parser.add_argument("search", type=Path)
    args = parser.parse_args()
    specs = json.loads(Path(__file__).with_name("specs.json").read_text())
    for slot in ("header", "search"):
        result = safe_layer(getattr(args, slot))
        for key, value in result.items():
            assert specs[slot][key] == value, f"Apple template changed: {slot}.{key}"
        print(slot, json.dumps(result))
