"""Carer accounts + cloud sync of the app state.

  POST /auth/register {email, password}  -> {token, user}
  POST /auth/login    {email, password}  -> {token, user}
  GET  /auth/me        (Bearer)          -> {user}
  GET  /state          (Bearer)          -> {data}            # the saved client store
  PUT  /state          (Bearer) {data}   -> {ok, updated_at}  # back it up

So profile/persona/memories/reminders/contacts survive a cache-clear and sync across devices.
"""
import time

from fastapi import APIRouter, Depends, HTTPException, Header, Body
from sqlmodel import Session, select

from app.db import get_session
from app.db_models import User, UserState
from app.core.security import hash_password, verify_password, make_token, verify_token
from app.core.config import settings

router = APIRouter()


def get_current_user(authorization: str = Header(None), session: Session = Depends(get_session)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    uid = verify_token(authorization[7:], settings.SECRET_KEY)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = session.get(User, uid)
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


def _issue(user: User) -> dict:
    token = make_token(user.id, settings.SECRET_KEY, settings.AUTH_TOKEN_TTL_HOURS)
    return {"token": token, "user": {"id": user.id, "email": user.email}}


@router.post("/auth/register")
def register(payload: dict = Body(...), session: Session = Depends(get_session)):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if "@" not in email or len(password) < 6:
        raise HTTPException(status_code=400, detail="A valid email and a password of 6+ characters are required.")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    salt, ph = hash_password(password)
    user = User(email=email, password_hash=ph, salt=salt)
    session.add(user)
    session.commit()
    session.refresh(user)
    return _issue(user)


@router.post("/auth/login")
def login(payload: dict = Body(...), session: Session = Depends(get_session)):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(password, user.salt, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return _issue(user)


@router.get("/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"user": {"id": user.id, "email": user.email}}


@router.get("/state")
def get_state(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    st = session.get(UserState, user.id)
    return {"data": (st.data if st else {}), "updated_at": (st.updated_at if st else None)}


@router.put("/state")
def put_state(payload: dict = Body(...), user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    data = payload.get("data")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="`data` must be an object.")
    st = session.get(UserState, user.id)
    now = time.time()
    if st:
        st.data = data
        st.updated_at = now
    else:
        st = UserState(user_id=user.id, data=data, updated_at=now)
    session.add(st)
    session.commit()
    return {"ok": True, "updated_at": now}
