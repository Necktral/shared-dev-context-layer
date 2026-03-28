from fastapi import APIRouter

from app.api.health import router as health_router
from app.api.internal import router as internal_router
from app.api.public import router as public_router


def build_api_router() -> APIRouter:
    router = APIRouter()
    router.include_router(health_router)
    router.include_router(public_router)
    router.include_router(internal_router)
    return router
