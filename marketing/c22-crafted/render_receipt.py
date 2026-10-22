"""Build an original physical receipt scene. No generative image service.

Run with Blender 4.5 LTS:
  blender -b -t 4 --python marketing/c22-crafted/render_receipt.py -- \
    --out frontend/public/design-media/c22/crafted --font /path/Figtree.ttf \
    --mono /path/JetBrainsMono.ttf
The editable .blend lives beside this script, outside the web bundle.
"""
import argparse
import math
import json
import random
import struct
import sys
import zlib
from pathlib import Path

import bpy
from mathutils import Vector

args = argparse.ArgumentParser()
args.add_argument("--out", required=True)
args.add_argument("--font", required=True)
args.add_argument("--mono", required=True)
config = args.parse_args(sys.argv[sys.argv.index("--") + 1:])
out = Path(config.out).resolve()
out.mkdir(parents=True, exist_ok=True)
random.seed(22)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

def material(name, colour, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*colour, 1)
    shader.inputs["Roughness"].default_value = roughness
    return mat

paper = material("Uncoated receipt stock", (0.82, 0.84, 0.85))
ink = material("Printed slate ink", (0.015, 0.023, 0.042))
desk = material("Midnight slate tabletop", (0.015, 0.026, 0.046))
steel = material("Brushed pencil clip", (0.30, 0.34, 0.39), 0.3)
indigo = material("Indigo pencil lacquer", (0.07, 0.055, 0.38), 0.4)
nodes = paper.node_tree.nodes
noise = nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 320
bump = nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.12
bump.inputs["Distance"].default_value = 0.008
paper.node_tree.links.new(noise.outputs["Fac"], bump.inputs["Height"])
paper.node_tree.links.new(bump.outputs["Normal"], nodes.get("Principled BSDF").inputs["Normal"])

bpy.ops.mesh.primitive_plane_add(size=200)
bpy.context.object.name = "Table"
bpy.context.object.data.materials.append(desk)

# Thin stock, a small natural edge curl, and genuinely modelled torn ends.
verts, faces = [], []
cols, rows = 50, 100
for y in range(rows + 1):
    for x in range(cols + 1):
        px = -2.15 + 4.3 * x / cols
        py = -3.85 + 7.7 * y / rows
        if y in (0, rows):
            py += random.uniform(-0.055, 0.055)
        curl = 0.045 * (abs(py) / 3.85) ** 9
        verts.append((px, py, 0.06 + curl + 0.003 * math.sin(py * 5)))
for y in range(rows):
    for x in range(cols):
        i = y * (cols + 1) + x
        faces.append((i, i + 1, i + cols + 2, i + cols + 1))
mesh = bpy.data.meshes.new("Torn receipt mesh")
mesh.from_pydata(verts, [], faces)
mesh.update()
receipt = bpy.data.objects.new("Receipt", mesh)
bpy.context.collection.objects.link(receipt)
receipt.data.materials.append(paper)
solid = receipt.modifiers.new("Paper thickness", "SOLIDIFY")
solid.thickness = 0.009
receipt.rotation_euler.z = math.radians(-5)

sans = bpy.data.fonts.load(str(Path(config.font).resolve()))
mono = bpy.data.fonts.load(str(Path(config.mono).resolve()))

def text(body, x, y, size, face=sans, align="LEFT"):
    curve = bpy.data.curves.new(body, "FONT")
    curve.body, curve.size, curve.font = body, size, face
    curve.align_x = align
    obj = bpy.data.objects.new(body, curve)
    bpy.context.collection.objects.link(obj)
    obj.parent = receipt
    obj.location = (x, y, 0.085)
    obj.data.materials.append(ink)
    return obj

text("Sorted", -1.73, 2.95, 0.60)
text("Your money, with the working.", -1.73, 2.43, 0.215)
text("8–30 OCT 2026 · DEMO", -1.73, 1.90, 0.17)

def rule(y):
    for i in range(37):
        text("–", -1.73 + i * 0.092, y, 0.16)

rule(1.52)
for label, value, y in [("Cash now", "£610", 0.93), ("Expected bills", "−£188", 0.22), ("Your buffer", "−£110", -0.49)]:
    text(label, -1.73, y, 0.25)
    text(value, 1.7, y, 0.28, mono, "RIGHT")
rule(-1.03)
text("£312", -1.73, -2.06, 0.83, mono)
text("Estimated Safe to Spend", -1.73, -2.50, 0.24)
text("Until payday · 30 October", -1.73, -2.93, 0.19)
text("Fictional example. Estimate may change.", -1.73, -3.35, 0.14)

# A pencil cropped at the edge anchors the scene to a real desktop.
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.115, depth=7, location=(5.6, -0.3, 0.15), rotation=(0, math.pi / 2, math.radians(73)))
pencil = bpy.context.object
pencil.name = "Hexagonal indigo pencil"
pencil.data.materials.append(indigo)

world = bpy.context.scene.world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.31, 0.36, 0.46, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
bpy.ops.object.light_add(type="AREA", location=(-4.0, 2.8, 7))
bpy.context.object.data.energy = 650
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = 4.0
bpy.ops.object.camera_add(location=(0.7, 0.6, 14))
camera = bpy.context.object
camera.rotation_euler = (Vector((0.7, 0.6, 0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 15.0
scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1080
scene.render.resolution_y = 1350
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
scene.render.filepath = str(out / "receipt-scene.png")
# Pack fonts so the editable source can move to another workstation.
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(Path(__file__).with_name("receipt-scene.blend")))
bpy.ops.render.render(write_still=True)

# Preserve source provenance without decoding or altering the rendered pixels.
destination = out / "receipt-scene.png"
raw = destination.read_bytes()
assert raw[:8] == b"\x89PNG\r\n\x1a\n" and raw[-8:-4] == b"IEND"
origin = {"kind": "authored Blender render", "source": "marketing/c22-crafted/render_receipt.py",
          "editableScene": "marketing/c22-crafted/receipt-scene.blend", "renderer": "Blender 4.5.3 LTS / Cycles",
          "generation": "geometry, materials, light and print authored in Python; no generative-image model", "data": "fictional"}
payload = b"Source\0" + json.dumps(origin, sort_keys=True).encode("ascii")
chunk = b"tEXt" + payload
metadata = struct.pack(">I", len(payload)) + chunk + struct.pack(">I", zlib.crc32(chunk))
destination.write_bytes(raw[:-12] + metadata + raw[-12:])
