from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.agent.agent_skill_schema import AgentSkillState, normalize_agent_skill_v2
from app.services.skill_registry import skill_registry


ROOT = Path(__file__).resolve().parents[1]
AGENT_SKILLS_DIR = ROOT / "agent_skills"

BUSINESS_DISPLAY_NAMES = {
    "economic_dispatch": "经济调度",
    "unit_commitment_day_ahead": "日前机组组合",
    "storage_dispatch": "储能调度",
    "renewable_storage_dispatch": "风光储协同",
    "chp_dispatch": "电热协同",
    "cascade_hydro_dispatch": "梯级水电调度",
    "cascade_hydro_dispatch_v1": "梯级水电调度 v1",
    "pv_storage_day_ahead_dispatch": "光储日前调度",
    "pv_storage_intraday_dispatch": "光储日内调度",
    "pv_storage_dispatch_v2": "光储调度 v2",
    "pv_storage_day_ahead_dispatch_v2": "光储日前调度 v2",
    "pv_storage_intraday_dispatch_v2": "光储日内调度 v2",
    "nonlinear_hydro_power_demo": "非线性水电出力 NLP 试点",
    "contract_spot_exposure_v1": "合约现货暴露控制",
    "retail_da_spot_bidding_v1": "售电公司日前现货申报",
}


