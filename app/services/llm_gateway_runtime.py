from __future__ import annotations

import copy
import threading
import time
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LLMGatewayRuntime:
    """Process-local operational state for the real model protocol.

    Configuration answers whether a provider *could* be called.  This state
    answers whether the exact provider/model/protocol used by Agent turns has
    recently worked.  It intentionally contains no credentials or prompts.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._states: dict[str, dict[str, Any]] = {}

    @staticmethod
    def key(provider: str, model: str, protocol: str) -> str:
        return f"{provider}:{model}:{protocol}"

    def before_request(
        self,
        provider: str,
        model: str,
        protocol: str,
        *,
        failure_threshold: int,
        cooldown_seconds: float,
    ) -> dict[str, Any] | None:
        key = self.key(provider, model, protocol)
        now = time.monotonic()
        with self._lock:
            state = self._states.setdefault(key, self._new_state(provider, model, protocol))
            state["failure_threshold"] = failure_threshold
            state["cooldown_seconds"] = cooldown_seconds
            open_until = float(state.get("open_until_monotonic") or 0)
            if open_until > now:
                return {
                    "code": "LLM_CIRCUIT_OPEN",
                    "message": "Model gateway is cooling down after repeated failures",
                    "retryable": True,
                    "provider": provider,
                    "model": model,
                    "protocol": protocol,
                    "retry_after_seconds": max(1, int(open_until - now)),
                    "failure_kind": "circuit_open",
                }
            if state.get("operational_state") == "unavailable" and open_until:
                state["operational_state"] = "recovering"
                state["open_until_monotonic"] = 0.0
                state["updated_at"] = _now_iso()
            return None

    def record_success(
        self,
        provider: str,
        model: str,
        protocol: str,
        *,
        latency_ms: int,
        attempt_count: int,
        provider_request_id: str | None = None,
        capability_verified: bool = False,
    ) -> None:
        key = self.key(provider, model, protocol)
        with self._lock:
            state = self._states.setdefault(key, self._new_state(provider, model, protocol))
            state.update({
                "operational_state": "healthy",
                "consecutive_failures": 0,
                "last_success_at": _now_iso(),
                "last_latency_ms": latency_ms,
                "last_attempt_count": attempt_count,
                "last_provider_request_id": provider_request_id,
                "last_error": None,
                "open_until_monotonic": 0.0,
                "updated_at": _now_iso(),
            })
            if capability_verified:
                state["function_calling_verified_at"] = _now_iso()

    def record_failure(
        self,
        provider: str,
        model: str,
        protocol: str,
        error: dict[str, Any],
        *,
        failure_threshold: int,
        cooldown_seconds: float,
    ) -> None:
        key = self.key(provider, model, protocol)
        with self._lock:
            state = self._states.setdefault(key, self._new_state(provider, model, protocol))
            failures = int(state.get("consecutive_failures") or 0) + 1
            is_open = failures >= failure_threshold
            state.update({
                "operational_state": "unavailable" if is_open else "degraded",
                "consecutive_failures": failures,
                "last_failure_at": _now_iso(),
                "last_latency_ms": error.get("elapsed_ms"),
                "last_attempt_count": error.get("attempt_count"),
                "last_provider_request_id": error.get("provider_request_id"),
                "last_error": self._public_error(error),
                "failure_threshold": failure_threshold,
                "cooldown_seconds": cooldown_seconds,
                "open_until_monotonic": time.monotonic() + cooldown_seconds if is_open else 0.0,
                "updated_at": _now_iso(),
            })
            if error.get("code") == "LLM_FUNCTION_CALL_UNAVAILABLE":
                state["function_calling_verified_at"] = None

    def snapshot(self, provider: str, model: str, protocol: str) -> dict[str, Any]:
        key = self.key(provider, model, protocol)
        with self._lock:
            state = copy.deepcopy(self._states.get(key) or self._new_state(provider, model, protocol))
        open_until = float(state.pop("open_until_monotonic", 0) or 0)
        state["retry_after_seconds"] = max(0, int(open_until - time.monotonic())) if open_until else 0
        return state

    def invalidate(self, provider: str, model: str, protocol: str) -> None:
        """Discard observations after endpoint, credentials, or model configuration changes."""
        with self._lock:
            self._states.pop(self.key(provider, model, protocol), None)

    def reset(self) -> None:
        with self._lock:
            self._states.clear()

    @staticmethod
    def _new_state(provider: str, model: str, protocol: str) -> dict[str, Any]:
        return {
            "provider": provider,
            "model": model,
            "protocol": protocol,
            "operational_state": "unknown",
            "consecutive_failures": 0,
            "last_success_at": None,
            "last_failure_at": None,
            "last_latency_ms": None,
            "last_attempt_count": None,
            "last_provider_request_id": None,
            "function_calling_verified_at": None,
            "last_error": None,
            "open_until_monotonic": 0.0,
            "retry_after_seconds": 0,
            "updated_at": None,
        }

    @staticmethod
    def _public_error(error: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "code", "message", "retryable", "provider_status", "protocol",
            "failure_kind", "attempt_count", "elapsed_ms", "provider_request_id",
        }
        return {key: copy.deepcopy(value) for key, value in error.items() if key in allowed and value is not None}


llm_gateway_runtime = LLMGatewayRuntime()
