from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    task_id: UUID | None = None
    proposer_consumer_id: UUID | None = None
    target_kind: str
    target_key: str
    proposed_payload: dict
    rationale: str
    status: str
    ratified_decision_id: UUID | None = None
    ratified_by: str | None = None
    ratified_at: datetime | None = None
    superseded_by: UUID | None = None
    idempotency_key: str | None = None
    created_at: datetime
    updated_at: datetime
