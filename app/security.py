from __future__ import annotations

import os
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse


def platform_api_token() -> str:
    return os.getenv("OPTIMIZATION_PLATFORM_API_TOKEN", "").strip()


async def platform_token_middleware(request: Request, call_next: Callable):
    token = platform_api_token()
    if not token or request.url.path in {"/health", "/api/health", "/openapi.json", "/docs", "/redoc"}:
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    expected = f"Bearer {token}"
    if auth != expected:
        return JSONResponse(status_code=401, content={"detail": "Invalid or missing optimization platform API token"})
    return await call_next(request)
