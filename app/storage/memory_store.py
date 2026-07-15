from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import shutil
import threading
from datetime import datetime
from typing import Any

from app.schemas.model import AssetView, ModelView
from app.schemas.solve import TaskRecord, TaskRecordState


LOGGER = logging.getLogger(__name__)
RUNTIME_SCHEMA_VERSION = 2
INTERRUPTED_TASK_STATUSES = {"PENDING", "QUEUED", "VALIDATING", "BUILDING_MODEL", "SOLVING", "FORMATTING_RESULT", "RUNNING"}


class MemoryStore:
    def __init__(self) -> None:
        self.lock = threading.RLock()
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
        self.active_model_versions: dict[str, str] = {}
        root = Path(__file__).resolve().parents[2]
        runtime_store = os.getenv("COPT_RUNTIME_STORE") or os.getenv("RUNTIME_STORE_PATH") or str(root / "data" / "runtime_store.json")
        self._persistence_path = Path(runtime_store)
        self._load_runtime()

    @property
    def persistence_path(self) -> Path:
        return self._persistence_path

    def save_runtime(self) -> None:
        with self.lock:
            llm_config = dict(self.llm_config)
            llm_config.pop("api_key", None)
            persisted_models = {
                model_id: model.model_dump(mode="json")
                for model_id, model in self.models.items()
                if not bool((model.ui_metadata or {}).get("managed_default_template"))
            }
            persisted_model_ids = set(persisted_models)
            persisted_versions = {
                family_id: [row for row in rows if row.get("model_id") in persisted_model_ids]
                for family_id, rows in self.model_versions.items()
                if any(row.get("model_id") in persisted_model_ids for row in rows)
            }
            payload = {
                "schema_version": RUNTIME_SCHEMA_VERSION,
                "models": persisted_models,
                "model_versions": persisted_versions,
                "active_model_versions": {
                    family_id: model_id
                    for family_id, model_id in self.active_model_versions.items()
                    if model_id in persisted_model_ids
                },
                "assets": {asset_id: asset.model_dump(mode="json") for asset_id, asset in self.assets.items()},
                "tasks": {task_id: TaskRecordState.from_record(task).model_dump(mode="json") for task_id, task in self.tasks.items()},
                "results": self.results,
                "invocations": self.invocations,
                "skills": self.skills,
                "conversations": self.conversations,
                "llm_config": llm_config,
                "system_config": self.system_config,
                "custom_components": self.custom_components,
                "function_assets": self.function_assets,
            }
            payload = self._redact_secrets(payload)
            temporary_path = self._persistence_path.with_suffix(f"{self._persistence_path.suffix}.tmp")
            try:
                self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
                encoded = json.dumps(payload, ensure_ascii=False, indent=2, default=str)
                with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary_path, self._persistence_path)
            except Exception:
                LOGGER.exception("Failed to persist runtime store to %s", self._persistence_path)
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    LOGGER.warning("Failed to remove incomplete runtime store %s", temporary_path, exc_info=True)
                raise

    def _load_runtime(self) -> None:
        if not self._persistence_path.exists():
            return
        try:
            payload = json.loads(self._persistence_path.read_text(encoding="utf-8"))
            payload = self._migrate_payload(payload)
            section_names = (
                "models", "model_versions", "active_model_versions", "assets", "tasks", "results",
                "invocations", "skills", "conversations", "llm_config", "system_config",
                "custom_components", "function_assets",
            )
            sections: dict[str, dict[str, Any]] = {}
            for name in section_names:
                value = payload.get(name) or {}
                if not isinstance(value, dict):
                    raise ValueError(f"runtime store section {name} must be an object")
                sections[name] = value
            for family_id, rows in sections["model_versions"].items():
                if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                    raise ValueError(f"runtime store model_versions[{family_id}] must be an array of objects")
            models = {key: ModelView.model_validate(value) for key, value in sections["models"].items()}
            assets = {key: AssetView.model_validate(value) for key, value in sections["assets"].items()}
            tasks = {key: TaskRecordState.model_validate(value).to_record() for key, value in sections["tasks"].items()}
            self.models.update(models)
            self.model_versions.update(sections["model_versions"])
            self.active_model_versions.update(sections["active_model_versions"])
            self.assets.update(assets)
            self.tasks.update(tasks)
            self.results.update(sections["results"])
            self.invocations.update(sections["invocations"])
            self.skills.update(sections["skills"])
            self.conversations.update(sections["conversations"])
            self.llm_config.update(sections["llm_config"])
            self.system_config.update(sections["system_config"])
            self.custom_components.update(sections["custom_components"])
            self.function_assets.update(sections["function_assets"])
            if self._interrupt_recovered_tasks():
                self.save_runtime()
        except Exception:
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
            backup = self._persistence_path.with_name(f"{self._persistence_path.name}.corrupt-{timestamp}.bak")
            try:
                shutil.copy2(self._persistence_path, backup)
            except OSError:
                LOGGER.exception("Runtime store is corrupt and backup creation failed: %s", self._persistence_path)
            LOGGER.exception("Runtime store is corrupt; preserved backup at %s", backup)

    def _migrate_payload(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("runtime store root must be an object")
        version = int(payload.get("schema_version") or 1)
        if version > RUNTIME_SCHEMA_VERSION:
            raise ValueError(f"unsupported runtime store schema_version={version}")
        migrated = dict(payload)
        if version == 1:
            for key in ("models", "model_versions", "active_model_versions", "assets", "tasks", "results"):
                migrated.setdefault(key, {})
            migrated["schema_version"] = RUNTIME_SCHEMA_VERSION
            LOGGER.info("Migrated runtime store schema from v1 to v2")
        return migrated

    def _interrupt_recovered_tasks(self) -> bool:
        interrupted = False
        for task in self.tasks.values():
            if task.status not in INTERRUPTED_TASK_STATUSES:
                continue
            interrupted = True
            task.status = "INTERRUPTED"
            task.progress = 100
            task.finished_at = task.finished_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            task.error = "服务重启导致任务中断，请重新提交"
            task.logs.append("ERROR 服务重启导致任务中断，请重新提交")
        return interrupted

    @classmethod
    def _redact_secrets(cls, value: Any) -> Any:
        sensitive_keys = {"api_key", "api_token", "access_token", "authorization", "password", "secret", "client_secret"}
        if isinstance(value, dict):
            return {
                key: "[REDACTED]" if str(key).lower() in sensitive_keys else cls._redact_secrets(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [cls._redact_secrets(item) for item in value]
        if isinstance(value, tuple):
            return [cls._redact_secrets(item) for item in value]
        return value


STORE = MemoryStore()
