from __future__ import annotations

from typing import Any


class DefaultValueResolver:
    """Resolve only schema-authorized defaults.

    This module deliberately has no dependency on invocation or solver code so
    parameter analysis can run without importing Pyomo and its solver stack.
    """

    def resolve(self, item: dict[str, Any]) -> tuple[bool, Any]:
        policy = str(item.get("default_policy") or "sample_only")
        if policy != "default_allowed":
            return False, None
        value = item.get("default_value")
        return value is not None, value


default_value_resolver = DefaultValueResolver()
