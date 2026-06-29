"""Blender headless script: build a textured facial RELIEF from a color image +
depth map, then export GLB (textured) and STL (watertight, printable).

Invoked by blender_run.py:
    blender -b -noaudio -P build_relief.py -- <color_png> <depth_png> <out_glb> <out_stl> <depth_mm> <size_mm> <base_mm>

Pipeline inside Blender:
  plane -> heavy subdivision -> image as base color -> Displace modifier from the
  depth map -> Solidify (thickness) -> export GLB + STL.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
color_png, depth_png, out_glb, out_stl = argv[0], argv[1], argv[2], argv[3]
depth_mm = float(argv[4]); size_mm = float(argv[5]); base_mm = float(argv[6])
# Blender works in metres by default; treat 1 unit = 1 mm by scaling at the end.
S = size_mm / 1000.0
DEPTH = depth_mm / 1000.0
BASE = base_mm / 1000.0


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def main():
    reset()
    # Subdivided plane.
    bpy.ops.mesh.primitive_plane_add(size=S)
    plane = bpy.context.active_object
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.subdivide(number_cuts=200)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()

    # Depth -> displacement.
    d_img = bpy.data.images.load(depth_png)
    d_tex = bpy.data.textures.new("depth", type="IMAGE")
    d_tex.image = d_img
    disp = plane.modifiers.new("Displace", type="DISPLACE")
    disp.texture = d_tex
    disp.texture_coords = "UV"
    disp.strength = DEPTH
    disp.mid_level = 0.0

    # Backing thickness -> watertight solid.
    sol = plane.modifiers.new("Solidify", type="SOLIDIFY")
    sol.thickness = BASE
    sol.offset = -1.0

    # Photo as the base color (for the GLB).
    mat = bpy.data.materials.new("relief")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(color_png)
    mat.node_tree.links.new(bsdf.inputs["Base Color"], tex.outputs["Color"])
    plane.data.materials.append(mat)

    # Apply modifiers so the export carries real geometry.
    bpy.context.view_layer.objects.active = plane
    for m in ("Displace", "Solidify"):
        try:
            bpy.ops.object.modifier_apply(modifier=m)
        except Exception as e:
            print("modifier_apply", m, e)

    # Export — GLB packs the texture; STL is geometry only.
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", use_selection=False)
    try:
        bpy.ops.wm.stl_export(filepath=out_stl)          # Blender 4.x
    except Exception:
        bpy.ops.export_mesh.stl(filepath=out_stl)        # Blender 3.x


main()
