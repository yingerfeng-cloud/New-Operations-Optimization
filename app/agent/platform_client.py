from __future__ import annotations

import os
from typing import Any

from fastapi import HTTPException

from app.agent.platform_gateway import (
    InProcessPlatformGateway,
    PlatformGateway,
    allow_in_process_platform_fallback,
    configured_platform_access_mode,
    create_platform_gateway,
    default_platform_base_url,
)


class OptimizationPlatformClient:
    def __init__(self, base_url: str | None = None, api_token: str | None = None, timeout_seconds: float | None = None) -> None:
        self._explicit_base_url = base_url is not None
        self.base_url = (base_url or default_platform_base_url()).rstrip("/")
        self.api_token = api_token if api_token is not None else os.getenv("OPTIMIZATION_PLATFORM_API_TOKEN", "")
        self.timeout_seconds = timeout_seconds if timeout_seconds is not None else float(os.getenv("OPTIMIZATION_PLATFORM_TIMEOUT_SECONDS", "60"))

    @property
    def platform_access_mode(self) -> str:
        return configured_platform_access_mode(explicit_base_url=self._explicit_base_url, base_url=self.base_url)

    @property
    def effective_base_url(self) -> str:
        return "internal" if self.platform_access_mode == "in_process" else self.base_url

    def list_skills(self) -> list[dict[str, Any]]:
        return self._call("list_skills")

    def health(self) -> dict[str, Any]:
        return self._call("health")

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        return self._call("get_skill", skill_name)

    def analyze_input(self, skill_name: str, partial_parameters: dict[str, Any]) -> dict[str, Any]:
        return self._call("analyze_input", skill_name, partial_parameters or {})

    def run_skill(self, skill_name: str, parameters: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._call("run_skill", skill_name, {"parameters": parameters or {}, "options": options or {"mode": "sync", "explain": True}})

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        return self._call("get_invocation", invocation_id)

    def list_invocations(self, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        records = self._call("list_invocations")
        filters = filters or {}
        skill = str(filters.get("skill") or "").strip()
        status = str(filters.get("status") or "").strip().upper()
        if skill:
            records = [item for item in records if item.get("skill_name") == skill]
        if status:
            records = [item for item in records if str(item.get("status") or "").upper() == status]
        return records

    def _call(self, method_name: str, *args: Any) -> Any:
        gateway = self._gateway()
        try:
            return getattr(gateway, method_name)(*args)
        except HTTPException as exc:
            if exc.status_code == 503 and allow_in_process_platform_fallback():
                return getattr(InProcessPlatformGateway(), method_name)(*args)
            raise

    def _gateway(self) -> PlatformGateway:
        return create_platform_gateway(
            base_url=self.base_url,
            api_token=self.api_token,
            timeout_seconds=self.timeout_seconds,
            explicit_base_url=self._explicit_base_url,
        )


platform_client = OptimizationPlatformClient()