class AgentSkillRegistry:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or AGENT_SKILLS_DIR

    def list_skills(self) -> list[dict[str, Any]]:
        records = [self._summary_from_path(path) for path in self._skill_dirs()]
        return sorted(records, key=lambda item: item["name"])

    def get_skill(self, name: str) -> dict[str, Any]:
        return self.load_skill(name)

    def get_skill_local(self, name: str) -> dict[str, Any]:
        return self.load_skill(name, include_api=False, validate=False)

    def load_skill(self, name: str, include_api: bool = True, validate: bool = True) -> dict[str, Any]:
        safe_name = name.strip().replace("\\", "/").split("/")[-1]
        path = self.root / safe_name
        if not path.is_dir():
            raise HTTPException(status_code=404, detail=f"Agent Skill not found: {name}")
        meta = self._read_yaml(path / "skill.yaml")
        meta.setdefault("name", safe_name)
        meta["display_name"] = BUSINESS_DISPLAY_NAMES.get(safe_name, str(meta.get("display_name") or safe_name).replace(" Agent Skill", ""))
        api_skill_name = meta.get("canonical_api_skill_name")
        api_skill = self._safe_api_skill(api_skill_name) if include_api else {}
        examples = self._read_json(path / "examples.json", {})
        instruction = self._read_text(path / "SKILL.md")
        input_schema = self._read_json(path / "input_schema.json", [])
        output_schema = self._read_json(path / "output_schema.json", {})
        if api_skill and not input_schema:
            input_schema = api_skill.get("input_schema", [])
        if api_skill and not output_schema:
            output_schema = api_skill.get("output_schema", {})
        v2 = normalize_agent_skill_v2(meta, input_schema, examples)
        platform_fields = self._platform_fields(api_skill_name, api_skill, input_schema, output_schema)
        return {
            **meta,
            **v2,
            **platform_fields,
            "path": str(path),
            "enabled": v2["state"] == AgentSkillState.ENABLED.value,
            "instruction": instruction,
            "input_schema": input_schema,
            "output_schema": output_schema,
            "examples": examples,
            "sample_parameters": examples.get("sample_parameters") or {},
            "prompts": self._read_prompts(path / "prompts"),
            "api_skill": api_skill,
            "api_skill_available": bool(api_skill),
            "has_instruction": bool(instruction),
            "has_examples": bool(examples),
            "validation": self.validate_skill(safe_name, raise_on_missing=False) if validate else {"status": "unchecked", "errors": []},
        }

    def validate_skill(self, name: str, raise_on_missing: bool = True) -> dict[str, Any]:
        path = self.root / name
        errors: list[dict[str, Any]] = []
        if not path.is_dir():
            errors.append({"code": "missing_directory", "message": f"Agent Skill directory not found: {name}"})
            return self._validation(errors, raise_on_missing)
        if not (path / "SKILL.md").is_file():
            errors.append({"code": "missing_skill_md", "message": "SKILL.md is required"})
        if not (path / "adapter.py").is_file():
            errors.append({"code": "missing_adapter", "message": "adapter.py is required"})
        for prompt_name in ("parameter_collection.md", "default_confirmation.md", "result_explanation.md", "error_handling.md"):
            if not (path / "prompts" / prompt_name).is_file():
                errors.append({"code": "missing_prompt", "message": f"prompts/{prompt_name} is required"})
        for test_name in ("sample_input.json", "missing_parameters.json", "expected_request.json"):
            if not (path / "tests" / test_name).is_file():
                errors.append({"code": "missing_skill_test_fixture", "message": f"tests/{test_name} is required"})
        meta = self._read_yaml(path / "skill.yaml")
        api_skill_name = meta.get("canonical_api_skill_name")
        api_skill = self._safe_api_skill(api_skill_name)
        if not api_skill_name:
            errors.append({"code": "missing_canonical_api_skill_name", "message": "canonical_api_skill_name is required"})
        elif not api_skill:
            errors.append({"code": "missing_api_skill", "message": f"API Skill not found: {api_skill_name}"})
        input_schema = self._read_json(path / "input_schema.json", [])
        api_input_schema = api_skill.get("input_schema", []) if api_skill else []
        if not input_schema:
            errors.append({"code": "missing_input_schema", "message": "input_schema.json must be synced from API Skill"})
        if not self._read_json(path / "output_schema.json", {}):
            errors.append({"code": "missing_output_schema", "message": "output_schema.json must be synced from API Skill"})
        input_keys = {item.get("key") for item in input_schema if isinstance(item, dict)}
        api_keys = {item.get("key") for item in api_input_schema if isinstance(item, dict)}
        if api_skill and input_keys and input_keys != api_keys:
            errors.append({"code": "schema_mismatch", "message": "input_schema.json does not match API Skill input_schema"})
        for key in meta.get("required_parameters") or []:
            if key not in (input_keys or api_keys):
                errors.append({"code": "unknown_required_parameter", "message": f"required parameter is not in input_schema: {key}"})
        examples = self._read_json(path / "examples.json", {})
        if not examples.get("positive_examples"):
            errors.append({"code": "missing_positive_example", "message": "examples.json requires at least one positive example"})
        help_examples = examples.get("help_examples") or []
        if not any(item.get("intent") == "parameter_example" for item in help_examples):
            errors.append({"code": "missing_parameter_example", "message": "examples.json requires one parameter_example"})
        if not examples.get("negative_examples"):
            errors.append({"code": "missing_negative_example", "message": "examples.json requires at least one negative example"})
        try:
            v2 = normalize_agent_skill_v2(meta, input_schema or api_input_schema, examples)
        except Exception as exc:
            errors.append({"code": "invalid_agent_skill_v2", "message": str(exc)})
            v2 = {}
        for field in ("business_domain", "supported_intents", "required_data", "execution_policy", "explanation_profile"):
            if not v2.get(field):
                errors.append({"code": f"missing_{field}", "message": f"Agent Skill v2 requires {field}"})
        if not v2.get("do_not_invoke_examples"):
            errors.append({"code": "missing_do_not_invoke_example", "message": "Agent Skill v2 requires do_not_invoke_examples"})
        if "confirmation_required" not in meta:
            errors.append({"code": "missing_confirmation_required", "message": "confirmation_required is required"})
        api_policy = api_skill.get("execution_policy") if api_skill else None
        agent_policy = (meta.get("execution_policy") or {}).get("mode")
        if api_policy and agent_policy and api_policy != agent_policy:
            errors.append({"code": "execution_policy_conflict", "message": "Agent Skill execution_policy conflicts with API Skill"})
        return self._validation(errors, raise_on_missing)

    def set_state(self, name: str, state: str) -> dict[str, Any]:
        allowed = {item.value for item in AgentSkillState}
        if state not in allowed:
            raise HTTPException(status_code=422, detail=f"Invalid Agent Skill state: {state}")
        if state == AgentSkillState.ENABLED.value:
            validation = self.validate_skill(name, raise_on_missing=False)
            if validation.get("status") != "valid":
                raise HTTPException(status_code=409, detail={"message": "Agent Skill must validate before enable", "validation": validation})
            local = self.load_skill(name, include_api=True, validate=False)
            if local.get("platform_skill_status") != "enabled":
                raise HTTPException(status_code=409, detail="Bound platform Skill is not enabled")
        path = self.root / name / "skill.yaml"
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"Agent Skill not found: {name}")
        lines = path.read_text(encoding="utf-8").splitlines()
        replaced = False
        for index, line in enumerate(lines):
            if line.startswith("state:"):
                lines[index] = f"state: {state}"
                replaced = True
                break
        if not replaced:
            lines.insert(1, f"state: {state}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return self.load_skill(name)

    def sync_schema(self, name: str) -> dict[str, Any]:
        skill = self.load_skill(name)
        api_skill = skill.get("api_skill") or {}
        if not api_skill:
            raise HTTPException(status_code=404, detail=f"Bound API Skill not found: {skill.get('canonical_api_skill_name')}")
        path = self.root / name
        self._write_json(path / "input_schema.json", api_skill.get("input_schema", []))
        self._write_json(path / "output_schema.json", api_skill.get("output_schema", {}))
        return self.load_skill(name)

    def parameter_example(self, name: str) -> dict[str, Any]:
        skill = self.load_skill(name)
        api_skill_name = skill.get("canonical_api_skill_name")
        input_schema = (skill.get("api_skill") or {}).get("input_schema") or skill.get("input_schema", [])
        required = [item for item in input_schema if item.get("key") in set(skill.get("required_parameters") or [])]
        optional = [item for item in input_schema if item.get("key") in set(skill.get("optional_parameters") or [])]
        sample_parameters = self._sample_parameters(input_schema) or skill.get("sample_parameters") or {}
        message = f"以下是{skill.get('display_name') or name}的参数示例。"
        return {
            "response_type": "parameter_example",
            "agent_skill_name": name,
            "api_skill_name": api_skill_name,
            "display_name": skill.get("display_name") or name,
            "required_parameters": required,
            "optional_parameters": optional,
            "sample_parameters": sample_parameters,
            "message": message,
            "agent_message": message,
            "ready_to_invoke": False,
        }

    def _sample_parameters(self, input_schema: list[dict[str, Any]]) -> dict[str, Any]:
        values: dict[str, Any] = {}
        for item in input_schema or []:
            key = item.get("key")
            if not key:
                continue
            value = item.get("sample_value")
            if value is None:
                value = item.get("default_value")
            if value is not None:
                values[key] = value
        return values

    def dry_run(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        result = self.dry_run_request(name, body)
        result["dry_run_mode"] = "request"
        result["message"] = "当前 dry-run 仅校验参数草稿，不执行自然语言解析。"
        return result

    def dry_run_request(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        adapter = self._load_adapter(name)
        if adapter and hasattr(adapter, "build_api_request"):
            return adapter.build_api_request(body.get("parameter_draft") or body.get("parameters") or {}, body.get("confirmed_defaults") or {})
        skill = self.load_skill(name)
        params = body.get("parameter_draft") or body.get("parameters") or {}
        missing = [key for key in skill.get("required_parameters", []) if key not in params]
        if missing:
            return {"ok": False, "missing_parameters": missing}
        return {"ok": True, "api_skill_name": skill.get("canonical_api_skill_name"), "request": {"parameters": params, "options": {"mode": "sync", "explain": True}}}

    def dry_run_dialog(self, name: str, body: dict[str, Any]) -> dict[str, Any]:
        from app.agent.parameter_extractor import parameter_extractor
        from app.agent.skill_router import agent_skill_router
        from app.agent.platform_client import platform_client

        skill = self.load_skill(name)
        message = str(body.get("message") or "")
        route = agent_skill_router.route(message, {"agent_skill_name": name, "resolved_skill_name": skill.get("canonical_api_skill_name")}, self.list_skills())
        extracted = parameter_extractor.extract(message, skill.get("input_schema", []))
        analysis = platform_client.analyze_input(skill.get("canonical_api_skill_name"), extracted)
        request_preview = self.dry_run_request(name, {"parameters": analysis.get("normalized_parameters", extracted)})
        return {
            "intent": route.get("intent"),
            "agent_skill_name": name,
            "api_skill_name": skill.get("canonical_api_skill_name"),
            "extracted_parameters": extracted,
            "missing_required": analysis.get("missing_required", []),
            "invalid_parameters": analysis.get("invalid_parameters", []),
            "can_use_default": analysis.get("can_use_default", []),
            "requires_default_confirmation": analysis.get("requires_default_confirmation", False),
            "request_preview": request_preview,
        }

    def create_from_api_skill(self, api_skill_name: str, agent_skill_name: str | None = None) -> dict[str, Any]:
        api_skill = skill_registry.get_skill(api_skill_name)
        name = agent_skill_name or str(api_skill.get("model_code") or api_skill_name.removeprefix("run_"))
        target = self.root / name
        target.mkdir(parents=True, exist_ok=True)
        template = self.root / "economic_dispatch"
        if template.is_dir() and name != "economic_dispatch":
            for item in ("prompts",):
                src = template / item
                dst = target / item
                if src.is_dir() and not dst.exists():
                    shutil.copytree(src, dst)
                elif src.is_file() and not dst.exists():
                    shutil.copy2(src, dst)
        if not (target / "skill.yaml").exists():
            self._write_text(target / "skill.yaml", self._default_skill_yaml(name, api_skill))
        if not (target / "SKILL.md").exists():
            display_name = api_skill.get("display_name") or name
            self._write_text(
                target / "SKILL.md",
                f"# {display_name} Agent Skill\n\n"
                "Use this skill to collect parameters, require explicit user confirmation, invoke the bound platform Skill, "
                "and explain optimization results as advisory-only analysis requiring human review.\n",
            )
        if not (target / "adapter.py").exists():
            self._write_text(target / "adapter.py", self._default_adapter_py(api_skill))
        if not (target / "examples.json").exists():
            sample = self._sample_parameters(api_skill.get("input_schema", []))
            self._write_json(
                target / "examples.json",
                {
                    "positive_examples": [{"user": f"做{api_skill.get('display_name') or name}", "intent": "optimization_request", "expected_skill": name}],
                    "help_examples": [{"intent": "parameter_example", "text": "show parameter example"}],
                    "negative_examples": [{"user": "你好", "intent": "casual_chat"}],
                    "sample_parameters": sample,
                },
            )
        self._write_json(target / "input_schema.json", api_skill.get("input_schema", []))
        self._write_json(target / "output_schema.json", api_skill.get("output_schema", {}))
        self._write_agent_skill_tests(target, api_skill)
        validation = self.validate_skill(name, raise_on_missing=False)
        if validation.get("status") != "valid":
            self._write_text(target / "skill.yaml", self._default_skill_yaml(name, api_skill, enabled=False))
        return self.load_skill(name)

    def _summary(self, skill: dict[str, Any]) -> dict[str, Any]:
        validation = skill.get("validation") or {}
        return {
            "name": skill.get("name"),
            "display_name": BUSINESS_DISPLAY_NAMES.get(str(skill.get("name")), str(skill.get("display_name") or skill.get("name") or "").replace(" Agent Skill", "")),
            "canonical_api_skill_name": skill.get("canonical_api_skill_name"),
            "api_skill_available": skill.get("api_skill_available"),
            "enabled": skill.get("enabled", True),
            "schema_version": skill.get("schema_version"),
            "state": skill.get("state"),
            "business_domain": skill.get("business_domain"),
            "supported_intents": skill.get("supported_intents") or [],
            "business_goals": skill.get("business_goals") or [],
            "positive_examples": skill.get("positive_examples") or [],
            "negative_examples": skill.get("negative_examples") or [],
            "do_not_invoke_examples": skill.get("do_not_invoke_examples") or [],
            "explanation_profile": skill.get("explanation_profile"),
            "trigger_intents": skill.get("trigger_intents") or [],
            "required_parameters": skill.get("required_parameters") or [],
            "optional_parameters": skill.get("optional_parameters") or [],
            "has_instruction": skill.get("has_instruction"),
            "has_examples": skill.get("has_examples"),
            "validation_status": validation.get("status", "invalid"),
        }

    def _summary_from_path(self, path: Path) -> dict[str, Any]:
        meta = self._read_yaml(path / "skill.yaml")
        name = str(meta.get("name") or path.name)
        api_skill_name = meta.get("canonical_api_skill_name")
        input_schema = self._read_json(path / "input_schema.json", [])
        output_schema = self._read_json(path / "output_schema.json", {})
        required_parameters = meta.get("required_parameters") or [
            item.get("key")
            for item in input_schema
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is not False
        ]
        optional_parameters = meta.get("optional_parameters") or [
            item.get("key")
            for item in input_schema
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is False
        ]
        has_instruction = (path / "SKILL.md").is_file()
        has_examples = (path / "examples.json").is_file()
        examples = self._read_json(path / "examples.json", {})
        v2 = normalize_agent_skill_v2(meta, input_schema, examples)
        validation_status = self.validate_skill(name, raise_on_missing=False).get("status", "invalid")
        return {
            "name": name,
            "display_name": BUSINESS_DISPLAY_NAMES.get(name, str(meta.get("display_name") or name).replace(" Agent Skill", "")),
            "canonical_api_skill_name": api_skill_name,
            **self._platform_fields(api_skill_name, self._safe_api_skill(api_skill_name), input_schema, output_schema),
            "api_skill_available": bool(api_skill_name),
            "enabled": v2["state"] == AgentSkillState.ENABLED.value,
            "schema_version": v2["schema_version"],
            "state": v2["state"],
            "business_domain": v2["business_domain"],
            "model_family": v2["model_family"],
            "supported_intents": v2["supported_intents"],
            "business_goals": v2["business_goals"],
            "positive_examples": v2["positive_examples"],
            "negative_examples": v2["negative_examples"],
            "do_not_invoke_examples": v2["do_not_invoke_examples"],
            "required_data": v2["required_data"],
            "parameter_policy": v2["parameter_policy"],
            "intent_policy": v2["intent_policy"],
            "execution_policy": v2["execution_policy"],
            "explanation_profile": v2["explanation_profile"],
            "safety_policy": v2["safety_policy"],
            "trigger_intents": meta.get("trigger_intents") or [],
            "scenario_tags": meta.get("scenario_tags") or [],
            "required_parameters": [item for item in required_parameters if item],
            "optional_parameters": [item for item in optional_parameters if item],
            "has_instruction": has_instruction,
            "has_examples": has_examples,
            "validation_status": validation_status,
        }

    def _platform_fields(
        self,
        api_skill_name: str | None,
        api_skill: dict[str, Any] | None,
        input_schema: list[dict[str, Any]],
        output_schema: Any,
    ) -> dict[str, Any]:
        api_skill = api_skill or {}
        api_input = api_skill.get("input_schema") or []
        api_output = api_skill.get("output_schema") or {}
        schema_sync_status = "unknown"
        if api_skill_name and api_skill:
            local_keys = {item.get("key") for item in input_schema or [] if isinstance(item, dict)}
            api_keys = {item.get("key") for item in api_input or [] if isinstance(item, dict)}
            schema_sync_status = "synced" if local_keys == api_keys and bool(output_schema) == bool(api_output) else "out_of_sync"
        elif api_skill_name:
            schema_sync_status = "platform_skill_missing"
        return {
            "platform_skill_name": api_skill_name,
            "model_id": api_skill.get("model_id"),
            "model_code": api_skill.get("model_code"),
            "model_version": api_skill.get("model_version") or api_skill.get("version"),
            "schema_sync_status": schema_sync_status,
            "platform_skill_status": api_skill.get("skill_status"),
        }

    def _skill_dirs(self) -> list[Path]:
        if not self.root.exists():
            return []
        return [path for path in self.root.iterdir() if path.is_dir() and (path / "skill.yaml").is_file()]

    def _safe_api_skill(self, api_skill_name: str | None) -> dict[str, Any]:
        if not api_skill_name:
            return {}
        try:
            return skill_registry.get_skill(str(api_skill_name))
        except Exception:
            try:
                from app.agent.platform_client import platform_client

                return platform_client.get_skill(str(api_skill_name))
            except Exception:
                return {}

    def _read_yaml(self, path: Path) -> dict[str, Any]:
        if not path.is_file():
            return {}
        data: dict[str, Any] = {}
        stack: list[tuple[int, Any]] = [(-1, data)]
        last_key_at_indent: dict[int, str] = {}
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip() or raw.lstrip().startswith("#"):
                continue
            indent = len(raw) - len(raw.lstrip(" "))
            line = raw.strip()
            while stack and indent <= stack[-1][0]:
                stack.pop()
            container = stack[-1][1]
            if line.startswith("- "):
                value = self._parse_scalar(line[2:].strip())
                if isinstance(container, list):
                    container.append(value)
                continue
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            key = key.strip()
            value = value.strip()
            if value:
                container[key] = self._parse_scalar(value)
            else:
                next_container: Any = {} if key in {
                    "business_domain",
                    "parameter_policy",
                    "intent_policy",
                    "execution_policy",
                    "safety_policy",
                    "result_explanation",
                    "error_handling",
                } else []
                container[key] = next_container
                stack.append((indent, next_container))
                last_key_at_indent[indent] = key
        for key, value in list(data.items()):
            if isinstance(value, list) and key in {"confirmation_required", "execution_policy", "result_explanation", "error_handling"}:
                data[key] = {}
        return data

    def _parse_scalar(self, value: str) -> Any:
        if value in {"true", "True"}:
            return True
        if value in {"false", "False"}:
            return False
        if value in {"null", "None"}:
            return None
        if value.startswith("[") or value.startswith("{"):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value.strip('"').strip("'")

    def _read_json(self, path: Path, default: Any) -> Any:
        if not path.is_file():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail=f"Invalid JSON in {path}: {exc}") from exc

    def _read_text(self, path: Path) -> str:
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def _read_prompts(self, path: Path) -> dict[str, str]:
        if not path.is_dir():
            return {}
        return {item.stem: item.read_text(encoding="utf-8") for item in path.glob("*.md")}

    def _write_json(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")

    def _write_text(self, path: Path, value: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def _default_skill_yaml(self, name: str, api_skill: dict[str, Any], enabled: bool = True) -> str:
        required = [
            item.get("key")
            for item in api_skill.get("input_schema", [])
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is not False
        ]
        optional = [
            item.get("key")
            for item in api_skill.get("input_schema", [])
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is False
        ]
        lines = [
            'schema_version: "2.0"',
            f"name: {name}",
            f"agent_skill_name: {name}",
            f"display_name: {api_skill.get('display_name') or name}",
            f"canonical_api_skill_name: {api_skill.get('skill_name')}",
            f"platform_skill_name: {api_skill.get('skill_name')}",
            "state: draft",
            "enabled: false",
            f"business_domain: {api_skill.get('model_code') or name}",
            "model_family: optimization",
            "supported_intents: [\"optimization_run\", \"parameter_check\", \"result_explanation\"]",
            "business_goals: [\"optimize\"]",
            f"explanation_profile: {api_skill.get('model_code') or name}",
            "confirmation_required: true",
            "execution_policy:",
            "  mode: advisory_only",
            "required_parameters:",
        ]
        lines.extend(f"  - {item}" for item in required)
        lines.append("optional_parameters:")
        lines.extend(f"  - {item}" for item in optional)
        lines.append("trigger_intents:")
        lines.extend(f"  - {name}" for _ in [0])
        return "\n".join(lines) + "\n"

    def _default_adapter_py(self, api_skill: dict[str, Any]) -> str:
        required = [
            item.get("key")
            for item in api_skill.get("input_schema", [])
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is not False
        ]
        optional = [
            item.get("key")
            for item in api_skill.get("input_schema", [])
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is False
        ]
        return (
            "from __future__ import annotations\n\n"
            "from typing import Any\n\n\n"
            f"REQUIRED_PARAMETERS = {json.dumps(required, ensure_ascii=False)}\n"
            f"OPTIONAL_PARAMETERS = {json.dumps(optional, ensure_ascii=False)}\n"
            f"API_SKILL_NAME = {json.dumps(api_skill.get('skill_name'), ensure_ascii=False)}\n\n\n"
            "def build_api_request(parameter_draft: dict[str, Any], confirmed_defaults: dict[str, Any] | None = None) -> dict[str, Any]:\n"
            "    confirmed_defaults = confirmed_defaults or {}\n"
            "    parameter_draft = parameter_draft or {}\n"
            "    missing = [key for key in REQUIRED_PARAMETERS if key not in parameter_draft]\n"
            "    if missing:\n"
            "        return {\"ok\": False, \"missing_parameters\": missing}\n"
            "    parameters = {key: parameter_draft[key] for key in REQUIRED_PARAMETERS}\n"
            "    for key in OPTIONAL_PARAMETERS:\n"
            "        if key in parameter_draft:\n"
            "            parameters[key] = parameter_draft[key]\n"
            "        elif key in confirmed_defaults:\n"
            "            parameters[key] = confirmed_defaults[key]\n"
            "    return {\"ok\": True, \"api_skill_name\": API_SKILL_NAME, \"request\": {\"parameters\": parameters, \"options\": {\"mode\": \"sync\", \"explain\": True}}}\n"
        )

    def _write_agent_skill_tests(self, target: Path, api_skill: dict[str, Any]) -> None:
        sample = self._sample_parameters(api_skill.get("input_schema", []))
        required = [
            item.get("key")
            for item in api_skill.get("input_schema", [])
            if isinstance(item, dict) and item.get("key") and item.get("required", True) is not False
        ]
        missing = dict(sample)
        if required:
            missing.pop(str(required[0]), None)
        self._write_json(target / "tests" / "sample_input.json", sample)
        self._write_json(target / "tests" / "missing_parameters.json", missing)
        self._write_json(
            target / "tests" / "expected_request.json",
            {
                "ok": True,
                "api_skill_name": api_skill.get("skill_name"),
                "request": {"parameters": sample, "options": {"mode": "sync", "explain": True}},
            },
        )

    def _load_adapter(self, name: str) -> Any:
        path = self.root / name / "adapter.py"
        if not path.is_file():
            return None
        spec = importlib.util.spec_from_file_location(f"agent_skill_adapter_{name}", path)
        if not spec or not spec.loader:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _validation(self, errors: list[dict[str, Any]], raise_on_missing: bool) -> dict[str, Any]:
        result = {"status": "valid" if not errors else "invalid", "errors": errors}
        if errors and raise_on_missing:
            raise HTTPException(status_code=422, detail=result)
        return result


agent_skill_registry = AgentSkillRegistry()
