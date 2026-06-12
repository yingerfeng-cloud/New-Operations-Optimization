from __future__ import annotations

from fastapi import APIRouter

from app.services.demo_service import DemoRunRequest, demo_service

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/run")
def run_demo(req: DemoRunRequest) -> dict:
    return demo_service.run(req)
