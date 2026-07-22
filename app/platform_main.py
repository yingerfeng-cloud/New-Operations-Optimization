from __future__ import annotations

from typing import Any
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import components, demo, formulas, function_assets, invocations, jobs, llm, models, optimize, reports, results, rolling, solvers, system_config, tasks, templates
from app.security import platform_token_middleware
from app.services.model_service import model_service
from app.frontend import mount_frontends
from app.utils import has_highspy, has_pyomo


def create_platform_app(*, enforce_token: bool = True) -> FastAPI:
    app = FastAPI(title="Optimization Platform", version="0.3.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    if enforce_token:
        app.middleware("http")(platform_token_middleware)

    @app.get("/health")
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": "optimization-platform",
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
                "model_create_validate_publish",
                "skill_registry",
                "skill_analyze_input",
                "skill_run",
                "invocation_log",
                "task_service",
                "pyomo_highs_solve",
                "runtime_parameter_validation",
                "component_based_builder",
                "component_registry",
                "cascade_hydro_dispatch",
                "structured_result_interpretation",
            ],
        }

    app.include_router(models.router)
    app.include_router(templates.router)
    app.include_router(components.router)
    app.include_router(function_assets.router)
    app.include_router(formulas.router)
    app.include_router(jobs.router)
    app.include_router(rolling.router)
    app.include_router(demo.router)
    app.include_router(reports.router)
    app.include_router(invocations.router)
    app.include_router(tasks.router)
    app.include_router(optimize.router)
    app.include_router(results.router)
    app.include_router(solvers.router)
    app.include_router(system_config.router)
    app.include_router(llm.router)
    Path("reports").mkdir(exist_ok=True)
    app.mount("/reports", StaticFiles(directory="reports"), name="reports")
    model_service.seed_default_templates()
    mount_frontends(app)
    return app


app = create_platform_app()
