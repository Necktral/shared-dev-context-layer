from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db.health import check_database_connection
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse | JSONResponse:
    settings = get_settings()
    is_db_up, _ = check_database_connection()

    payload = HealthResponse(
        status="ok" if is_db_up else "degraded",
        app="up",
        db="up" if is_db_up else "down",
        timestamp=datetime.now(timezone.utc).isoformat(),
        mode=settings.system_mode,
    )

    if is_db_up:
        return payload

    return JSONResponse(status_code=503, content=payload.model_dump())
