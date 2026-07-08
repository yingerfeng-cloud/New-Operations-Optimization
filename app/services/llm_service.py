from __future__ import annotations

import json
import os
import base64
import hashlib
import getpass
import socket
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException

from app.storage.memory_store import STORE


SUPPORTED_PROVIDERS = {"volcengine_ark", "openai_compatible", "disabled"}


class BaseLLMAdapter:
    def __init__(self, config: dict[str, Any], api_key: str) -> None:
        self.config = config
        self.api_key = api_key

    def chat_json(self, messages: list[dict[str, str]], parser: Any) -> dict[str, Any]:
        raise NotImplementedError


class OpenAICompatibleAdapter(BaseLLMAdapter):
    missing_detail = "API Key and Model are required when LLM_ENABLED=true"

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
            with httpx.Client(timeout=self.config["timeout_seconds"]) as client:
                response = client.post(url, headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}, json=body)
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            return parser(content)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"message": "LLM request failed", "error": str(exc)}) from exc


class VolcengineArkAdapter(OpenAICompatibleAdapter):
    missing_detail = "API Key and Model / Endpoint ID are required when LLM_ENABLED=true"


class DisabledFallbackAdapter(BaseLLMAdapter):
    def chat_json(self, messages: list[dict[str, str]], parser: Any) -> dict[str, Any]:
        return {}


class LLMService:
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
            "timeout_seconds": float(self._override("timeout_seconds", os.getenv("LLM_TIMEOUT_SECONDS", "8"))),
            "temperature": float(self._override("temperature", os.getenv("LLM_TEMPERATURE", "0.2"))),
            "max_tokens": int(self._override("max_tokens", os.getenv("LLM_MAX_TOKENS", "4096"))),
            "enabled": enabled,
            "api_key_configured": api_key_configured,
            "supported_providers": sorted(SUPPORTED_PROVIDERS),
            "persistence_path": str(STORE.persistence_path),
            "config_source": self._config_source(),
            "last_updated_at": self._override("last_updated_at", None),
        }

    def update_config(self, body: dict[str, Any]) -> dict[str, Any]:
        allowed = {"provider", "base_url", "model", "enabled", "temperature", "max_tokens", "timeout_seconds"}
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
        updates["last_updated_at"] = datetime.now(timezone.utc).isoformat()
        with STORE.lock:
            STORE.llm_config.pop("api_key", None)
            STORE.llm_config.update(updates)
            STORE.save_runtime()
        return self.config()

    def test(self) -> dict[str, Any]:
        if not self.enabled():
            return {
                "ok": True,
                "enabled": False,
                "message": "LLM is disabled; rule-based fallback is active.",
                "diagnostics": self._diagnostics(),
                "config": self._safe_config(),
            }
        try:
            content = self.chat_json(
                [
                    {"role": "system", "content": "Return JSON only."},
                    {"role": "user", "content": 'Return {"ok": true, "provider": "volcengine_ark"}'},
                ]
            )
            return {"ok": bool(content.get("ok")), "enabled": True, "response": content, "diagnostics": self._diagnostics(), "config": self._safe_config()}
        except HTTPException as exc:
            return {
                "ok": False,
                "enabled": True,
                "message": "LLM connection test failed.",
                "diagnostics": self._diagnostics(exc),
                "config": self._safe_config(),
            }

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

    def chat_json(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        config = self.config()
        return self._adapter(config).chat_json(messages, self._parse_json)

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

    def _key_material(self) -> bytes:
        seed = "|".join([socket.gethostname(), getpass.getuser(), str(STORE.persistence_path.parent)])
        return hashlib.sha256(seed.encode("utf-8")).digest()

    def _encrypt_key(self, value: str) -> str:
        if not value:
            return ""
        raw = value.encode("utf-8")
        key = self._key_material()
        encrypted = bytes(byte ^ key[index % len(key)] for index, byte in enumerate(raw))
        return base64.urlsafe_b64encode(encrypted).decode("ascii")

    def _decrypt_key(self, value: str) -> str:
        if not value:
            return ""
        try:
            raw = base64.urlsafe_b64decode(value.encode("ascii"))
            key = self._key_material()
            decrypted = bytes(byte ^ key[index % len(key)] for index, byte in enumerate(raw))
            return decrypted.decode("utf-8")
        except Exception:
            return ""

    def _config_source(self) -> str:
        with STORE.lock:
            if STORE.llm_config:
                return "runtime_store"
        env_keys = ["LLM_PROVIDER", "LLM_BASE_URL", "ARK_BASE_URL", "LLM_MODEL", "ARK_MODEL", "LLM_API_KEY", "ARK_API_KEY", "LLM_ENABLED"]
        return "env" if any(os.getenv(key) for key in env_keys) else "default"


llm_service = LLMService()
