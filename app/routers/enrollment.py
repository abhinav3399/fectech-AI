"""Caregiver enrollment — register people (faces) and objects."""
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import get_settings
from app.services import embeddings, face_service, qdrant_service

router = APIRouter(prefix="/api", tags=["enrollment"])
settings = get_settings()


@router.post("/people")
async def enroll_person(
    image: UploadFile = File(...),
    name: str = Form(...),
    relationship: str = Form(""),
    notes: str = Form(""),
):
    data = await image.read()
    emb = face_service.embed_face(data)
    if emb is None:
        raise HTTPException(status_code=422, detail="No face detected in the photo.")
    # person_id groups all exemplars of one person (active-learning adds more over time).
    payload = {
        "person_id": str(uuid.uuid4()),
        "name": name,
        "relationship": relationship,
        "notes": notes,
        "exemplar": False,  # the primary enrollment photo
    }
    pid = qdrant_service.upsert(settings.people_collection, emb.tolist(), payload)
    return {"id": pid, **payload}


@router.post("/objects")
async def enroll_object(
    image: UploadFile = File(...),
    label: str = Form(...),
    location: str = Form(""),
    notes: str = Form(""),
):
    data = await image.read()
    # Objects are looked up by label at recognition time; the vector lets us store the image.
    emb = embeddings.hash_embedding(data, settings.embedding_dim)
    payload = {"label": label, "location": location, "notes": notes}
    pid = qdrant_service.upsert(settings.objects_collection, emb.tolist(), payload)
    return {"id": pid, **payload}


@router.get("/people")
async def list_people():
    pts = qdrant_service.scroll(settings.people_collection)
    return [{"id": str(p.id), **(p.payload or {})} for p in pts]


@router.get("/objects")
async def list_objects():
    pts = qdrant_service.scroll(settings.objects_collection)
    return [{"id": str(p.id), **(p.payload or {})} for p in pts]
