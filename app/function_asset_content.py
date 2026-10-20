"""Pure function content identity, also usable by read-only migration tooling."""
import hashlib
import json
from typing import Any

from app.schemas.function_asset import FunctionAsset


def function_asset_hash(asset: dict[str, Any]) -> str:
    normalized = FunctionAsset.model_validate(asset).model_dump(mode="json")
    content = {key: value for key, value in normalized.items() if key not in {
        "revision", "content_hash", "_versions", "referenced_by", "created_at", "updated_at",
    }}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
