from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    app: str
    db: str
    timestamp: str
    mode: str
