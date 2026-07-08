from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException


def service_mode() -> str:
    value = os.getenv("SERVICE_MODE", "combined").strip().lower()
    return value if value in {"combined", "platform", "agent"} else "combined"


def default_platform_base_url() -> str:
    return (os.getenv("OPTIMIZATION_PLATFORM_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")


def configured_platform_access_mode(*, explicit_base_url: bool = False, base_url: str | None = None) -> str:
    configured = os.getenv("AGENT_PLATFORM_ACCESS_MODE")
    if configured:
        value = configured.strip().lower()
        if value in {"in_process", "http"}:
            return value
    if service_mode() == "agent" or explicit_base_url:
        return "http"
    if base_url and base_url.rstrip("/").endswith(":1") and not allow_in_process_platform_fallback():
        return "http"
    return "in_process" if service_mode() == "combined" else "http"


def allow_in_process_platform_fallback() -> bool:
    value = os.getenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK")
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


class PlatformGateway:
    base_url = "internal"
    access_mode = "in_process"

    def health(self) -> dict[str, Any]:
        raise NotImplementedError

    def list_skills(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        raise NotImplementedError

    def analyze_input(self, skill_name: str, partial_parameters: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def run_skill(self, skill_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        raise NotImplementedError

    def list_invocations(self) -> list[dict[str, Any]]:
        raise NotImplementedError


class InProcessPlatformGateway(PlatformGateway):
    base_url = "internal"
    access_mode = "in_process"

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "service": "optimization-platform",
            "access_mode": self.access_mode,
            "base_url": self.base_url,
        }

    def list_skills(self) -> list[dict[str, Any]]:
        from app.services.skill_registry import skill_registry

        return skill_registry.list_skills()

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        from app.services.skill_registry import skill_registry

        return skill_registry.get_skill(skill_name)

    def analyze_input(self, skill_name: str, partial_parameters: dict[str, Any]) -> dict[str, Any]:
        from app.services.skill_registry import skill_registry

        return skill_registry.analyze_input(skill_name, {"partial_parameters": partial_parameters or {}})

    def run_skill(self, skill_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        from app.services.skill_registry import skill_registry

        return skill_registry.run_skill(skill_name, payload or {})

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        from app.services.invocation_service import invocation_service

        return invocation_service.get_invocation(invocation_id)

    def list_invocations(self) -> list[dict[str, Any]]:
        from app.services.invocation_service import invocation_service

        return invocation_service.list_invocations()


class HttpPlatformGateway(PlatformGateway):
    access_mode = "http"

    def __init__(self, base_url: str | None = None, api_token: str | None = None, timeout_seconds: float | None = None) -> None:
        self.base_url = (base_url or default_platform_base_url()).rstrip("/")
        self.api_token = api_token if api_token is not None else os.getenv("OPTIMIZATION_PLATFORM_API_TOKEN", "")
        self.timeout_seconds = timeout_seconds if timeout_seconds is not None else float(os.getenv("OPTIMIZATION_PLATFORM_TIMEOUT_SECONDS", "60"))
        self.status_timeout_seconds = float(os.getenv("OPTIMIZATION_PLATFORM_STATUS_TIMEOUT_SECONDS", "3"))

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health", timeout_seconds=self.status_timeout_seconds)

    def list_skills(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/skills", timeout_seconds=self.status_timeout_seconds)

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        return self._request("GET", f"/api/skills/{skill_name}")

    def analyze_input(self, skill_name: str, partial_parameters: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/skills/{skill_name}/analyze-input", json={"partial_parameters": partial_parameters or {}})

    def run_skill(self, skill_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/skills/{skill_name}/run", json=payload or {})

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/invocations/{invocation_id}")

    def list_invocations(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/invocations")

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None, timeout_seconds: float | None = None) -> Any:
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=timeout_seconds or self.timeout_seconds) as client:
                response = client.request(method, url, headers=self._headers(), json=json)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail="Optimization platform HTTP API is unavailable") from exc
        if response.status_code >= 400:
            try:
                detail = response.json()
            except Exception:
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()


def create_platform_gateway(
    *,
    base_url: str | None = None,
    api_token: str | None = None,
    timeout_seconds: float | None = None,
    explicit_base_url: bool = False,
) -> PlatformGateway:
    mode = configured_platform_access_mode(explicit_base_url=explicit_base_url, base_url=base_url)
    if mode == "in_process":
        return InProcessPlatformGateway()
    return HttpPlatformGateway(base_url=base_url, api_token=api_token, timeout_seconds=timeout_seconds)
