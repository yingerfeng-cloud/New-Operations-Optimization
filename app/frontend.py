from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException


ROOT = Path(__file__).resolve().parent.parent
REMOVED_PROTOTYPE_ROUTE = "/" + "prototype" + ".html"


def mount_frontends(app: FastAPI) -> None:
    dist_dir = ROOT / "frontend" / "dist"

    @app.get("/legacy", include_in_schema=False)
    @app.get(REMOVED_PROTOTYPE_ROUTE, include_in_schema=False)
    def legacy_frontend_removed() -> None:
        raise HTTPException(status_code=404, detail="Legacy frontend has been removed")

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
