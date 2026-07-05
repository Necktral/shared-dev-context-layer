from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.schemas.decision import ApprovedDecisionOut
from app.schemas.event import EventCreate, EventOut
from app.schemas.policy import PolicyStateOut
from app.schemas.snapshot import ContextSnapshotOut, ManualSnapshotCreate
from app.schemas.task import TaskOut
from app.services.decision_service import list_active_decisions_for_task
from app.services.event_service import create_event_for_task, list_recent_events_for_task
from app.services.policy_service import get_active_policy
from app.services.snapshot_service import create_manual_snapshot
from app.services.task_service import require_active_task


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """WP-0.5: la API HTTP interna es un plano de escritura (POST /internal/events,
    /internal/snapshots/manual) que no tenía identidad. Exige un token dedicado,
    fail-closed: sin INTERNAL_API_TOKEN configurado se rechaza (no se abre por defecto)."""
    configured = get_settings().internal_api_token
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API interna no configurada (falta INTERNAL_API_TOKEN).",
        )
    if x_internal_token != configured:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Internal-Token ausente o inválido.",
        )


router = APIRouter(
    prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_token)]
)


@router.get("/tasks/active", response_model=TaskOut)
def read_active_task(db: Session = Depends(get_db)) -> TaskOut:
    try:
        return require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/decisions/active", response_model=list[ApprovedDecisionOut])
def read_active_decisions(db: Session = Depends(get_db)) -> list[ApprovedDecisionOut]:
    try:
        task = require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return list_active_decisions_for_task(db, task.id)


@router.get("/events/recent", response_model=list[EventOut])
def read_recent_events(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    try:
        task = require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return list_recent_events_for_task(db, task.id, limit=limit)


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def write_event(payload: EventCreate, db: Session = Depends(get_db)) -> EventOut:
    try:
        task = require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    event = create_event_for_task(db, task.id, payload)
    db.commit()
    return event


@router.get("/policy/active", response_model=PolicyStateOut)
def read_active_policy(db: Session = Depends(get_db)) -> PolicyStateOut:
    policy = get_active_policy(db)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No policy state configured.")
    return policy


@router.post("/snapshots/manual", response_model=ContextSnapshotOut, status_code=status.HTTP_201_CREATED)
def write_manual_snapshot(payload: ManualSnapshotCreate, db: Session = Depends(get_db)) -> ContextSnapshotOut:
    try:
        task = require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    policy = get_active_policy(db)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No policy state configured.")

    snapshot = create_manual_snapshot(db, task.id, payload, policy.mode)
    db.commit()
    return snapshot
