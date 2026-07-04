from __future__ import annotations

import math

import pytest
from pyomo.environ import value

from app.builders.component_model_builder import ComponentModelBuilder
from app.components.mccormick import validate_mccormick_spec
from app.solvers.highs_adapter import HiGHSAdapter


def _mccormick_model_spec(bounds: bool = True) -> dict:
    component = {
        "type": "mccormick_bilinear_relaxation_component",
        "x": "x[t]",
        "y": "y[t]",
        "w": "w[t]",
        "indices": [{"set": "time", "alias": "t"}],
        "relaxation_type": "convex_envelope",
    }
    if bounds:
        component.update({"x_lower": 0, "x_upper": 1, "y_lower": 0, "y_upper": 1})
    return {
        "model_code": "mccormick_test",
        "build_mode": "component_based",
        "required_solver_capabilities": ["LP"],
        "sets": [{"code": "time", "values": [0]}],
        "variables": [
            {"name": "x", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 1},
            {"name": "y", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 1},
            {"name": "w", "indices": ["time"], "domain": "NonNegativeReals", "lower_bound": 0, "upper_bound": 1},
        ],
        "components": [component],
        "additional_custom_constraints": [
            {"name": "fix_x", "expression": "x[0] >= 1"},
            {"name": "fix_y", "expression": "y[0] >= 1"},
        ],
        "objective": {
            "sense": "minimize",
            "terms": [{"term_id": "min_w", "weight_key": "mccormick", "expression": "sum(w[t] for t in time)", "supported_by_backend": True, "weight": 1}],
        },
    }


def test_mccormick_rejects_missing_bounds() -> None:
    with pytest.raises(RuntimeError, match="x_lower"):
        validate_mccormick_spec({"x": "x", "y": "y", "w": "w", "x_upper": 1, "y_lower": 0, "y_upper": 1})


def test_mccormick_component_builds_four_constraints() -> None:
    model, context = ComponentModelBuilder().build(_mccormick_model_spec(), {"horizon": 1, "time": [0]})

    constraints = context["metadata"]["mccormick_relaxations"]
    assert constraints[0]["x"] == "x[t]"
    assert "not an exact equality" in constraints[0]["message"]
    names = [name for name in context["constraints"] if "mccormick" in name]
    assert len(names) == 4
    assert all(getattr(model, name).is_indexed() for name in names)


def test_mccormick_model_solves_with_highs() -> None:
    model, context = ComponentModelBuilder().build(_mccormick_model_spec(), {"horizon": 1, "time": [0]})

    result = HiGHSAdapter().solve(model)

    assert result.status == "optimal"
    assert math.isclose(value(model.w[0]), 1.0, abs_tol=1e-6)
    assert context["metadata"]["mccormick_relaxations"][0]["relaxation_type"] == "convex_envelope"
