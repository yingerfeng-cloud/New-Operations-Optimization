from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROFILE_DIR = ROOT / "explanation_profiles"


class ExplanationProfileLoader:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or DEFAULT_PROFILE_DIR

    def load(self, profile_name: str | None) -> dict[str, Any] | None:
        if not profile_name:
            return None
        safe = str(profile_name).replace("\\", "/").split("/")[-1]
        for suffix in (".json", ".yaml", ".yml"):
            path = self.root / f"{safe}{suffix}"
            if not path.is_file():
                continue
            if suffix == ".json":
                return json.loads(path.read_text(encoding="utf-8"))
            return self._read_simple_yaml(path)
        return None

    def match(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        explicit = metadata.get("explanation_profile")
        if explicit:
            profile = self.load(str(explicit))
            if profile:
                return profile
        tags = {str(item).lower() for item in metadata.get("tags") or []}
        domain = metadata.get("business_domain") or {}
        domain_values = {str(domain.get("primary") or "").lower(), *[str(item).lower() for item in domain.get("secondary") or []]}
        family = str(metadata.get("model_family") or "").lower()
        for path in sorted(self.root.glob("*.json")) if self.root.exists() else []:
            profile = json.loads(path.read_text(encoding="utf-8"))
            applies = profile.get("applies_to") or {}
            if tags.intersection(str(item).lower() for item in applies.get("tags") or []):
                return profile
            if domain_values.intersection(str(item).lower() for item in applies.get("business_domains") or []):
                return profile
            if family and family in {str(item).lower() for item in applies.get("model_families") or []}:
                return profile
        return None

    def _read_simple_yaml(self, path: Path) -> dict[str, Any]:
        # Profiles shipped by this project are JSON. This intentionally accepts only
        # flat YAML fallback instead of introducing a mandatory parser dependency.
        result: dict[str, Any] = {}
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip() or raw.lstrip().startswith("#") or raw.startswith(" ") or ":" not in raw:
                continue
            key, value = raw.split(":", 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
        return result


profile_loader = ExplanationProfileLoader()
