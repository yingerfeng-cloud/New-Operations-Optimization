from __future__ import annotations

from typing import Any


class SampleValueResolver:
    """Read examples without silently promoting them to production defaults."""

    def resolve(self, item: dict[str, Any]) -> tuple[bool, Any]:
        value = item.get("sample_value")
        return value is not None, value


sample_value_resolver = SampleValueResolver()
