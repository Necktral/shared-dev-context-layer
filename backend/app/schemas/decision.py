from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ApprovedDecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID | None = None
    workspace_id: UUID
    project_id: UUID | None = None
    decision_key: str
    title: str
    category: str
    decision: str
    rationale: str
    constraints_json: dict
    approved_at: datetime
    approved_by: str
    superseded_by: UUID | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
