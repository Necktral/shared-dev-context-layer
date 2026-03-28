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
    return {
        "name": "WIS Context Sync MCP",
        "mode": "read-only-v1",
        "status": "ready",
    }
