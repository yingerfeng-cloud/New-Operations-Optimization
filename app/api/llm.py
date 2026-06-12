from __future__ import annotations

from fastapi import APIRouter

from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.post("/test")
def test_llm() -> dict:
    return llm_service.test()


@router.get("/config")
def get_llm_config() -> dict:
    return llm_service.config()


@router.put("/config")
def update_llm_config(body: dict) -> dict:
    return llm_service.update_config(body)
