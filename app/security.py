from __future__ import annotations

import os
import secrets
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse


def platform_api_token() -> str:
    return os.getenv("OPTIMIZATION_PLATFORM_API_TOKEN", "").strip()


async def platform_token_middleware(request: Request, call_next: Callable):
    token = platform_api_token()
    path = request.url.path
    # The public UI shell lets a browser collect the token. All data APIs and
    # generated reports remain protected, across every supported entry point.
    if not token or request.method == "OPTIONS" or path in {"/health", "/api/health"} or not (path.startswith("/api/") or path.startswith("/reports")):
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    expected = f"Bearer {token}"
    if not secrets.compare_digest(auth, expected):
        return JSONResponse(status_code=401, content={"detail": "Invalid or missing optimization platform API token"})
    return await call_next(request)
