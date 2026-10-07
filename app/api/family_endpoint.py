"""Family Safety & Update API endpoints.

  GET    /family/contacts              (Bearer) -> [FamilyContact]
  POST   /family/contacts              (Bearer) -> FamilyContact
  GET    /family/contacts/{id}         (Bearer) -> FamilyContact
  PUT    /family/contacts/{id}         (Bearer) -> FamilyContact
  DELETE /family/contacts/{id}         (Bearer) -> {ok}
  POST   /family/contacts/{id}/toggle  (Bearer) -> FamilyContact

  GET    /family/preferences           (Bearer) -> FamilyUpdatePreference
  PUT    /family/preferences           (Bearer) -> FamilyUpdatePreference
  POST   /family/preferences/enable    (Bearer) -> {ok}
  POST   /family/preferences/disable   (Bearer) -> {ok}
  POST   /family/preferences/consent   (Bearer) {consent: bool} -> {ok}

  GET    /family/history               (Bearer) -> [FamilyUpdateHistory]
  DELETE /family/history/{id}          (Bearer) -> {ok}
  DELETE /family/history/clear-all     (Bearer) -> {count}

  POST   /family/send-update-now       (Bearer) -> {ok, sent}
  POST   /family/sos                   (Bearer) {message, location?} -> {ok, emergency_id}
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from sqlmodel import Session

from app.db import get_session
from app.db_models import User, FamilyContact, FamilyUpdatePreference, FamilyUpdateHistory
from app.api.auth_endpoint import get_current_user
from app.services.family_update_service import FamilyUpdateService
from app.services.notification_service import get_notification_service

router = APIRouter()


# --- Request/Response Models ---

class CreateContactRequest(BaseModel):
    name: str
    relationship: str = ""
    phone: str | None = None
    email: str | None = None
    preferred_method: str = "email"
    is_emergency_contact: bool = False


class UpdateContactRequest(BaseModel):
    name: str | None = None
    relationship: str | None = None
    phone: str | None = None
    email: str | None = None
    preferred_method: str | None = None
    is_active: bool | None = None
    is_emergency_contact: bool | None = None


class UpdatePreferencesRequest(BaseModel):
    is_enabled: bool | None = None
    update_frequency: str | None = None
    include_status: bool | None = None
    include_timestamp: bool | None = None
    include_conversation_summary: bool | None = None
    include_location: bool | None = None


class ConsentRequest(BaseModel):
    consent: bool


class SendUpdateRequest(BaseModel):
    message: str | None = None


class SOSRequest(BaseModel):
    message: str
    location: dict | None = None  # {"lat": float, "lng": float}


# --- Family Contacts ---

@router.get("/family/contacts")
def list_contacts(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Get all family contacts for the user."""
    contacts = FamilyUpdateService.get_user_contacts(session, user.id)
    return [
        {
            "id": c.id,
            "name": c.name,
            "relationship": c.relationship,
            "phone": c.phone,
            "email": c.email,
            "preferred_method": c.preferred_method,
            "is_active": c.is_active,
            "is_emergency_contact": c.is_emergency_contact,
            "created_at": c.created_at,
            "updated_at": c.updated_at,
        }
        for c in contacts
    ]


