from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EventCreate(BaseModel):
    event_type: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    source: str = "internal_api"
    severity: str = "info"
    metadata_json: dict = Field(default_factory=dict)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    workspace_id: UUID
    project_id: UUID
    consumer_id: UUID | None = None
    execution_session_id: UUID | None = None
    event_type: str
    summary: str
    source: str
    severity: str
    metadata_json: dict
    payload_json: dict
    event_ts: datetime
    created_at: datetime
