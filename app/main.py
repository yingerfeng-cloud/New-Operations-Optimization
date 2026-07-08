from __future__ import annotations

from typing import Any
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import components, demo, function_assets, invocations, jobs, llm, models, optimize, pv_storage, reports, results, rolling, solvers, system_config, tasks, templates
from app.agent.platform_gateway import service_mode
from app.services.model_service import model_service
from app.frontend import mount_frontends
from app.utils import has_highspy, has_pyomo


def create_app() -> FastAPI:
    app = FastAPI(title="Power Semantic OR Platform", version="0.2.0")
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
            "service": "Power Semantic OR Platform",
            "architecture": ["business_semantics", "model_template", "pyomo_builder", "highs_solver", "business_result"],
            "solver": "HiGHS",
            "dev_ports": {"fastapi": 8000, "vite": 5173},
            "api_versions": {
                "function_assets": {
                    "base_path": "/api/function-assets",
                    "supports": ["POST create", "POST import-csv", "piecewise_1d", "piecewise_2d"],
                }
            },
            "pyomo_installed": has_pyomo(),
            "highspy_installed": has_highspy(),
            "capabilities": [
                "standard_semantic_schema",
                "power_model_template_library",
                "runtime_parameter_validation",
                "pyomo_model_builder",
                "component_based_builder",
                "component_registry",
                "cascade_hydro_dispatch",
                "async_solve_jobs",
                "rolling_optimization",
                "job_trace_metrics",
                "infeasible_diagnosis",
                "business_result_formatter",
                "agent_optimize_api",
                "forecast_mock_service",
                "closed_loop_demo_api",
                "report_export",
            ],
            "task_status": [
                "PENDING",
                "VALIDATING",
                "BUILDING_MODEL",
                "SOLVING",
                "FORMATTING_RESULT",
                "SUCCESS",
                "FAILED",
                "INFEASIBLE",
                "TIMEOUT",
                "CANCELLED",
            ],
        }

    mode = service_mode()
    if mode in {"combined", "platform"}:
        app.include_router(models.router)
        app.include_router(templates.router)
        app.include_router(components.router)
        app.include_router(function_assets.router)
        app.include_router(jobs.router)
        app.include_router(rolling.router)
        app.include_router(pv_storage.router)
    if mode in {"combined", "agent"}:
        try:
            from app.api import agent, agent_skills

            app.include_router(agent.router)
            app.include_router(agent_skills.router)
        except SyntaxError:
            pass
    app.include_router(llm.router)
    if mode in {"combined", "platform"}:
        app.include_router(demo.router)
        app.include_router(reports.router)
        app.include_router(invocations.router)
        app.include_router(tasks.router)
        app.include_router(optimize.router)
        app.include_router(results.router)
        app.include_router(solvers.router)
        app.include_router(system_config.router)
    Path("reports").mkdir(exist_ok=True)
    app.mount("/reports", StaticFiles(directory="reports"), name="reports")
    if mode in {"combined", "platform"}:
        model_service.seed_default_templates()
    mount_frontends(app)
    return app


app = create_app()
