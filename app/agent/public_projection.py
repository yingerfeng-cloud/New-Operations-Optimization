"""One recursive boundary for public Agent tasks, runs and historical events."""
from typing import Any

from app.storage.memory_store import STORE


def public_projection(value: Any) -> Any:
    if isinstance(value, list):
        return [public_projection(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in {"execution_context_id", "task_context_id", "private_context"}:
            continue
        if isinstance(item, str) and item.startswith("CTX-"):
            if key == "conversation_id":
                with STORE.lock:
                    parent = (STORE.conversations.get(item) or {}).get("parent_conversation_id")
                if parent:
                    result[key] = parent
            continue
        result[key] = public_projection(item)
    return result
