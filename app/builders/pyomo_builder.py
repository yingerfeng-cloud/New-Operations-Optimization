from __future__ import annotations

from typing import Any

from app.builders.cascade_hydro_builder import CascadeHydroDispatchV1Builder
from app.builders.component_model_builder import ComponentModelBuilder
from app.builders.generic_linear_builder import GenericLinearBuilder
from app.builders.nonlinear_hydro_power_builder import NonlinearHydroPowerDemoBuilder
from app.builders.power_template_builder import PowerTemplateBuilder
from app.builders.unit_commitment_builder import build_unit_commitment_model


class PyomoModelBuilder:
    def build(self, model_template: dict[str, Any], runtime_parameters: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        model_code = model_template.get("model_code") or model_template.get("code") or runtime_parameters.get("model_code")
        build_mode = (
            model_template.get("build_mode")
            or runtime_parameters.get("build_mode")
            or model_template.get("semantic_spec", {}).get("build_mode")
        )
        if model_code == "cascade_hydro_dispatch_v1":
            return CascadeHydroDispatchV1Builder().build(model_template, runtime_parameters)
        if model_code == "nonlinear_hydro_power_demo":
            return NonlinearHydroPowerDemoBuilder().build(model_template, runtime_parameters)
        if build_mode == "component_based":
            component_spec = model_template.get("component_spec") or runtime_parameters.get("component_spec") or model_template
            return ComponentModelBuilder().build(component_spec, runtime_parameters)
        if model_code == "unit_commitment_day_ahead":
            return build_unit_commitment_model(runtime_parameters)
        if model_code in {"economic_dispatch", "storage_dispatch", "renewable_storage_dispatch", "chp_dispatch"}:
            return PowerTemplateBuilder().build(str(model_code), runtime_parameters)
        if runtime_parameters.get("generic_spec"):
            return GenericLinearBuilder().build(runtime_parameters["generic_spec"])
        raise RuntimeError(f"Unsupported model template for Pyomo build: {model_code}")
