from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ManualSnapshotCreate(BaseModel):
    snapshot_type: str = "manual_test"
    snapshot_content: dict = Field(default_factory=dict)
    policy_applied: str | None = None


class ContextSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    workspace_id: UUID
    project_id: UUID
    consumer_id: UUID | None = None
    execution_session_id: UUID | None = None
    snapshot_type: str
    snapshot_content: dict
    policy_applied: str
    generated_from: str
    created_at: datetime
