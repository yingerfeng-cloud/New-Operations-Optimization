from __future__ import annotations

from app.model_components.formula_components import normalize_component_payload, validate_component_definition


def _component(expression: str, *, variable_domain: str = "NonNegativeReals") -> dict:
    return {
        "component_id": "formula_taskbook_component",
        "sets": [
            {"code": "time", "values": [0, 1]},
            {"code": "unit", "values": ["U1", "U2"]},
            {"code": "storage", "values": ["S1", "S2"]},
        ],
        "variables": [
            {"code": "deviation", "dimension": ["time"], "domain": variable_domain},
            {"code": "unit_output", "dimension": ["unit", "time"], "domain": variable_domain},
            {"code": "soc", "dimension": ["storage", "time"], "domain": variable_domain},
        ],
        "parameters": [
            {"code": "load_forecast", "dimension": ["time"], "default": 1},
        ],
        "constraints": [
            {"constraint_id": "formula_check", "expression": expression, "indices": ["time"]},
        ],
    }


def test_backend_validates_and_compiles_abs_min_max_and_power() -> None:
    expressions = [
        "abs(deviation[t]) >= 0",
        "min(unit_output[u,t] for u in unit) >= 0",
        "max(unit_output[u,t] for u in unit) <= 100",
        "(deviation[t]) ** 2 <= 100",
    ]
    for expression in expressions:
        result = validate_component_definition(_component(expression))
        assert result["valid"], (expression, result["errors"])


def test_backend_validates_and_compiles_scientific_functions_as_nlp() -> None:
    for expression in [
        "log(deviation[t] + 1) <= 5",
        "exp(deviation[t]) >= 1",
        "sqrt(deviation[t] + 1) <= 10",
    ]:
        component = _component(expression)
        result = validate_component_definition(component)
        normalized = normalize_component_payload(component)
        assert result["valid"], (expression, result["errors"])
        assert normalized["expression_class"] == "nonlinear"
        assert normalized["problem_type"] == "NLP"


def test_backend_classifies_qp_and_miqp_without_rejecting_power() -> None:
    qp = normalize_component_payload(_component("(deviation[t]) ** 2 <= 100"))
    miqp = normalize_component_payload(_component("(deviation[t]) ** 2 <= 100", variable_domain="Binary"))
    assert qp["expression_class"] == "quadratic"
    assert qp["problem_type"] == "QP"
    assert miqp["problem_type"] == "MIQP"
