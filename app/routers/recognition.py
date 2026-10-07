"""Recognition — identify a face or detect objects (with remembered locations)."""
from fastapi import APIRouter, File, UploadFile

from app.config import get_settings
from app.services import calibration, face_service, object_service, qdrant_service

router = APIRouter(prefix="/api", tags=["recognition"])
settings = get_settings()


@router.post("/recognize/face")
async def recognize_face(image: UploadFile = File(...)):
    data = await image.read()
    emb = face_service.embed_face(data)
    if emb is None:
        return {"recognized": False, "reason": "no_face_detected"}
    hits = qdrant_service.search(settings.people_collection, emb.tolist(), limit=5)
    calib = calibration.calibrate(hits)
    # Invariant: only 'high' counts as recognized; medium/low must not assert identity.
    recognized = calib["tier"] == "high"
    return {
        "recognized": recognized,
        "tier": calib["tier"],
        "p": calib["p"],
        "score": calib["score"],
        "margin": calib["margin"],
        "person": calib["candidate"] if recognized else None,
    }


def _remembered_location(label: str) -> str | None:
    for p in qdrant_service.scroll(settings.objects_collection):
        payload = p.payload or {}
        if payload.get("label", "").lower() == label.lower():
            return payload.get("location") or None
    return None


@router.post("/recognize/object")
async def recognize_object(image: UploadFile = File(...)):
    data = await image.read()
    detections = object_service.detect(data)
    enriched = [
        {**d, "remembered_location": _remembered_location(d["label"])} for d in detections
    ]
    return {"backend": object_service.backend(), "detections": enriched}
