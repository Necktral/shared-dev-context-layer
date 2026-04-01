from fastapi import FastAPI

from app.api.router import build_api_router

app = FastAPI(title="WIS Context Sync")
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
    from app.core.config import get_settings

    settings = get_settings()
    return {
        "name": "WIS Context Sync MCP",
        "mode": "read-write-v2",
        "status": "ready",
        "auth_enabled": "true" if settings.mcp_auth_enabled and not settings.mcp_auth_bypass_local else "false",
    }
