from __future__ import annotations

import json
import os
import base64
import hashlib
import getpass
import logging
import socket
import threading
import time
import random
import secrets
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from app.storage.memory_store import STORE
from app.services.llm_gateway_runtime import llm_gateway_runtime


SUPPORTED_PROVIDERS = {"volcengine_ark", "openai_compatible", "disabled"}
logger = logging.getLogger(__name__)


class BaseLLMAdapter:
    def __init__(self, config: dict[str, Any], api_key: str) -> None:
        self.config = config
        self.api_key = api_key

    def chat_json(self, messages: list[dict[str, str]], parser: Any) -> dict[str, Any]:
        raise NotImplementedError

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        required_tool_name: str | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError


class OpenAICompatibleAdapter(BaseLLMAdapter):
    missing_detail = "API Key and Model are required when LLM_ENABLED=true"

    _client_lock = threading.RLock()
    _clients: dict[tuple[str, float, bool], httpx.Client] = {}

    @classmethod
    def reset_clients(cls) -> None:
        """Close pooled clients after configuration changes and in tests."""
        with cls._client_lock:
            clients = list(cls._clients.values())
            cls._clients.clear()
        for client in clients:
            try:
                client.close()
            except Exception:
                continue

    def _client(self) -> httpx.Client:
        base_url = str(self.config.get("base_url") or "")
        timeout = float(self.config["timeout_seconds"])
        http2 = bool(self.config.get("http2", False))
        key = (base_url, timeout, http2)
        with self._client_lock:
            client = self._clients.get(key)
            if client is None:
                client = httpx.Client(
                    timeout=httpx.Timeout(timeout, connect=min(timeout, 10.0)),
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30.0),
                    http2=http2,
                )
                self._clients[key] = client
            return client

    def _post(self, url: str, body: dict[str, Any], *, protocol: str) -> httpx.Response:
        provider = str(self.config.get("provider") or "unknown")
        model = str(self.config.get("model") or "")
        max_attempts = max(1, int(self.config.get("transport_max_attempts") or 3))
        failure_threshold = max(1, int(self.config.get("circuit_failure_threshold") or 3))
        cooldown_seconds = max(1.0, float(self.config.get("circuit_cooldown_seconds") or 30))
        circuit_error = llm_gateway_runtime.before_request(
            provider,
            model,
            protocol,
            failure_threshold=failure_threshold,
            cooldown_seconds=cooldown_seconds,
        )
        if circuit_error:
            raise HTTPException(status_code=503, detail=circuit_error)
        started = time.perf_counter()
        last_exception: Exception | None = None
        for attempt_index in range(max_attempts):
            try:
                response = self._client().post(
                    url,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json=body,
                )
                response.extensions["optiforge_attempt_count"] = attempt_index + 1
                response.extensions["optiforge_elapsed_ms"] = int((time.perf_counter() - started) * 1000)
                return response
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as exc:
                last_exception = exc
                if attempt_index + 1 >= max_attempts:
                    break
                logger.warning(
                    "LLM transport interrupted; retrying provider=%s model=%s protocol=%s attempt=%s/%s error=%s",
                    provider,
                    model,
                    protocol,
                    attempt_index + 1,
                    max_attempts,
                    type(exc).__name__,
                )
                delay = min(2.0, 0.25 * (2**attempt_index))
                time.sleep(delay + random.uniform(0, delay * 0.2))
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        detail = {
            "code": "LLM_TRANSPORT_ERROR",
            "message": "LLM connection interrupted",
            "retryable": True,
            "provider": provider,
            "model": model,
            "protocol": protocol,
            "failure_kind": type(last_exception).__name__ if last_exception else "transport_error",
            "attempt_count": max_attempts,
            "elapsed_ms": elapsed_ms,
        }
        llm_gateway_runtime.record_failure(
            provider,
            model,
            protocol,
            detail,
            failure_threshold=failure_threshold,
            cooldown_seconds=cooldown_seconds,
        )
        raise HTTPException(status_code=502, detail=detail) from last_exception

    @staticmethod
    def _provider_request_id(response: httpx.Response) -> str | None:
        for name in ("x-request-id", "x-tt-logid", "request-id"):
            value = response.headers.get(name)
            if value:
                return value
        return None

    def _record_protocol_success(
        self,
        response: httpx.Response,
        protocol: str,
        *,
        capability_verified: bool = False,
    ) -> None:
        llm_gateway_runtime.record_success(
            str(self.config.get("provider") or "unknown"),
            str(self.config.get("model") or ""),
            protocol,
            latency_ms=int(response.extensions.get("optiforge_elapsed_ms") or 0),
            attempt_count=int(response.extensions.get("optiforge_attempt_count") or 1),
            provider_request_id=self._provider_request_id(response),
            capability_verified=capability_verified,
        )

    def _record_protocol_failure(
        self,
        protocol: str,
        *,
        code: str,
        message: str,
        retryable: bool,
        failure_kind: str,
        response: httpx.Response | None = None,
    ) -> None:
        detail = {
            "code": code,
            "message": message,
            "retryable": retryable,
            "provider": self.config.get("provider"),
            "model": self.config.get("model"),
            "protocol": protocol,
            "failure_kind": failure_kind,
            "provider_status": response.status_code if response is not None else None,
            "provider_request_id": self._provider_request_id(response) if response is not None else None,
            "attempt_count": int(response.extensions.get("optiforge_attempt_count") or 1) if response is not None else 1,
            "elapsed_ms": int(response.extensions.get("optiforge_elapsed_ms") or 0) if response is not None else None,
        }
        llm_gateway_runtime.record_failure(
            str(self.config.get("provider") or "unknown"),
            str(self.config.get("model") or ""),
            protocol,
            detail,
            failure_threshold=max(1, int(self.config.get("circuit_failure_threshold") or 3)),
            cooldown_seconds=max(1.0, float(self.config.get("circuit_cooldown_seconds") or 30)),
        )

    def _provider_http_error(self, exc: httpx.HTTPStatusError, protocol: str) -> HTTPException:
        response = exc.response
        try:
            provider_detail: Any = response.json()
        except Exception:
            provider_detail = (response.text or "")[:2_000]
        # Provider diagnostics are useful for capability/configuration errors,
        # but cap their size and never include request headers or credentials.
        serialized = json.dumps(provider_detail, ensure_ascii=False, default=str)
        if len(serialized) > 4_000:
            provider_detail = {"truncated": True, "preview": serialized[:4_000]}
        return HTTPException(
            status_code=502,
            detail={
                "code": "LLM_PROVIDER_REJECTED",
                "message": "模型服务拒绝了请求，请检查模型能力与协议配置。",
                "provider": self.config.get("provider"),
                "model": self.config.get("model"),
                "provider_status": response.status_code,
                "protocol": protocol,
                "retryable": response.status_code == 429 or response.status_code >= 500,
                "failure_kind": "provider_http_error",
                "attempt_count": int(response.extensions.get("optiforge_attempt_count") or 1),
                "elapsed_ms": int(response.extensions.get("optiforge_elapsed_ms") or 0),
                "provider_request_id": self._provider_request_id(response),
                "provider_error": provider_detail,
            },
        )

    def chat_json(self, messages: list[dict[str, str]], parser: Any) -> dict[str, Any]:
        model = self.config["model"]
        if not self.api_key or not model:
            raise HTTPException(status_code=422, detail=self.missing_detail)
        url = f"{self.config['base_url']}/chat/completions"
        body = {
            "model": model,
            "messages": messages,
            "temperature": self.config["temperature"],
            "max_tokens": self.config["max_tokens"],
            "response_format": {"type": "json_object"},
        }
        try:
            response = self._post(url, body, protocol="chat_completions")
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = parser(content)
            self._record_protocol_success(response, "chat_completions")
            return parsed
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            self._record_protocol_failure(
                "chat_completions",
                code="LLM_PROVIDER_REJECTED",
                message="Provider rejected request",
                retryable=exc.response.status_code == 429 or exc.response.status_code >= 500,
                failure_kind="provider_http_error",
                response=exc.response,
            )
            raise self._provider_http_error(exc, "chat_completions") from exc
        except httpx.TimeoutException as exc:
            logger.warning(
                "LLM request timed out provider=%s model=%s timeout_seconds=%s",
                self.config.get("provider"),
                model,
                self.config.get("timeout_seconds"),
            )
            self._record_protocol_failure(
                "chat_completions",
                code="LLM_TIMEOUT",
                message="LLM response timed out",
                retryable=True,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(
                status_code=504,
                detail={
                    "code": "LLM_TIMEOUT",
                    "message": "LLM response timed out",
                    "retryable": True,
                    "provider": self.config.get("provider"),
                    "model": model,
                    "protocol": "chat_completions",
                    "failure_kind": type(exc).__name__,
                },
            ) from exc
        except Exception as exc:
            self._record_protocol_failure(
                "chat_completions",
                code="LLM_RESPONSE_INVALID",
                message="Provider returned an invalid response",
                retryable=False,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(status_code=502, detail={"message": "LLM request failed", "error": str(exc)}) from exc

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        required_tool_name: str | None = None,
    ) -> dict[str, Any]:
        model = self.config["model"]
        if not self.api_key or not model:
            raise HTTPException(status_code=422, detail=self.missing_detail)
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": self.config["temperature"],
            "max_tokens": self.config["max_tokens"],
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = (
                {"type": "function", "function": {"name": required_tool_name}}
                if required_tool_name
                else "auto"
            )
            body["parallel_tool_calls"] = False
        try:
            response = self._post(f"{self.config['base_url']}/chat/completions", body, protocol="chat_completions_tools")
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            result = {
                "response_id": data.get("id"),
                "content": message.get("content") or "",
                "tool_calls": message.get("tool_calls") or [],
            }
            self._record_protocol_success(
                response,
                "chat_completions_tools",
                capability_verified=bool(result["tool_calls"]),
            )
            return result
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            self._record_protocol_failure(
                "chat_completions_tools",
                code="LLM_PROVIDER_REJECTED",
                message="Provider rejected tool request",
                retryable=exc.response.status_code == 429 or exc.response.status_code >= 500,
                failure_kind="provider_http_error",
                response=exc.response,
            )
            raise self._provider_http_error(exc, "chat_completions_tools") from exc
        except httpx.TimeoutException as exc:
            logger.warning(
                "LLM tool request timed out provider=%s model=%s timeout_seconds=%s",
                self.config.get("provider"),
                model,
                self.config.get("timeout_seconds"),
            )
            self._record_protocol_failure(
                "chat_completions_tools",
                code="LLM_TIMEOUT",
                message="LLM response timed out",
                retryable=True,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(
                status_code=504,
                detail={
                    "code": "LLM_TIMEOUT",
                    "message": "LLM response timed out",
                    "retryable": True,
                    "provider": self.config.get("provider"),
                    "model": model,
                    "protocol": "chat_completions_tools",
                    "failure_kind": type(exc).__name__,
                },
            ) from exc
        except Exception as exc:
            self._record_protocol_failure(
                "chat_completions_tools",
                code="LLM_RESPONSE_INVALID",
                message="Provider returned an invalid tool response",
                retryable=False,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(status_code=502, detail={"message": "LLM tool request failed", "error": str(exc)}) from exc


class VolcengineArkAdapter(OpenAICompatibleAdapter):
    missing_detail = "API Key and Model / Endpoint ID are required when LLM_ENABLED=true"

    @staticmethod
    def _responses_input(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
        instructions: list[str] = []
        input_items: list[dict[str, Any]] = []
        for message in messages:
            role = str(message.get("role") or "")
            content = str(message.get("content") or "")
            if role == "system":
                if content:
                    instructions.append(content)
                continue
            if role == "tool":
                input_items.append(
                    {
                        "type": "function_call_output",
                        "call_id": str(message.get("tool_call_id") or ""),
                        "output": content,
                    }
                )
                continue
            if role == "assistant" and message.get("tool_calls"):
                if content:
                    input_items.append({"type": "message", "role": "assistant", "content": content})
                for call in message.get("tool_calls") or []:
                    function = call.get("function") or {}
                    input_items.append(
                        {
                            "type": "function_call",
                            "call_id": str(call.get("id") or ""),
                            "name": str(function.get("name") or ""),
                            "arguments": str(function.get("arguments") or "{}"),
                        }
                    )
                continue
            if role in {"user", "assistant"}:
                input_items.append({"type": "message", "role": role, "content": content})
        return "\n\n".join(instructions), input_items

    @staticmethod
    def _responses_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for item in tools:
            function = item.get("function") or {}
            result.append(
                {
                    "type": "function",
                    "name": function.get("name"),
                    "description": function.get("description"),
                    "parameters": function.get("parameters") or {"type": "object", "properties": {}},
                }
            )
        return result

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        required_tool_name: str | None = None,
    ) -> dict[str, Any]:
        model = self.config["model"]
        if not self.api_key or not model:
            raise HTTPException(status_code=422, detail=self.missing_detail)
        instructions, input_items = self._responses_input(messages)
        body: dict[str, Any] = {
            "model": model,
            "input": input_items,
            "instructions": instructions,
            "temperature": self.config["temperature"],
            "max_output_tokens": self.config["max_tokens"],
            "store": False,
        }
        response_tools = self._responses_tools(tools)
        if response_tools:
            body["tools"] = response_tools
            body["tool_choice"] = (
                {"type": "function", "name": required_tool_name}
                if required_tool_name
                else "auto"
            )
        try:
            response = self._post(f"{self.config['base_url']}/responses", body, protocol="responses_tools")
            response.raise_for_status()
            data = response.json()
            content_parts: list[str] = []
            tool_calls: list[dict[str, Any]] = []
            for item in data.get("output") or []:
                if item.get("type") == "function_call":
                    tool_calls.append(
                        {
                            "id": item.get("call_id"),
                            "type": "function",
                            "function": {
                                "name": item.get("name"),
                                "arguments": item.get("arguments") or "{}",
                            },
                        }
                    )
                elif item.get("type") == "message":
                    for part in item.get("content") or []:
                        if part.get("type") in {"output_text", "text"} and part.get("text"):
                            content_parts.append(str(part["text"]))
            result = {
                "response_id": data.get("id"),
                "content": "\n".join(content_parts),
                "tool_calls": tool_calls,
            }
            self._record_protocol_success(
                response,
                "responses_tools",
                capability_verified=bool(result["tool_calls"]),
            )
            return result
        except HTTPException:
            raise
        except httpx.HTTPStatusError as exc:
            self._record_protocol_failure(
                "responses_tools",
                code="LLM_PROVIDER_REJECTED",
                message="Provider rejected Responses tool request",
                retryable=exc.response.status_code == 429 or exc.response.status_code >= 500,
                failure_kind="provider_http_error",
                response=exc.response,
            )
            raise self._provider_http_error(exc, "responses_tools") from exc
        except httpx.TimeoutException as exc:
            logger.warning(
                "LLM Responses tool request timed out provider=%s model=%s timeout_seconds=%s",
                self.config.get("provider"),
                model,
                self.config.get("timeout_seconds"),
            )
            self._record_protocol_failure(
                "responses_tools",
                code="LLM_TIMEOUT",
                message="LLM response timed out",
                retryable=True,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(
                status_code=504,
                detail={
                    "code": "LLM_TIMEOUT",
                    "message": "LLM response timed out",
                    "retryable": True,
                    "provider": self.config.get("provider"),
                    "model": model,
                    "protocol": "responses_tools",
                    "failure_kind": type(exc).__name__,
                },
            ) from exc
        except Exception as exc:
            self._record_protocol_failure(
                "responses_tools",
                code="LLM_RESPONSE_INVALID",
                message="Provider returned an invalid Responses payload",
                retryable=False,
                failure_kind=type(exc).__name__,
            )
            raise HTTPException(
                status_code=502,
                detail={"code": "LLM_REQUEST_FAILED", "message": "LLM tool request failed", "retryable": False},
            ) from exc


class DisabledFallbackAdapter(BaseLLMAdapter):
    def chat_json(self, messages: list[dict[str, str]], parser: Any) -> dict[str, Any]:
        return {}

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        required_tool_name: str | None = None,
    ) -> dict[str, Any]:
        return {"content": "", "tool_calls": []}


class LLMService:
    def local_config_path(self) -> Path:
        configured = os.getenv("OPTIFORGE_LLM_CONFIG_FILE", "")
        return Path(configured).expanduser() if configured else STORE.persistence_path.parent / "llm.local.json"

    def import_local_config(self) -> dict[str, Any]:
        """Explicit import keeps later settings changes authoritative."""
        path = self.local_config_path()
        if not path.is_file():
            raise HTTPException(status_code=404, detail="本机 LLM 配置文件不存在，请先在设置页所示路径创建文件。")
        try:
            if path.stat().st_size > 65536:
                raise ValueError("oversized")
            body = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError):
            raise HTTPException(status_code=422, detail="本机 LLM 配置文件须为不超过 64 KiB 的有效 UTF-8 JSON。") from None
        allowed = {"provider", "base_url", "model", "enabled", "temperature", "max_tokens", "timeout_seconds",
                   "transport_max_attempts", "circuit_failure_threshold", "circuit_cooldown_seconds", "http2", "api_key"}
        if not isinstance(body, dict) or body.keys() - allowed:
            raise HTTPException(status_code=422, detail="配置文件包含不支持的字段；请使用 llm.local.example.json 的格式。")
        for field in ("provider", "base_url", "model", "api_key"):
            if not isinstance(body.get(field), str) or not body[field].strip():
                raise HTTPException(status_code=422, detail=f"请在本机配置文件中填写 {field}。")
            body[field] = body[field].strip()
        try:
            from pydantic import TypeAdapter, ValidationError, StrictBool, StrictFloat, StrictInt
            for field in ("enabled", "http2"):
                if field in body:
                    body[field] = TypeAdapter(StrictBool).validate_python(body[field])
            for field in ("max_tokens", "transport_max_attempts", "circuit_failure_threshold"):
                if field in body:
                    body[field] = TypeAdapter(StrictInt).validate_python(body[field])
            for field in ("temperature", "timeout_seconds", "circuit_cooldown_seconds"):
                if field in body:
                    body[field] = TypeAdapter(StrictFloat).validate_python(body[field])
            if not 1 <= body.get("timeout_seconds", 60) <= 600 or not 0 <= body.get("temperature", 0.2) <= 2 or not 1 <= body.get("max_tokens", 4096) <= 1000000:
                raise ValueError("invalid limits")
        except (ValueError, ValidationError):
            raise HTTPException(status_code=422, detail="配置文件的开关须为 true/false，数值须为有效数字；请检查超时、温度和 token 范围。") from None
        result = self.update_config(body)
        with STORE.lock:
            STORE.llm_config["last_imported_from"] = str(path)
            STORE.save_runtime()
        return {**result, "last_imported_from": str(path)}

    def _override(self, key: str, default: Any = None) -> Any:
        with STORE.lock:
            value = STORE.llm_config.get(key, default)
        return value

    def enabled(self) -> bool:
        provider = str(self._override("provider", os.getenv("LLM_PROVIDER", "volcengine_ark")) or "disabled")
        if provider == "disabled":
            return False
        value = self._override("enabled", os.getenv("LLM_ENABLED", "false"))
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def config(self) -> dict[str, Any]:
        provider = self._override("provider", os.getenv("LLM_PROVIDER", "volcengine_ark"))
        enabled = self.enabled()
        api_key_configured = False if provider == "disabled" else bool(self._api_key())
        return {
            "provider": provider,
            "base_url": str(self._override("base_url", os.getenv("LLM_BASE_URL", os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")))).rstrip("/"),
            "model": self._override("model", os.getenv("LLM_MODEL", os.getenv("ARK_MODEL", ""))),
            "timeout_seconds": float(self._override("timeout_seconds", os.getenv("LLM_TIMEOUT_SECONDS", "60"))),
            "temperature": float(self._override("temperature", os.getenv("LLM_TEMPERATURE", "0.2"))),
            "max_tokens": int(self._override("max_tokens", os.getenv("LLM_MAX_TOKENS", "4096"))),
            "transport_max_attempts": int(self._override("transport_max_attempts", os.getenv("LLM_TRANSPORT_MAX_ATTEMPTS", "3"))),
            "circuit_failure_threshold": int(self._override("circuit_failure_threshold", os.getenv("LLM_CIRCUIT_FAILURE_THRESHOLD", "3"))),
            "circuit_cooldown_seconds": float(self._override("circuit_cooldown_seconds", os.getenv("LLM_CIRCUIT_COOLDOWN_SECONDS", "30"))),
            "http2": str(self._override("http2", os.getenv("LLM_HTTP2", "false"))).strip().lower() in {"1", "true", "yes", "on"},
            "enabled": enabled,
            "api_key_configured": api_key_configured,
            "api_key_recovery_error": getattr(self, "_key_recovery_error", None),
            "supported_providers": sorted(SUPPORTED_PROVIDERS),
            "persistence_path": str(STORE.persistence_path),
            "local_config_file": str(self.local_config_path()),
            "last_imported_from": self._override("last_imported_from", None),
            "config_source": self._config_source(),
            "last_updated_at": self._override("last_updated_at", None),
        }

    def update_config(self, body: dict[str, Any]) -> dict[str, Any]:
        previous = self.config()
        allowed = {
            "provider", "base_url", "model", "enabled", "temperature", "max_tokens", "timeout_seconds",
            "transport_max_attempts", "circuit_failure_threshold", "circuit_cooldown_seconds", "http2",
        }
        updates = {key: body[key] for key in allowed if key in body}
        provider = str(updates.get("provider", self.config()["provider"]) or "disabled")
        if provider not in SUPPORTED_PROVIDERS:
            raise HTTPException(status_code=422, detail=f"当前 Provider 尚未支持: {provider}")
        if provider == "disabled":
            updates["enabled"] = False
            updates["model"] = ""
            updates["key_ciphertext"] = ""
            updates["key_storage"] = ""
        else:
            enabled = str(updates.get("enabled", self.enabled())).strip().lower() in {"1", "true", "yes", "on"}
            api_key = str(body.get("api_key") or self._api_key() or "")
            model = str(updates.get("model", self.config().get("model") or "") or "")
            if enabled and (not model.strip() or not api_key.strip()):
                raise HTTPException(status_code=422, detail="Provider enabled requires both Model / Endpoint ID and API Key.")
            if body.get("api_key"):
                updates["key_ciphertext"] = self._encrypt_key(str(body["api_key"]))
                updates["key_storage"] = "local_encrypted"
        if body.get("clear_api_key"):
            updates["key_ciphertext"] = ""
            updates["key_storage"] = ""
        updates.pop("api_key", None)
        self._validate_runtime_config({**self.config(), **updates})
        updates["last_updated_at"] = datetime.now(timezone.utc).isoformat()
        with STORE.lock:
            STORE.llm_config.pop("api_key", None)
            STORE.llm_config.update(updates)
            STORE.save_runtime()
        OpenAICompatibleAdapter.reset_clients()
        current = self.config()
        llm_gateway_runtime.invalidate(
            str(previous.get("provider") or "unknown"),
            str(previous.get("model") or ""),
            self.production_protocol(previous),
        )
        llm_gateway_runtime.invalidate(
            str(current.get("provider") or "unknown"),
            str(current.get("model") or ""),
            self.production_protocol(current),
        )
        return current

    def test(self) -> dict[str, Any]:
        if not self.enabled():
            return {
                "ok": True,
                "enabled": False,
                "message": "LLM is disabled; rule-based fallback is active.",
                "diagnostics": self._diagnostics(),
                "config": self._safe_config(),
                "runtime_health": self.runtime_health(),
            }
        try:
            probe_tool = {
                "type": "function",
                "function": {
                    "name": "probe_agent_function_call",
                    "description": "No-op diagnostic used only to verify that the model can emit a function call.",
                    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                },
            }
            response = self.chat_with_tools(
                [
                    {"role": "system", "content": "This is a capability probe. Call probe_agent_function_call exactly once and do not answer with text."},
                    {"role": "user", "content": "Verify function calling now."},
                ],
                [probe_tool],
                required_tool_name="probe_agent_function_call",
            )
            tool_calls = response.get("tool_calls") or []
            function_call_ok = any(
                str((call.get("function") or {}).get("name") or "") == "probe_agent_function_call"
                for call in tool_calls
            )
            if not function_call_ok:
                self._record_capability_failure("模型返回成功，但未按要求产生 Function Calling。")
            return {
                "ok": function_call_ok,
                "enabled": True,
                "protocol": self.production_protocol(),
                "function_calling": function_call_ok,
                "response_id": response.get("response_id"),
                "message": "Function Calling 协议验证通过。" if function_call_ok else "模型可连接，但 Function Calling 能力验证未通过。",
                "diagnostics": self._diagnostics(),
                "config": self._safe_config(),
                "runtime_health": self.runtime_health(),
            }
        except HTTPException as exc:
            return {
                "ok": False,
                "enabled": True,
                "message": "LLM connection test failed.",
                "diagnostics": self._diagnostics(exc),
                "config": self._safe_config(),
                "runtime_health": self.runtime_health(),
            }

    def production_protocol(self, config: dict[str, Any] | None = None) -> str:
        current = config or self.config()
        return "responses_tools" if current.get("provider") == "volcengine_ark" else "chat_completions_tools"

    def runtime_health(self) -> dict[str, Any]:
        config = self.config()
        protocol = self.production_protocol(config)
        if not config.get("enabled"):
            return {
                "provider": config.get("provider"),
                "model": config.get("model"),
                "protocol": protocol,
                "operational_state": "disabled",
                "ready": False,
                "configured": False,
            }
        configured = bool(config.get("api_key_configured") and config.get("model"))
        state = llm_gateway_runtime.snapshot(str(config.get("provider")), str(config.get("model") or ""), protocol)
        state["configured"] = configured
        state["ready"] = bool(
            configured
            and state.get("operational_state") == "healthy"
            and state.get("function_calling_verified_at")
        )
        return state

    def _record_capability_failure(self, message: str) -> None:
        config = self.config()
        protocol = self.production_protocol(config)
        llm_gateway_runtime.record_failure(
            str(config.get("provider") or "unknown"),
            str(config.get("model") or ""),
            protocol,
            {
                "code": "LLM_FUNCTION_CALL_UNAVAILABLE",
                "message": message,
                "retryable": False,
                "protocol": protocol,
                "failure_kind": "capability_mismatch",
                "attempt_count": 1,
            },
            failure_threshold=1,
            cooldown_seconds=float(config.get("circuit_cooldown_seconds") or 30),
        )

    @staticmethod
    def _validate_runtime_config(config: dict[str, Any]) -> None:
        if not 1 <= int(config.get("transport_max_attempts") or 0) <= 5:
            raise HTTPException(status_code=422, detail="transport_max_attempts 必须在 1 到 5 之间。")
        if not 1 <= int(config.get("circuit_failure_threshold") or 0) <= 20:
            raise HTTPException(status_code=422, detail="circuit_failure_threshold 必须在 1 到 20 之间。")
        if not 1 <= float(config.get("circuit_cooldown_seconds") or 0) <= 600:
            raise HTTPException(status_code=422, detail="circuit_cooldown_seconds 必须在 1 到 600 秒之间。")

    def extract_parameters(self, message: str, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        prompt = {
            "task": "Extract optimization runtime parameters from the user message.",
            "rules": [
                "Return JSON only, without markdown.",
                "Only include keys declared in input_schema.",
                "Use numbers for numeric values.",
                "For one-dimensional time parameters, use array if schema type is array, otherwise use dict.",
                "Do not invent unavailable business facts.",
            ],
            "input_schema": input_schema,
            "user_message": message,
            "output_format": {"extracted_parameters": {}, "confidence": 0.0, "notes": []},
        }
        if not self.enabled():
            return {}
        return self.chat_json(
            [
                {"role": "system", "content": "You are a power optimization parameter extraction assistant. Return JSON only."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ]
        )

    def explain_result(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.enabled():
            return {}
        prompt = {
            "task": "生成运筹优化调用结果的业务解释，所有输出内容必须使用中文。",
            "rules": [
                "仅返回 JSON，不要包含 Markdown。",
                "不得声称任何生产控制指令已下发。",
                "结果仅作为决策建议，需注明须经人工复核。",
                "所有字段内容（summary、key_findings、risk_notes、next_actions）均须使用中文。",
            ],
            "payload": payload,
            "output_format": {"summary": "", "key_findings": [], "risk_notes": [], "next_actions": []},
        }
        return self.chat_json(
            [
                {"role": "system", "content": "你是运筹优化结果解释助手，负责用中文解释优化结果。仅返回 JSON，不要包含 Markdown。"},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ]
        )

    def summarize_evidence(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Rewrite grounded evidence without changing calculations or facts."""
        if not self.enabled():
            return {}
        prompt = {
            "task": "Rewrite the supplied deterministic optimization explanation in clear Chinese.",
            "rules": [
                "Return JSON only, without markdown.",
                "Use only facts and numbers present in evidence_package.",
                "Do not introduce thresholds, causal claims, guarantees, benefits, or external actions.",
                "Keep facts, inferences, recommendations, and limitations separate.",
                "Every operational recommendation must require human review.",
                "Preserve evidence_refs from the deterministic explanation when emitting item arrays.",
            ],
            "input": payload,
            "output_format": {
                "summary": "",
                "facts": [],
                "fact_items": [],
                "inferences": [],
                "inference_items": [],
                "recommendations": [],
                "recommendation_items": [],
                "risk_notes": [],
                "manual_review_points": [],
                "limitations": [],
                "disclaimer": "",
            },
        }
        return self.chat_json(
            [
                {"role": "system", "content": "You are a grounded result explanation editor. Return JSON only."},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ]
        )

    def chat_json(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        config = self.config()
        return self._adapter(config).chat_json(messages, self._parse_json)

    def chat_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        required_tool_name: str | None = None,
    ) -> dict[str, Any]:
        config = self.config()
        return self._adapter(config).chat_with_tools(messages, tools, required_tool_name=required_tool_name)

    def parse_tool_arguments(self, value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return value
        if value in {None, ""}:
            return {}
        try:
            parsed = json.loads(str(value))
        except Exception as exc:
            raise HTTPException(status_code=502, detail="LLM tool arguments must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=502, detail="LLM tool arguments must be a JSON object")
        return parsed

    def _adapter(self, config: dict[str, Any]) -> BaseLLMAdapter:
        if not config["enabled"] or config["provider"] == "disabled":
            return DisabledFallbackAdapter(config, "")
        if config["provider"] == "volcengine_ark":
            return VolcengineArkAdapter(config, self._api_key())
        if config["provider"] == "openai_compatible":
            return OpenAICompatibleAdapter(config, self._api_key())
        raise HTTPException(status_code=422, detail=f"当前 Provider 尚未支持: {config['provider']}")

    def _parse_json(self, content: str) -> dict[str, Any]:
        text = (content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        try:
            value = json.loads(text)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"message": "LLM did not return valid JSON", "raw": text[:500]}) from exc
        if not isinstance(value, dict):
            raise HTTPException(status_code=502, detail="LLM JSON response must be an object")
        return value

    def _safe_config(self) -> dict[str, Any]:
        config = self.config()
        return config

    def _diagnostics(self, exc: HTTPException | None = None) -> dict[str, Any]:
        config = self.config()
        detail = exc.detail if exc else None
        http_status = exc.status_code if exc else None
        if isinstance(detail, dict) and "http_status" in detail:
            http_status = detail.get("http_status")
        return {
            "provider": config.get("provider"),
            "base_url": config.get("base_url"),
            "model": config.get("model"),
            "api_key_configured": config.get("api_key_configured"),
            "http_status": http_status,
            "error_detail": detail,
            "suggestion": self._suggestion_for(config, http_status, detail),
        }

    def _suggestion_for(self, config: dict[str, Any], http_status: int | None, detail: Any) -> str:
        if not config.get("enabled") or config.get("provider") == "disabled":
            return "LLM is disabled. The Agent will use rule-based extraction and explanation."
        if not config.get("api_key_configured"):
            return "Configure an API Key or switch Provider to disabled."
        if not config.get("model"):
            return "Configure Model / Endpoint ID before testing."
        if http_status in {401, 403}:
            return "Check the API Key and provider permissions."
        if http_status == 404:
            return "Check Base URL and Model / Endpoint ID."
        return "Check provider reachability, Base URL, Model / Endpoint ID, and timeout settings."

    def _api_key(self) -> str:
        env_key = os.getenv("LLM_API_KEY", os.getenv("ARK_API_KEY", ""))
        if env_key:
            return str(env_key)
        legacy = self._override("api_key", "")
        if legacy:
            return str(legacy)
        ciphertext = self._override("key_ciphertext", "")
        return self._decrypt_key(str(ciphertext or ""))

    def _key_material(self, *, create: bool = False) -> bytes:
        secret = os.getenv("OPTIFORGE_CONFIG_SECRET", "")
        if not secret:
            explicit_path = os.getenv("OPTIFORGE_CONFIG_SECRET_FILE", "")
            path = Path(explicit_path) if explicit_path else STORE.persistence_path.parent / ".optiforge-config-secret"
            if not path.exists() and create and not explicit_path:
                path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    pass
                else:
                    with os.fdopen(fd, "w") as stream:
                        stream.write(secrets.token_urlsafe(48))
                        stream.flush()
                        os.fsync(stream.fileno())
            if not path.is_file():
                raise ValueError("LLM 密钥恢复材料缺失；请恢复原 OPTIFORGE_CONFIG_SECRET / Secret 文件，或重新填写 API Key。迁移时需同时保留数据目录中的 .optiforge-config-secret。")
            secret = path.read_text().strip()
        if not secret:
            raise ValueError("LLM 配置 Secret 为空，请恢复原 Secret 或重新配置 API Key。")
        return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())

    def _encrypt_key(self, value: str) -> str:
        if not value:
            return ""
        from cryptography.fernet import Fernet
        self._key_recovery_error = None
        return "fernet:v1:" + Fernet(self._key_material(create=True)).encrypt(value.encode()).decode("ascii")

    def _decrypt_key(self, value: str) -> str:
        self._key_recovery_error = None
        if not value:
            return ""
        try:
            if value.startswith("fernet:v1:"):
                from cryptography.fernet import Fernet
                return Fernet(self._key_material()).decrypt(value[len("fernet:v1:"):].encode()).decode()
            # Migrate old host-bound XOR only while its original environment is
            # still available. Preserve the ciphertext on recovery failure.
            raw = base64.urlsafe_b64decode(value.encode("ascii"))
            seed = "|".join([socket.gethostname(), getpass.getuser(), str(STORE.persistence_path.parent)])
            material = hashlib.sha256(seed.encode()).digest()
            key = bytes(byte ^ material[index % len(material)] for index, byte in enumerate(raw)).decode()
            if not key or not key.isprintable():
                raise ValueError("legacy key cannot be decoded")
            migrated = self._encrypt_key(key)
            with STORE.lock:
                if STORE.llm_config.get("key_ciphertext") == value:
                    STORE.llm_config["key_ciphertext"] = migrated
                    STORE.save_runtime()
            return key
        except Exception:
            self._key_recovery_error = "保存的 API Key 无法解密。请恢复保存时的 OPTIFORGE_CONFIG_SECRET 或 Secret 文件；旧版配置须在原环境迁移，或重新填写 API Key。"
            return ""

    def _config_source(self) -> str:
        with STORE.lock:
            if STORE.llm_config:
                return "runtime_store"
        env_keys = ["LLM_PROVIDER", "LLM_BASE_URL", "ARK_BASE_URL", "LLM_MODEL", "ARK_MODEL", "LLM_API_KEY", "ARK_API_KEY", "LLM_ENABLED"]
        return "env" if any(os.getenv(key) for key in env_keys) else "default"


llm_service = LLMService()
