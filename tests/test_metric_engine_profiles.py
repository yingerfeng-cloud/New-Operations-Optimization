from __future__ import annotations

from app.explainers.metric_engine import metric_engine
from app.explainers.profile_loader import profile_loader


PROFILE_NAMES = (
    "storage_dispatch",
    "pv_storage_day_ahead_dispatch",
    "pv_storage_intraday_dispatch",
    "contract_spot_exposure",
    "retail_da_spot_bidding",
)


def test_profiles_are_loadable_and_business_complete():
    for name in PROFILE_NAMES:
        profile = profile_loader.load(name)
        assert profile is not None
        assert profile["profile_name"] == name
        assert len(profile["key_metrics"]) >= 5
        assert len(profile["risk_rules"]) >= 3
        assert len(profile["manual_review_points"]) >= 3
        assert all(
            metric["function"] in metric_engine.BUILTIN_FUNCTIONS
            for metric in profile["key_metrics"]
        )


def test_metric_engine_builtin_functions_and_missing_field_diagnostics():
    profile = {
        "key_metrics": [
            {"name": "energy", "function": "total_energy", "args": ["power"], "time_step_hours": 0.5},
            {"name": "switches", "function": "switch_count", "args": ["power"]},
            {"name": "peak", "function": "max_period", "args": ["series"]},
            {"name": "missing", "function": "sum_value", "args": ["absent"]},
        ]
    }
    metrics, limitations = metric_engine.compute_with_diagnostics(
        profile, {"power": [0, 2, 0, 3], "series": {"t1": 2, "t2": 5}}
    )
    assert metrics["energy"]["value"] == 2.5
    assert metrics["switches"]["value"] == 3
    assert metrics["peak"]["value"] == "t2"
    assert "missing" not in metrics
    assert any("缺少结果字段 absent" in item for item in limitations)


def test_metric_engine_never_accepts_unregistered_function():
    metrics, limitations = metric_engine.compute_with_diagnostics(
        {"key_metrics": [{"name": "bad", "function": "__import__", "args": ["x"]}]},
        {"x": [1]},
    )
    assert metrics == {}
    assert limitations
