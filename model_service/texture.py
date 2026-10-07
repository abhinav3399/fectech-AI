"""Build a BRIGHT textured material for the GLB.

trimesh's default PBR material is metallic, which renders near-black in three.js
with no environment map. We force non-metallic + add the photo as an emissive
(self-lit) texture, so the face is clearly visible under any lighting.
"""
import trimesh
from PIL import ImageEnhance


def bright_textured(uv, img):
    rgb = img.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(1.12)  # gentle lift
    mat = trimesh.visual.material.PBRMaterial(
        baseColorTexture=rgb,
        metallicFactor=0.0,        # NOT metallic -> lit normally (fixes the dark face)
        roughnessFactor=0.95,
        emissiveTexture=rgb,       # self-lit so it's bright regardless of scene lights
        emissiveFactor=[0.55, 0.55, 0.55],
    )
    return trimesh.visual.TextureVisuals(uv=uv, image=rgb, material=mat)
