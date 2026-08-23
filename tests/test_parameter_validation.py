import unittest
from copy import deepcopy

from app.semantic.semantic_validator import RuntimeParameterValidator
from app.services.invocation_service import InvocationService
from app.services.template_service import template_library


class TestParameterValidation(unittest.TestCase):
    def test_length_error_is_structured(self) -> None:
        template = template_library.get_template("economic_dispatch")
        params = template_library.sample_runtime_parameters("economic_dispatch")
        params["load_forecast"] = [1, 2]
        errors = RuntimeParameterValidator().validate(template, params)
        self.assertTrue(any(item["error"] == "length mismatch" for item in errors))

    def test_required_nested_values_reject_blank_leaves_but_accept_zero(self) -> None:
        template = template_library.get_template("compute_power_coordination_day_ahead_v1")
        sample = template_library.sample_runtime_parameters("compute_power_coordination_day_ahead_v1")
        validator = RuntimeParameterValidator()

        for field in ("workload", "cluster", "time_labels", "cluster_compatibility", "execution_cost"):
            with self.subTest(field=field):
                params = deepcopy(sample)
                if field in {"workload", "cluster", "time_labels"}:
                    params[field][0] = ""
                else:
                    outer = next(iter(params[field]))
                    inner = next(iter(params[field][outer]))
                    params[field][outer][inner] = ""
                errors = validator.validate(template, params)
                self.assertTrue(any(item["field"] == field and item["error"] == "blank required parameter" for item in errors))

        valid = deepcopy(sample)
        valid["cluster_compatibility"]["inference"]["training_gpu_b"] = 0
        valid["execution_cost"]["urgent_training"]["realtime_gpu"] = 0
        self.assertEqual(validator.validate(template, valid), [])

    def test_compute_power_contract_owns_sets_and_generates_time_labels(self) -> None:
        template = template_library.get_template("compute_power_coordination_day_ahead_v1")
        config = template["ui_metadata"]["time_dimension"]
        self.assertEqual(config["label_set"], "time_labels")
        self.assertEqual(config["label_generation"], "auto")
        self.assertEqual(config["label_format"], "HH:mm")

        schema = {item["key"]: item for item in InvocationService().input_schema(template)}
        self.assertEqual(schema["workload"]["field_role"], "set_members")
        self.assertFalse(schema["workload"]["runtime_editable"])
        self.assertEqual(schema["cluster"]["source_system"], "resource_manager")
        self.assertEqual(schema["time_labels"]["field_role"], "time_labels")
        self.assertFalse(schema["time_labels"]["runtime_editable"])

    def test_fixed_runtime_set_members_cannot_be_changed(self) -> None:
        template = template_library.get_template("compute_power_coordination_day_ahead_v1")
        params = template_library.sample_runtime_parameters("compute_power_coordination_day_ahead_v1")
        params["workload"] = ["renamed", *params["workload"][1:]]
        errors = RuntimeParameterValidator().validate(template, params)
        self.assertTrue(any("集合 workload 由模型契约固定" in item["error"] for item in errors))

    def test_runtime_editable_set_requires_exact_dependent_mapping_keys(self) -> None:
        spec = {
            "build_mode": "component_based",
            "sets": [{"code": "workload", "values": ["a", "b"], "runtime_editable": True}],
            "parameters": [
                {"code": "workload", "dimension": ["workload"], "required": True, "validation": {"type": "array"}},
                {"code": "cost", "dimension": ["workload"], "required": True, "validation": {"type": "dict"}},
            ],
            "component_spec": {"sets": [{"code": "workload", "values": ["a", "b"], "runtime_editable": True}], "parameters": []},
        }
        errors = RuntimeParameterValidator().validate(spec, {"workload": ["renamed", "b"], "cost": {"a": 1, "b": 2}})
        self.assertTrue(any("workload 索引与集合定义不一致" in item["error"] and "缺少 renamed" in item["error"] for item in errors))
