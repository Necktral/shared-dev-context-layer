from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.policy import PolicyStateOut
from app.schemas.task import TaskOut
from app.services.policy_service import get_active_policy
from app.services.task_service import require_active_task

router = APIRouter(tags=["public"])


@router.get("/active-task", response_model=TaskOut)
def read_active_task_alias(db: Session = Depends(get_db)) -> TaskOut:
    try:
        return require_active_task(db)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/policy", response_model=PolicyStateOut)
def read_policy_alias(db: Session = Depends(get_db)) -> PolicyStateOut:
    policy = get_active_policy(db)
    if not policy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No policy state configured.")
    return policy
