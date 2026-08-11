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
RUNTIME_SCHEMA_VERSION = 7
INTERRUPTED_TASK_STATUSES = {"PENDING", "QUEUED", "VALIDATING", "BUILDING_MODEL", "SOLVING", "FORMATTING_RESULT", "RUNNING"}
MODEL_STATUS_MIGRATIONS = {
    "draft": "developing",
    "tested": "trial",
    "草稿": "developing",
    "开发中": "developing",
    "已测试": "trial",
    "试运行": "trial",
    "已发布": "published",
    "已下线": "offline",
    "发布失败": "publish_failed",
}


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
        self.agent_runs: dict[str, dict[str, Any]] = {}
        self.agent_tasks: dict[str, dict[str, Any]] = {}
        self.agent_events: dict[str, list[dict[str, Any]]] = {}
        self.tool_invocations: dict[str, dict[str, Any]] = {}
        self.agent_approvals: dict[str, dict[str, Any]] = {}
        self.llm_config: dict[str, Any] = {}
        self.system_config: dict[str, Any] = {}
        self.template_status: dict[str, str] = {}
        self.rolling_jobs: dict[str, Any] = {}
        self.custom_components: dict[str, dict[str, Any]] = {}
        self.function_assets: dict[str, dict[str, Any]] = {}
        self.model_versions: dict[str, list[dict[str, Any]]] = {}
        self.active_model_versions: dict[str, str] = {}
        root = Path(__file__).resolve().parents[2]
        runtime_store = os.getenv("OPTIFORGE_RUNTIME_STORE") or os.getenv("RUNTIME_STORE_PATH") or str(root / "data" / "runtime_store.json")
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
                "agent_runs": self.agent_runs,
                "agent_tasks": self.agent_tasks,
                "agent_events": self.agent_events,
                "tool_invocations": self.tool_invocations,
                "agent_approvals": self.agent_approvals,
                "llm_config": llm_config,
                "system_config": self.system_config,
                "custom_components": self.custom_components,
                "function_assets": self.function_assets,
            }
            payload = self._normalize_deprecated_markers(payload)
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
            loaded_schema_version = int(payload.get("schema_version") or 1) if isinstance(payload, dict) else 1
            payload = self._migrate_payload(payload)
            section_names = (
                "models", "model_versions", "active_model_versions", "assets", "tasks", "results",
                "invocations", "skills", "conversations", "agent_runs", "agent_tasks", "agent_events",
                "tool_invocations", "agent_approvals", "llm_config", "system_config",
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
            self.agent_runs.update(sections["agent_runs"])
            self.agent_tasks.update(sections["agent_tasks"])
            self.agent_events.update(sections["agent_events"])
            self.tool_invocations.update(sections["tool_invocations"])
            self.agent_approvals.update(sections["agent_approvals"])
            self.llm_config.update(sections["llm_config"])
            self.system_config.update(sections["system_config"])
            self.custom_components.update(sections["custom_components"])
            self.function_assets.update(sections["function_assets"])
            tasks_interrupted = self._interrupt_recovered_tasks()
            agent_runs_interrupted = self._interrupt_recovered_agent_runs()
            agent_v3_interrupted = self._interrupt_recovered_agent_v3_work()
            if loaded_schema_version < RUNTIME_SCHEMA_VERSION or tasks_interrupted or agent_runs_interrupted or agent_v3_interrupted:
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
            LOGGER.info("Migrated runtime store schema from v1 to v2")
            version = 2
        if version == 2:
            models = migrated.get("models") or {}
            if isinstance(models, dict):
                for model in models.values():
                    if isinstance(model, dict):
                        model["status"] = MODEL_STATUS_MIGRATIONS.get(str(model.get("status")), model.get("status"))
            model_versions = migrated.get("model_versions") or {}
            if isinstance(model_versions, dict):
                for rows in model_versions.values():
                    if not isinstance(rows, list):
                        continue
                    for row in rows:
                        if isinstance(row, dict) and "status" in row:
                            row["status"] = MODEL_STATUS_MIGRATIONS.get(str(row.get("status")), row.get("status"))
            LOGGER.info("Migrated runtime store model lifecycle from v2 to v3")
            version = 3
        if version == 3:
            LOGGER.info("Normalized runtime store records to the current data contract")
            version = 4
        # Versions 4-6 introduced the generic Agent collections incrementally.
        # Their data shape is accepted below, then upgraded as one unit to the
        # isolated task-context contract.
        if version < 7:
            self._migrate_agent_tasks_to_isolated_contexts(migrated)
            LOGGER.info("Migrated Agent runtime to isolated task contexts (v7)")
            version = 7
        migrated.setdefault("agent_runs", {})
        migrated.setdefault("agent_tasks", {})
        migrated.setdefault("agent_events", {})
        migrated.setdefault("tool_invocations", {})
        migrated.setdefault("agent_approvals", {})
        migrated = self._normalize_deprecated_markers(migrated)
        migrated["schema_version"] = RUNTIME_SCHEMA_VERSION
        return migrated

    @staticmethod
    def _migrate_agent_tasks_to_isolated_contexts(payload: dict[str, Any]) -> None:
        """Quarantine state produced by the former shared-conversation adapter.

        Old optimization tasks cannot be safely resumed: their parameter draft,
        Skill, and run may belong to different model turns.  Visible messages
        are retained, while workflow state is made terminal and future turns
        start from the new task-local contract.
        """
        conversations = payload.setdefault("conversations", {})
        tasks = payload.setdefault("agent_tasks", {})
        approvals = payload.setdefault("agent_approvals", {})
        runs = payload.setdefault("agent_runs", {})
        events = payload.setdefault("agent_events", {})
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        active_statuses = {"PENDING", "RUNNING", "WAITING_INPUT", "APPROVAL_REQUIRED"}
        quarantined_task_ids: set[str] = set()
        quarantined_run_ids: set[str] = set()

        legacy_state_fields = {
            "resolved_skill_name", "selected_skill", "agent_skill_name",
            "parameter_draft", "parameter_sources", "missing_required",
            "invalid_parameters", "can_use_default", "last_questions",
            "pending_switch", "active_run_id", "last_invocation_id",
            "last_result", "model_id", "last_response_type", "recent_turns",
        }
        for conversation_id, conversation in list(conversations.items()):
            if not isinstance(conversation, dict):
                continue
            if conversation.get("kind") == "task_context":
                continue
            conversation["kind"] = "user"
            conversation["runtime_contract"] = "agent_v3"
            conversation.pop("model_messages", None)
            for field in legacy_state_fields:
                conversation.pop(field, None)
            conversation["status"] = "CHAT_IDLE"

        for task_id, task in list(tasks.items()):
            if not isinstance(task, dict) or task.get("tool_name") != "optimization_create_or_continue":
                continue
            if int(task.get("task_contract_version") or 0) >= 2 and task.get("execution_context_id"):
                continue
            quarantined_task_ids.add(str(task_id))
            run_id = task.get("optimization_run_id")
            result = task.get("result") if isinstance(task.get("result"), dict) else {}
            run_id = run_id or result.get("run_id")
            if run_id:
                quarantined_run_ids.add(str(run_id))
            task["task_contract_version"] = 1
            task["migration_status"] = "QUARANTINED_SHARED_STATE"
            if str(task.get("status") or "").upper() in active_statuses:
                task["status"] = "CANCELLED"
                task["error"] = "旧版任务状态无法可靠归属，已停止续接；请在当前会话重新描述任务。"
                task["updated_at"] = timestamp
            conversation_id = str(task.get("conversation_id") or "")
            history = events.setdefault(conversation_id, [])
            if isinstance(history, list):
                history.append({
                    "event_id": f"MIGRATION-{task_id}",
                    "sequence": len(history) + 1,
                    "type": "task.quarantined",
                    "conversation_id": conversation_id,
                    "turn_id": task.get("last_turn_id") or task.get("turn_id"),
                    "task_id": task_id,
                    "created_at": timestamp,
                    "payload": {"reason": "shared_legacy_state", "target_contract": 2},
                })

        for approval in approvals.values():
            if not isinstance(approval, dict) or str(approval.get("task_id")) not in quarantined_task_ids:
                continue
            if str(approval.get("status") or "").upper() in {"PENDING", "FAILED", "EXECUTING"}:
                approval["status"] = "SUPERSEDED"
                approval["error"] = "关联任务已迁移到隔离执行契约"
                approval["updated_at"] = timestamp

        for run_id in quarantined_run_ids:
            run = runs.get(run_id)
            if not isinstance(run, dict):
                continue
            if str(run.get("status") or "").upper() not in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                run["status"] = "CANCELLED"
                run["workflow_state"] = "CANCELLED"
                run["error"] = "关联 Agent 任务已迁移，旧运行不再允许续接"
                run["updated_at"] = timestamp

    @classmethod
    def _normalize_deprecated_markers(cls, value: Any) -> Any:
        """Normalize only explicitly retired presentation markers.

        Prefix-wide deletion previously removed legitimate relationship fields
        such as legacy_run_id and made persisted records non-recoverable.
        """
        marker_prefix = "legacy" + "_"
        if isinstance(value, dict):
            normalized: dict[Any, Any] = {}
            for key, item in value.items():
                if str(key) in {"legacy_business_explanation", "legacy_objective_code"}:
                    suffix = str(key)[len(marker_prefix):]
                    normalized_item = cls._normalize_deprecated_markers(item)
                    normalized.setdefault(suffix, normalized_item)
                    continue
                normalized[key] = cls._normalize_deprecated_markers(item)
            return normalized
        if isinstance(value, list):
            return [cls._normalize_deprecated_markers(item) for item in value]
        if isinstance(value, str):
            if value == "legacy preset":
                return "hydro preset"
        return value

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

    def _interrupt_recovered_agent_runs(self) -> bool:
        interrupted = False
        for run in self.agent_runs.values():
            if str(run.get("status") or "").upper() not in {"QUEUED", "RUNNING"}:
                continue
            interrupted = True
            run["status"] = "FAILED"
            run["workflow_state"] = "FAILED"
            run["error"] = "服务重启导致运行中断，请重试"
            run["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return interrupted

    def _interrupt_recovered_agent_v3_work(self) -> bool:
        interrupted = False
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for task in self.agent_tasks.values():
            task.setdefault("revision", 1)
            if str(task.get("status") or "").upper() not in {"PENDING", "RUNNING"}:
                continue
            interrupted = True
            task["status"] = "FAILED"
            task["error"] = "服务重启导致 Agent 任务中断，请重试"
            task["updated_at"] = timestamp
        for invocation in self.tool_invocations.values():
            if str(invocation.get("status") or "").upper() != "RUNNING":
                continue
            interrupted = True
            invocation["status"] = "FAILED"
            invocation["error"] = "服务重启导致工具调用中断，请重试"
            invocation["updated_at"] = timestamp
        for approval in self.agent_approvals.values():
            task = self.agent_tasks.get(str(approval.get("task_id") or ""))
            if "task_revision" not in approval and task:
                approval["task_revision"] = int(task.get("revision") or 1)
            if str(approval.get("status") or "").upper() != "EXECUTING":
                continue
            interrupted = True
            approval["status"] = "FAILED"
            approval["error"] = "服务重启导致审批执行中断，请重试"
            approval["updated_at"] = timestamp
            if task:
                approval["task_revision"] = int(task.get("revision") or 1)
                task["status"] = "APPROVAL_REQUIRED"
                task["error"] = approval["error"]
                task["updated_at"] = timestamp
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
