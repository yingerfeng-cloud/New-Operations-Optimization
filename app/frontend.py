from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parent.parent


def mount_frontends(app: FastAPI) -> None:
    legacy = ROOT / "prototype.html"
    static_dir = ROOT / "static"
    dist_dir = ROOT / "frontend" / "dist"

    @app.get("/legacy", include_in_schema=False)
    @app.get("/prototype.html", include_in_schema=False)
    def legacy_frontend() -> FileResponse:
        return FileResponse(legacy)

    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=static_dir), name="legacy-static")
    if dist_dir.joinpath("index.html").exists():
        assets = dist_dir / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="react-assets")

        @app.get("/", include_in_schema=False)
        @app.get("/{full_path:path}", include_in_schema=False)
        def react_frontend(full_path: str = "") -> FileResponse:
            if full_path.startswith(("api/", "reports/", "static/")):
                raise HTTPException(status_code=404, detail="Not found")
            return FileResponse(dist_dir / "index.html")
