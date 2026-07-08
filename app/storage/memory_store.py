from __future__ import annotations

import json
import os
from pathlib import Path
import threading
from typing import Any

from app.schemas.model import AssetView, ModelView
from app.schemas.solve import TaskRecord


class MemoryStore:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.scheduler = threading.Semaphore(4)
        self.models: dict[str, ModelView] = {}
        self.assets: dict[str, AssetView] = {}
        self.tasks: dict[str, TaskRecord] = {}
        self.results: dict[str, dict[str, Any]] = {}
        self.invocations: dict[str, dict[str, Any]] = {}
        self.skills: dict[str, dict[str, Any]] = {}
        self.conversations: dict[str, dict[str, Any]] = {}
        self.llm_config: dict[str, Any] = {}
        self.system_config: dict[str, Any] = {}
        self.template_status: dict[str, str] = {}
        self.rolling_jobs: dict[str, Any] = {}
        self.custom_components: dict[str, dict[str, Any]] = {}
        self.function_assets: dict[str, dict[str, Any]] = {}
        self.model_versions: dict[str, list[dict[str, Any]]] = {}
        root = Path(__file__).resolve().parents[2]
        runtime_store = os.getenv("COPT_RUNTIME_STORE") or os.getenv("RUNTIME_STORE_PATH") or str(root / "data" / "runtime_store.json")
        self._persistence_path = Path(runtime_store)
        self._load_runtime()

    @property
    def persistence_path(self) -> Path:
        return self._persistence_path

    def save_runtime(self) -> None:
        llm_config = dict(self.llm_config)
        llm_config.pop("api_key", None)
        payload = {
            "invocations": self.invocations,
            "skills": self.skills,
            "conversations": self.conversations,
            "llm_config": llm_config,
            "system_config": self.system_config,
            "custom_components": self.custom_components,
            "function_assets": self.function_assets,
        }
        try:
            self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
            self._persistence_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        except Exception:
            return

    def _load_runtime(self) -> None:
        if not self._persistence_path.exists():
            return
        try:
            payload = json.loads(self._persistence_path.read_text(encoding="utf-8"))
            self.invocations.update(payload.get("invocations") or {})
            self.skills.update(payload.get("skills") or {})
            self.conversations.update(payload.get("conversations") or {})
            self.llm_config.update(payload.get("llm_config") or {})
            self.system_config.update(payload.get("system_config") or {})
            self.custom_components.update(payload.get("custom_components") or {})
            self.function_assets.update(payload.get("function_assets") or {})
        except Exception:
            return


STORE = MemoryStore()
