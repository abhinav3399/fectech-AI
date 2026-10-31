"""Build a bright, non-metallic textured material for generated avatar surfaces."""
import trimesh
from PIL import ImageEnhance


def bright_textured(uv, img):
    rgb = img.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(1.12)
    mat = trimesh.visual.material.PBRMaterial(
        baseColorTexture=rgb,
        metallicFactor=0.0,
        roughnessFactor=0.95,
        emissiveTexture=rgb,
        emissiveFactor=[0.55, 0.55, 0.55],
    )
    return trimesh.visual.TextureVisuals(uv=uv, image=rgb, material=mat)


def solid_skin(color):
    """Create a lit, non-emissive material for reconstructed skin volume."""
    rgb = tuple(max(0, min(255, int(channel))) / 255.0 for channel in color)
    mat = trimesh.visual.material.PBRMaterial(
        baseColorFactor=[*rgb, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.88,
    )
    return trimesh.visual.TextureVisuals(material=mat)
