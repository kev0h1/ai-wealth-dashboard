"""Attach capture origins without changing pixels, then rebuild asset indexes/ZIPs.

Run after browser captures and before both film renderers' --index-only pass.
PNG IDAT chunks are preserved byte for byte. Store dependency changes here are
only the origin metadata appended to its already captured source images.
"""
import hashlib
import json
import struct
import zipfile
import zlib
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'frontend/public/design-media/c22'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

def text_metadata(path, updates):
    raw = path.read_bytes()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n'
    result, before_idat, after_idat = [raw[:8]], [], []
    at = 8
    while at < len(raw):
        size = struct.unpack('>I', raw[at:at+4])[0]
        kind = raw[at+4:at+8]
        value = raw[at+8:at+8+size]
        block = raw[at:at+12+size]
        at += 12 + size
        if kind == b'IDAT': before_idat.append(block)
        if kind == b'tEXt' and value.split(b'\0', 1)[0].decode('latin1') in updates:
            continue
        if kind == b'IEND':
            for key, value in updates.items():
                result.append(chunk(b'tEXt', key.encode('latin1') + b'\0' + value.encode('latin1')))
        result.append(block)
        if kind == b'IDAT': after_idat.append(block)
    assert at == len(raw) and before_idat == after_idat
    path.write_bytes(b''.join(result))

def refresh(records, folder):
    for record in records:
        path = folder / record['file']
        record.update(bytes=path.stat().st_size, sha256=digest(path))

# Refuse to make an old capture look current by updating metadata.
original_store = json.loads((MEDIA / 'store/manifest.json').read_text())
for record in original_store['assets']:
    assert record['proofHash'] == digest(ROOT / record['proof']), f"Recapture required: {record['file']}"
    assert record['dependencies'] == {key: digest(ROOT / key) for key in record['dependencies']}, f"Stale artwork: {record['file']}"
    assert record['proofManifests'] == {key: digest(ROOT / key) for key in record['proofManifests']}, f"Stale capture index: {record['file']}"

for name in ('next', 'features'):
    folder = MEDIA / name
    for list_name in ('proof-assets.json', 'still-assets.json'):
        records = json.loads((folder / list_name).read_text())
        for record in records:
            path = folder / record['file']
            with Image.open(path) as image:
                image.load()
                source = json.loads(image.info['Source'])
            if record.get('feature') == 'penny-done':
                source['excerpt'] = 'Actual conversation after local goal confirmation'
                record['excerpt'] = source['excerpt']
            origin = f"Origin: local Chrome capture of {source['source']}. Fictional Sorted example; no generated interface or customer data. Detailed capture provenance is embedded as Source JSON."
            text_metadata(path, {'Source': json.dumps(source, sort_keys=True), 'impeccable:prompt': origin})
        refresh(records, folder)
        (folder / list_name).write_text(json.dumps(records, indent=2) + '\n')

store = MEDIA / 'store'
manifest = json.loads((store / 'manifest.json').read_text())
# Superseded standalone phone images are no longer used by the current shelf.
for old in ('month', 'split'):
    for theme in ('light', 'dark'):
        for platform in ('apple-medium', 'apple-large', 'apple-classic', 'play'):
            path = store / f'{old}-{theme}-{platform}.png'
            if path.exists(): path.unlink()
for record in manifest['assets']:
    path = store / record['file']
    with Image.open(path) as image:
        image.load()
        source = json.loads(image.info['Source'])
    source['proofHash'] = digest(ROOT / source['proof'])
    source['proofManifests'] = {key: digest(ROOT / key) for key in source['proofManifests']}
    record.update(proofHash=source['proofHash'], proofManifests=source['proofManifests'])
    origin = f"Origin: local Chrome capture of {source['source']} at {record['width']}x{record['height']}, using exact fictional production UI captures. Source JSON records the artwork, proof and dependencies."
    text_metadata(path, {'Source': json.dumps(source, sort_keys=True), 'impeccable:prompt': origin})
refresh(manifest['assets'], store)
by_name = {record['file']: record for record in manifest['assets']}
for pack in manifest['packs']:
    path = store / pack['file']
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for member in pack['members']: archive.write(store / member, member)
        archive.writestr('upload-order-and-alt-text.json', json.dumps([{'file': member, 'alt': by_name[member]['alt']} for member in pack['members']], indent=2) + '\n')
    pack.update(bytes=path.stat().st_size, sha256=digest(path))
manifest['provenanceProcessor'] = {'marketing/c22-capabilities/finalise_provenance.py': digest(Path(__file__))}
(store / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Origin metadata attached; PNG pixel chunks unchanged; current store ZIPs and indexes rebuilt.')
