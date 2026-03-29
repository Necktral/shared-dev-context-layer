from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    goal: str
    status: str
    priority: str
    branch: str | None = None
    repo: str | None = None
    next_action: str | None = None
    current_phase: str | None = None
    workspace_id: UUID
    project_id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime
