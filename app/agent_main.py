from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import agent, agent_skills, llm
from app.services.llm_service import llm_service


def create_agent_app() -> FastAPI:
    app = FastAPI(title="Optimization Agent", version="0.3.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "optimization-agent",
            "llm": llm_service.config(),
            "capabilities": [
                "natural_language_understanding",
                "skill_selection",
                "parameter_extraction",
                "missing_parameter_followup",
                "confirm_before_invoke",
                "skill_api_orchestration",
                "result_explanation_enhancement",
                "conversation_state",
            ],
        }

    app.include_router(agent.router)
    app.include_router(agent_skills.router)
    app.include_router(llm.router)
    return app


app = create_agent_app()
