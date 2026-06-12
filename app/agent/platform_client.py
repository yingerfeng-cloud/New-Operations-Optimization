from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException


class OptimizationPlatformClient:
    def __init__(self, base_url: str | None = None, api_token: str | None = None, timeout_seconds: float | None = None) -> None:
        self.base_url = (base_url or os.getenv("OPTIMIZATION_PLATFORM_BASE_URL") or "http://127.0.0.1:8090").rstrip("/")
        self.api_token = api_token if api_token is not None else os.getenv("OPTIMIZATION_PLATFORM_API_TOKEN", "")
        self.timeout_seconds = timeout_seconds if timeout_seconds is not None else float(os.getenv("OPTIMIZATION_PLATFORM_TIMEOUT_SECONDS", "60"))
        self.status_timeout_seconds = float(os.getenv("OPTIMIZATION_PLATFORM_STATUS_TIMEOUT_SECONDS", "3"))

    def list_skills(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/skills", timeout_seconds=self.status_timeout_seconds)

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/health", timeout_seconds=self.status_timeout_seconds)

    def get_skill(self, skill_name: str) -> dict[str, Any]:
        return self._request("GET", f"/api/skills/{skill_name}")

    def analyze_input(self, skill_name: str, partial_parameters: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"/api/skills/{skill_name}/analyze-input", json={"partial_parameters": partial_parameters or {}})

    def run_skill(self, skill_name: str, parameters: dict[str, Any], options: dict[str, Any] | None = None) -> dict[str, Any]:
        return self._request("POST", f"/api/skills/{skill_name}/run", json={"parameters": parameters or {}, "options": options or {"mode": "sync", "explain": True}})

    def get_invocation(self, invocation_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/invocations/{invocation_id}")

    def list_invocations(self, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        records = self._request("GET", "/api/invocations")
        filters = filters or {}
        skill = str(filters.get("skill") or "").strip()
        status = str(filters.get("status") or "").strip().upper()
        if skill:
            records = [item for item in records if item.get("skill_name") == skill]
        if status:
            records = [item for item in records if str(item.get("status") or "").upper() == status]
        return records

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    def _request(self, method: str, path: str, json: dict[str, Any] | None = None, timeout_seconds: float | None = None) -> Any:
        if self._prefer_in_process_for_tests():
            return self._request_in_process(method, path, json)
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=timeout_seconds or self.timeout_seconds) as client:
                response = client.request(method, url, headers=self._headers(), json=json)
            return self._handle_response(response)
        except httpx.RequestError:
            if not self._allow_in_process_fallback():
                raise HTTPException(status_code=503, detail="Optimization platform HTTP API is unavailable")
            return self._request_in_process(method, path, json)

    def _allow_in_process_fallback(self) -> bool:
        value = os.getenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK")
        if value is None:
            return os.getenv("PYTEST_CURRENT_TEST") is not None
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _prefer_in_process_for_tests(self) -> bool:
        value = os.getenv("AGENT_ALLOW_IN_PROCESS_PLATFORM_FALLBACK")
        return os.getenv("PYTEST_CURRENT_TEST") is not None and (value is None or value.strip().lower() in {"1", "true", "yes", "on"})

    def _request_in_process(self, method: str, path: str, json: dict[str, Any] | None = None) -> Any:
        from fastapi.testclient import TestClient

        from app.platform_main import create_platform_app

        app = create_platform_app(enforce_token=False)
        with TestClient(app) as client:
            response = client.request(method, path, headers=self._headers(), json=json)
        return self._handle_response(response)

    def _handle_response(self, response: Any) -> Any:
        if response.status_code >= 400:
            try:
                detail = response.json()
            except Exception:
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()


platform_client = OptimizationPlatformClient()
