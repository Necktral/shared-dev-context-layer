from fastapi import FastAPI

from app.api.router import build_api_router
from app.core.config import get_settings

_dev = get_settings().system_mode == "dev"
app = FastAPI(
    title="WIS Context Sync",
    # WP-0.5: superficie OpenAPI (/docs, /redoc, /openapi.json) solo en modo dev.
    docs_url="/docs" if _dev else None,
    redoc_url="/redoc" if _dev else None,
    openapi_url="/openapi.json" if _dev else None,
)
app.include_router(build_api_router())


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "wis-context-sync",
        "status": "ok",
        "message": "Backend running",
    }


@app.get("/mcp/info")
def mcp_info() -> dict[str, str]:
    # WP-0.5: no filtrar la postura de auth (era infoleak); los túneles usan docker inspect.
    return {
        "name": "WIS Context Sync MCP",
        "mode": "read-write-v2",
        "status": "ready",
    }
