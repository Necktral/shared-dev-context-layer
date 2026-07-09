from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PolicyStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sync_enabled: bool
    mode: str
    scope: str
    redaction_level: str
    approval_mode: str | None = None
    updated_at: datetime
