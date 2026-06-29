"""Medication adherence — server-tracked outcomes on the SQLite DB.

  POST /adherence/log {reminder_id, title, type, status, kiosk_id?}  -> {status:"ok", id}
  GET  /adherence?days=7[&kiosk_id=]                                  -> {status:"ok", items, summary}

Optional auth: a valid Bearer token attributes rows to that user; otherwise they're keyed by a
stable kiosk_id (the profile name) so adherence works before the frontend login is wired.
"""
import time

from fastapi import APIRouter, Depends, Body, Header, Query
from sqlmodel import Session, select

from app.db import get_session
from app.db_models import AdherenceLog
from app.core.security import verify_token
from app.core.config import settings

router = APIRouter()
_VALID = {"taken", "snoozed", "skipped", "missed"}


def _owner(authorization: str, body_kiosk: str):
    """(user_id, kiosk_id) — prefer a signed-in user, else fall back to a kiosk id."""
    if authorization and authorization.startswith("Bearer "):
        uid = verify_token(authorization[7:], settings.SECRET_KEY)
        if uid:
            return uid, None
    return None, (body_kiosk or "kiosk")


@router.post("/adherence/log")
def log_adherence(payload: dict = Body(...), authorization: str = Header(None), session: Session = Depends(get_session)):
    status = (payload.get("status") or "").strip().lower()
    if status not in _VALID:
        return {"status": "error", "message": f"status must be one of {sorted(_VALID)}"}
    uid, kiosk = _owner(authorization, payload.get("kiosk_id"))
    row = AdherenceLog(
        user_id=uid, kiosk_id=kiosk,
        reminder_id=str(payload.get("reminder_id") or "")[:64],
        title=(payload.get("title") or "")[:200],
        type=(payload.get("type") or "medication")[:40],
        status=status, ts=time.time(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"status": "ok", "id": row.id}


@router.get("/adherence")
def get_adherence(days: int = Query(7), kiosk_id: str = Query(None),
                  authorization: str = Header(None), session: Session = Depends(get_session)):
    uid, kiosk = _owner(authorization, kiosk_id)
    since = time.time() - max(1, days) * 86400
    q = select(AdherenceLog).where(AdherenceLog.ts >= since)
    q = q.where(AdherenceLog.user_id == uid) if uid else q.where(AdherenceLog.kiosk_id == kiosk)
    rows = session.exec(q.order_by(AdherenceLog.ts.desc())).all()
    items = [{"id": r.id, "reminder_id": r.reminder_id, "title": r.title, "type": r.type, "status": r.status, "ts": r.ts} for r in rows]
    summary = {}
    for r in rows:
        s = summary.setdefault(r.reminder_id, {"taken": 0, "snoozed": 0, "skipped": 0, "missed": 0, "total": 0})
        if r.status in s:
            s[r.status] += 1
        s["total"] += 1
    return {"status": "ok", "items": items, "summary": summary}
