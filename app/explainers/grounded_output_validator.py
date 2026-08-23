from __future__ import annotations

import json
import re
from typing import Any


class GroundedOutputValidator:
    """Reject summaries that introduce unsupported numbers or guarantees."""

    FORBIDDEN_CLAIMS = (
        "保证收益", "确保盈利", "绝对安全", "一定可执行", "保证最优", "全局最优",
        "可直接下发", "无需人工复核",
    )

    def validate(
        self,
        candidate: dict[str, Any] | None,
        evidence: dict[str, Any],
        fallback: dict[str, Any],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not isinstance(candidate, dict):
            return fallback, {"valid": False, "fallback_used": True, "reasons": ["EMPTY_LLM_OUTPUT"]}
        text = json.dumps(candidate, ensure_ascii=False)
        evidence_text = json.dumps(evidence, ensure_ascii=False)
        reasons: list[str] = []
        for claim in self.FORBIDDEN_CLAIMS:
            if claim in text and claim not in evidence_text:
                reasons.append(f"UNSUPPORTED_CLAIM:{claim}")
        evidence_numbers = set(self._numbers(evidence_text))
        evidence_numbers.update(str(value) for value in self._structural_counts(evidence))
        for value in self._numbers(text):
            if value not in evidence_numbers:
                reasons.append(f"UNSUPPORTED_NUMBER:{value}")
        required = {"summary", "facts", "limitations"}
        if not required.issubset(candidate):
            reasons.append("MISSING_REQUIRED_FIELDS")
        valid_refs = self._evidence_refs(evidence)
        for list_key, item_key in (
            ("facts", "fact_items"),
            ("inferences", "inference_items"),
            ("recommendations", "recommendation_items"),
        ):
            values = candidate.get(list_key) or []
            items = candidate.get(item_key) or []
            if not isinstance(values, list) or not isinstance(items, list):
                reasons.append(f"INVALID_ITEM_ARRAY:{item_key}")
                continue
            if len(values) != len(items):
                reasons.append(f"MISSING_EVIDENCE_ITEMS:{item_key}")
                continue
            if len(values) != len(fallback.get(list_key) or []):
                reasons.append(f"INCOMPLETE_REWRITE:{list_key}")
            for index, (value, item) in enumerate(zip(values, items)):
                if not isinstance(item, dict) or str(item.get("text") or "") != str(value):
                    reasons.append(f"ITEM_TEXT_MISMATCH:{item_key}[{index}]")
                    continue
                refs = item.get("evidence_refs") or []
                if not isinstance(refs, list) or not refs:
                    reasons.append(f"MISSING_EVIDENCE_REFS:{item_key}[{index}]")
                    continue
                unknown = [str(ref) for ref in refs if str(ref) not in valid_refs]
                if unknown:
                    reasons.append(f"UNKNOWN_EVIDENCE_REFS:{item_key}[{index}]:{unknown}")
        if reasons:
            return fallback, {"valid": False, "fallback_used": True, "reasons": sorted(set(reasons))}
        output = {**fallback, **candidate, "grounded_on": "evidence_package"}
        # Safety-critical findings cannot be removed or weakened by a wording
        # model. Candidate limitations may add context, but deterministic
        # risks, review points, disclaimer, and limitations always remain.
        output["risk_notes"] = fallback.get("risk_notes") or []
        output["manual_review_points"] = fallback.get("manual_review_points") or []
        output["limitations"] = list(dict.fromkeys([
            *(str(item) for item in fallback.get("limitations") or []),
            *(str(item) for item in candidate.get("limitations") or []),
        ]))
        output["disclaimer"] = fallback.get("disclaimer")
        return output, {"valid": True, "fallback_used": False, "reasons": []}

    def _numbers(self, text: str) -> list[str]:
        return re.findall(r"(?<![\w])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", text)

    def _structural_counts(self, value: Any) -> set[int]:
        counts: set[int] = set()
        if isinstance(value, dict):
            counts.add(len(value))
            for child in value.values():
                counts.update(self._structural_counts(child))
        elif isinstance(value, list):
            counts.add(len(value))
            for child in value:
                counts.update(self._structural_counts(child))
        return counts

    def _evidence_refs(self, evidence: dict[str, Any]) -> set[str]:
        refs = {
            "solver.status",
            "solver.termination_condition",
            "solver.objective_value",
            "solver.error",
            "model.objective",
            "manual_review_points",
            "risk_notes",
            "metric_context",
        }
        index = evidence.get("evidence_index") or {}
        if isinstance(index, dict):
            for values in index.values():
                if isinstance(values, list):
                    refs.update(str(value) for value in values if value)
        for key in (evidence.get("derived_metrics") or {}):
            refs.add(f"derived_metrics.{key}")
        for index_value, _item in enumerate(evidence.get("constraint_checks") or []):
            refs.add(f"constraint_checks.{index_value}")
        for item in evidence.get("variables_summary") or []:
            if isinstance(item, dict) and item.get("evidence_ref"):
                refs.add(str(item["evidence_ref"]))
        return refs


grounded_output_validator = GroundedOutputValidator()
