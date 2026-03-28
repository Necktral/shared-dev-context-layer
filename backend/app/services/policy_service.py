from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.policy_state import PolicyState


def get_active_policy(db: Session) -> PolicyState | None:
    statement = select(PolicyState).order_by(PolicyState.updated_at.desc())
    return db.execute(statement).scalars().first()