@router.post("/family/contacts")
def create_contact(payload: CreateContactRequest, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Create a new family contact."""
    if not payload.name:
        raise HTTPException(status_code=400, detail="name is required")
    if not payload.email and not payload.phone:
        raise HTTPException(status_code=400, detail="email or phone is required")
    
    contact = FamilyUpdateService.create_contact(
        session=session,
        user_id=user.id,
        name=payload.name,
        relationship=payload.relationship,
        phone=payload.phone,
        email=payload.email,
        preferred_method=payload.preferred_method,
        is_emergency=payload.is_emergency_contact
    )
    
    return {
        "id": contact.id,
        "name": contact.name,
        "relationship": contact.relationship,
        "phone": contact.phone,
        "email": contact.email,
        "preferred_method": contact.preferred_method,
        "is_active": contact.is_active,
        "is_emergency_contact": contact.is_emergency_contact,
        "created_at": contact.created_at,
    }


@router.get("/family/contacts/{contact_id}")
def get_contact(contact_id: int, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)):
    """Get a specific contact."""
    contact = FamilyUpdateService.get_contact(session, user.id, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    return {
        "id": contact.id,
        "name": contact.name,
        "relationship": contact.relationship,
        "phone": contact.phone,
        "email": contact.email,
        "preferred_method": contact.preferred_method,
        "is_active": contact.is_active,
        "is_emergency_contact": contact.is_emergency_contact,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
    }


@router.put("/family/contacts/{contact_id}")
def update_contact(contact_id: int, payload: UpdateContactRequest,
                   user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Update a contact."""
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    
    contact = FamilyUpdateService.update_contact(session, user.id, contact_id, **updates)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    return {
        "id": contact.id,
        "name": contact.name,
        "relationship": contact.relationship,
        "phone": contact.phone,
        "email": contact.email,
        "preferred_method": contact.preferred_method,
        "is_active": contact.is_active,
        "is_emergency_contact": contact.is_emergency_contact,
        "updated_at": contact.updated_at,
    }


@router.delete("/family/contacts/{contact_id}")
def delete_contact(contact_id: int, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Delete a contact."""
    if not FamilyUpdateService.delete_contact(session, user.id, contact_id):
        raise HTTPException(status_code=404, detail="Contact not found")
    
    return {"ok": True}


@router.post("/family/contacts/{contact_id}/toggle")
def toggle_contact(contact_id: int, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Toggle contact active/inactive."""
    contact = FamilyUpdateService.toggle_contact(session, user.id, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    return {
        "id": contact.id,
        "is_active": contact.is_active,
    }


# --- Preferences ---

@router.get("/family/preferences")
def get_preferences(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Get family update preferences."""
    prefs = FamilyUpdateService.get_or_create_preferences(session, user.id)
    
    return {
        "id": prefs.id,
        "is_enabled": prefs.is_enabled,
        "has_given_consent": prefs.has_given_consent,
        "update_frequency": prefs.update_frequency,
        "include_status": prefs.include_status,
        "include_timestamp": prefs.include_timestamp,
        "include_conversation_summary": prefs.include_conversation_summary,
        "include_location": prefs.include_location,
        "next_scheduled_update": prefs.next_scheduled_update,
        "last_update_sent": prefs.last_update_sent,
        "created_at": prefs.created_at,
    }


@router.put("/family/preferences")
def update_preferences(payload: UpdatePreferencesRequest,
                       user: User = Depends(get_current_user),
                       session: Session = Depends(get_session)):
    """Update family update preferences."""
    updates = {k: v for k, v in payload.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    
    prefs = FamilyUpdateService.update_preferences(session, user.id, **updates)
    
    return {
        "id": prefs.id,
        "is_enabled": prefs.is_enabled,
        "has_given_consent": prefs.has_given_consent,
        "update_frequency": prefs.update_frequency,
        "include_status": prefs.include_status,
        "include_timestamp": prefs.include_timestamp,
        "include_conversation_summary": prefs.include_conversation_summary,
        "include_location": prefs.include_location,
        "updated_at": prefs.updated_at,
    }


@router.post("/family/preferences/enable")
def enable_family_updates(user: User = Depends(get_current_user),
                          session: Session = Depends(get_session)):
    """Enable family updates."""
    prefs = FamilyUpdateService.update_preferences(session, user.id, is_enabled=True)
    return {"ok": True, "is_enabled": prefs.is_enabled}


@router.post("/family/preferences/disable")
def disable_family_updates(user: User = Depends(get_current_user),
                           session: Session = Depends(get_session)):
    """Disable family updates."""
    prefs = FamilyUpdateService.update_preferences(session, user.id, is_enabled=False)
    return {"ok": True, "is_enabled": prefs.is_enabled}


@router.post("/family/preferences/consent")
def set_consent(payload: ConsentRequest, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)):
    """Set user consent for family updates."""
    prefs = FamilyUpdateService.update_preferences(session, user.id, has_given_consent=payload.consent)
    return {"ok": True, "has_given_consent": prefs.has_given_consent}


# --- History ---

@router.get("/family/history")
def get_history(limit: int = 50, user: User = Depends(get_current_user),
                session: Session = Depends(get_session)):
    """Get update history."""
    history = FamilyUpdateService.get_user_history(session, user.id, limit=limit)
    
    return [
        {
            "id": h.id,
            "contact_id": h.contact_id,
            "update_type": h.update_type,
            "message_content": h.message_content[:100] + "..." if len(h.message_content) > 100 else h.message_content,
            "delivery_status": h.delivery_status,
            "sent_at": h.sent_at,
            "delivered_at": h.delivered_at,
            "error_message": h.error_message,
            "created_at": h.created_at,
        }
        for h in history
    ]


@router.delete("/family/history/{history_id}")
def delete_history_entry(history_id: int, user: User = Depends(get_current_user),
                         session: Session = Depends(get_session)):
    """Delete a history entry."""
    if not FamilyUpdateService.delete_history_entry(session, user.id, history_id):
        raise HTTPException(status_code=404, detail="History entry not found")
    
    return {"ok": True}


@router.delete("/family/history/clear-all")
def clear_history(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Clear all history for the user."""
    count = FamilyUpdateService.clear_user_history(session, user.id)
    return {"ok": True, "cleared_count": count}


# --- Manual Actions ---

@router.post("/family/send-update-now")
def send_update_now(payload: SendUpdateRequest | None = None,
                    user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)):
    """Manually send an update to all active contacts."""
    prefs = FamilyUpdateService.get_or_create_preferences(session, user.id)
    
    if not prefs.has_given_consent:
        raise HTTPException(status_code=403, detail="User must give consent first")
    
    contacts = FamilyUpdateService.get_active_contacts(session, user.id)
    if not contacts:
        raise HTTPException(status_code=400, detail="No active family contacts configured")
    
    # Generate message
    message = payload.message if payload and payload.message else FamilyUpdateService.generate_status_report(session, user.id, user)
    
    # Send to each contact
    notification_service = get_notification_service(dev_mode=True)  # DEV MODE
    sent_count = 0
    
    for contact in contacts:
        recipient = contact.email if contact.preferred_method == "email" else contact.phone
        if not recipient:
            continue
        
        # Log the attempt
        history = FamilyUpdateService.log_update(
            session, user.id, contact.id,
            update_type="manual",
            message=message,
            status="pending"
        )
        
        # Send notification
        result = notification_service.send_notification(
            contact.preferred_method,
            recipient,
            "Factech AI Family Update",
            message
        )
        
        if result["success"]:
            FamilyUpdateService.mark_delivered(session, history.id)
            sent_count += 1
        else:
            FamilyUpdateService.mark_failed(session, history.id, result.get("error", "Unknown error"))
    
    return {"ok": True, "sent_count": sent_count, "total_contacts": len(contacts)}


@router.post("/family/sos")
def send_sos(payload: SOSRequest, user: User = Depends(get_current_user),
             session: Session = Depends(get_session)):
    """Send emergency SOS notification to all emergency contacts."""
    contacts = FamilyUpdateService.get_user_contacts(session, user.id)
    emergency_contacts = [c for c in contacts if c.is_emergency_contact and c.is_active]
    
    if not emergency_contacts:
        raise HTTPException(status_code=400, detail="No emergency contacts configured")
    
    # Build SOS message
    location_str = ""
    if payload.location:
        location_str = f"\nLocation: {payload.location.get('lat', 'N/A')}, {payload.location.get('lng', 'N/A')}"
    
    sos_message = f"""EMERGENCY - SOS ALERT
User: {user.email}
Message: {payload.message}
{location_str}

This is an urgent SOS notification. Please check on the account holder immediately.
"""
    
    # Send to emergency contacts
    notification_service = get_notification_service(dev_mode=True)  # DEV MODE
    sent_count = 0
    sos_id = f"sos_{user.id}_{int(__import__('time').time())}"
    
    for contact in emergency_contacts:
        recipient = contact.email if contact.preferred_method == "email" else contact.phone
        if not recipient:
            continue
        
        history = FamilyUpdateService.log_update(
            session, user.id, contact.id,
            update_type="sos",
            message=sos_message,
            status="pending"
        )
        
        result = notification_service.send_notification(
            contact.preferred_method,
            recipient,
            "🚨 EMERGENCY: Factech AI SOS Alert 🚨",
            sos_message
        )
        
        if result["success"]:
            FamilyUpdateService.mark_delivered(session, history.id)
            sent_count += 1
        else:
            FamilyUpdateService.mark_failed(session, history.id, result.get("error", "Unknown error"))
    
    return {
        "ok": True,
        "emergency_id": sos_id,
        "sent_count": sent_count,
        "total_emergency_contacts": len(emergency_contacts)
    }
