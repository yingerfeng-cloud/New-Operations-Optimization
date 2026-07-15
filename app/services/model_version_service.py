from __future__ import annotations

import re
import uuid
from copy import deepcopy
from typing import Any, Callable, Iterable

from fastapi import HTTPException

from app.schemas.model import ModelPackage, ModelView
from app.storage.memory_store import STORE


class ModelVersionService:
    """Owns model-family identity, version indexes, and publish-code governance."""

    def prepare_identity(self, model: ModelPackage, source: ModelView | None = None) -> ModelPackage:
        metadata = model.ui_metadata or {}
        supersedes_id = model.supersedes_model_id or metadata.get("supersedes_model_id")
        family_id = model.model_family_id or metadata.get("model_family_id")
        version = model.version
        if source is not None:
            family_id = source.model_family_id or f"legacy-{source.id}"
            if not version or version == source.version or version == "v0.1":
                version = self.next_version(source.version)
        family_id = str(family_id or f"FAMILY-{uuid.uuid4().hex[:12].upper()}")
        return model.model_copy(
            update={
                "model_family_id": family_id,
                "supersedes_model_id": supersedes_id,
                "version": version,
                "is_active_version": False,
            }
        )

    def validate_publish_code_ownership(
        self,
        model: ModelView,
        candidates: Iterable[ModelView],
        *,
        is_builtin: Callable[[ModelView], bool],
    ) -> None:
        for candidate in candidates:
            if candidate.id == model.id or not candidate.is_active_version or is_builtin(candidate):
                continue
            if candidate.model_family_id != model.model_family_id:
                raise HTTPException(status_code=409, detail="模型编码已被其他模型家族使用，请修改编码。")

    def record_locked(self, model: ModelView, model_code: str) -> None:
        family_id = str(model.model_family_id or f"legacy-{model.id}")
        rows = [item for item in STORE.model_versions.get(family_id, []) if item.get("model_id") != model.id]
        rows.append(
            {
                "model_id": model.id,
                "model_family_id": family_id,
                "model_code": model_code,
                "version": model.version,
                "status": model.status,
                "is_active_version": model.is_active_version,
                "supersedes_model_id": model.supersedes_model_id,
                "published_at": model.published_at,
                "updated_at": model.updated_at,
            }
        )
        STORE.model_versions[family_id] = sorted(
            rows,
            key=lambda item: (str(item.get("updated_at") or ""), str(item.get("model_id") or "")),
        )

    def list_versions(self, model: ModelView) -> list[ModelView]:
        family_id = str(model.model_family_id or f"legacy-{model.id}")
        with STORE.lock:
            versions = [item for item in STORE.models.values() if str(item.model_family_id or f"legacy-{item.id}") == family_id]
        return sorted(versions, key=lambda item: (self.version_key(item.version), str(item.updated_at or ""), item.id), reverse=True)

    def new_version_package(self, source: ModelView, overrides: dict[str, Any] | None = None) -> ModelPackage:
        data = source.model_dump(
            exclude={
                "id", "created_at", "updated_at", "published_at", "tested_at", "validation_warnings",
                "dry_run_result", "is_active_version", "published_by",
            }
        )
        data.update(deepcopy(overrides or {}))
        data.update(
            {
                "model_family_id": source.model_family_id or f"legacy-{source.id}",
                "supersedes_model_id": source.id,
                "version": self.next_version(source.version),
                "status": "developing",
                "is_active_version": False,
                "published_at": None,
                "tested_at": None,
                "validation_warnings": [],
                "dry_run_result": {},
            }
        )
        metadata = deepcopy(data.get("ui_metadata") or {})
        for key in ("publish_info", "test_result", "version_info"):
            metadata.pop(key, None)
        metadata["supersedes_model_id"] = source.id
        metadata["model_family_id"] = data["model_family_id"]
        data["ui_metadata"] = metadata
        return ModelPackage.model_validate(data)

    @staticmethod
    def next_version(version: str | None) -> str:
        text = str(version or "v0.0")
        match = re.search(r"(\d+)(?!.*\d)", text)
        if not match:
            return f"{text}-v2"
        return f"{text[:match.start()]}{int(match.group(1)) + 1}{text[match.end():]}"

    @staticmethod
    def version_key(version: str | None) -> tuple[int, ...]:
        values = tuple(int(value) for value in re.findall(r"\d+", str(version or "")))
        return values or (0,)


model_version_service = ModelVersionService()
