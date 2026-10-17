"""Reproducible synthetic business acceptance through the public model/task APIs.

Inputs are assumptions for testing, not customer data or market observations.
Run: .venv-mac/bin/python -m tests.review_synthetic_poc --output-dir reports/review_20261017_poc
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
import os
from pathlib import Path
import tempfile
import time

FIXTURES = Path(__file__).parent / "fixtures" / "review_20261017_poc.json"
TOL = 1e-5
MONEY_TOL = 0.02


def generate_cases():
    from app.templates.power_templates import get_template

    ed = deepcopy(get_template("economic_dispatch")["sample_runtime_parameters"])
    ed.update(horizon=24, time=list(range(24)), load_forecast=[155, 150, 145, 145, 150, 165, 185, 210, 230, 240, 235, 230, 220, 215, 220, 230, 245, 260, 255, 240, 215, 190, 175, 160])
    pv = deepcopy(get_template("pv_storage_day_ahead_dispatch_v2")["sample_runtime_parameters"])
    forecast = [round(max(0, 40 * math.sin(math.pi * (t / 4 - 6) / 12)), 5) if 24 <= t <= 72 else 0 for t in range(96)]
    pv.update(horizon=96, time=list(range(96)), time_volume=list(range(97)), terminal_time=96,
              delta_t=0.25, interval_minutes=15, pv_forecast=forecast, grid_limit=[35] * 96,
              schedule=[min(p, 35) for p in forecast], price=[900 if 68 <= t < 84 else 200 for t in range(96)],
              storage_power_capacity=10, storage_energy_capacity=40, initial_soc=20, terminal_soc_target=20,
              soc_min=0.1, soc_max=1, eta_ch=0.95, eta_dis=0.95, deviation_limit=[0] * 96,
              curtailment_penalty=100, storage_cycle_cost=1, degradation_cost_yuan_per_mwh=0,
              weights={"curtailment": 1, "deviation": 0, "deviation_penalty_cost": 0,
                       "storage_cycle": 1, "battery_degradation": 0, "energy_revenue": 1, "terminal_soc": 100000})
    hydro = deepcopy(get_template("cascade_hydro_dispatch")["sample_runtime_parameters"])
    hydro.update(horizon=96, time=list(range(96)), time_volume=list(range(97)), time_step_seconds=900,
                 ramp_smoothing_enabled=False, target_terminal_volume=deepcopy(hydro["initial_volume"]),
                 terminal_storage_mode="hard",
                 load_forecast=[round(320 + 55 * math.sin(2 * math.pi * (t - 20) / 96), 5) for t in range(96)])
    hydro["local_inflow"] = {s: [round(base + 5 * math.sin(2 * math.pi * t / 96), 5) for t in range(96)] for s, base in (("S1", 420), ("S2", 80), ("S3", 60))}
    hydro["availability"] = {u: [0 if u == "S1_U2" and 36 <= t < 64 else 1 for t in range(96)] for u in hydro["unit_pmax"]}
    cases = []

    def add(case_id, family, params, expected="SUCCESS", changes=None):
        inputs = deepcopy(params)
        inputs.update(changes or {})
        cases.append({"case_id": case_id, "family": family, "expected": expected, "parameters": inputs})

    add("ED-24H-normal", "economic", ed)
    add("ED-24H-near-capacity", "economic", ed, changes={"load_forecast": [278] * 24})
    add("ED-24H-infeasible", "economic", ed, "INFEASIBLE", {"load_forecast": [290] * 24})
    add("ED-24H-missing-period", "economic", ed, "INVALID", {"load_forecast": ed["load_forecast"][:-1]})
    add("PV-96QH-arbitrage", "pv_storage", pv)
    add("PV-96QH-grid-congestion", "pv_storage", pv, changes={"grid_limit": [15] * 96, "schedule": [min(p, 15) for p in forecast]})
    add("PV-96QH-invalid-efficiency", "pv_storage", pv, "INVALID", {"eta_ch": 1.1})
    add("HYDRO-96QH-maintenance-delay", "hydro", hydro)
    low_water = {s: [v * 0.6 for v in row] for s, row in hydro["local_inflow"].items()}
    add("HYDRO-96QH-low-inflow", "hydro", hydro, changes={"local_inflow": low_water})
    add("HYDRO-96QH-hard-load-infeasible", "hydro", hydro, "INFEASIBLE", {"load_tracking_mode": "hard", "load_forecast": [1000] * 96})
    add("HYDRO-96QH-duration-conflict", "hydro", hydro, "INVALID", {"time_step_seconds": 3600})
    return {"synthetic": True, "seed": "deterministic-no-randomness", "period": "synthetic 24-hour operating day",
            "units": {"power": "MW", "energy": "MWh", "price": "CNY/MWh", "flow": "m3/s", "volume": "million m3"},
            "tolerances": {"physical_absolute": TOL, "objective_absolute": MONEY_TOL, "optimality_gap": 0.000001}, "cases": cases}


def value(values, name, *indices):
    row = values[name]
    if isinstance(row, (float, int)):
        return float(row)
    suffix = ",".join(map(str, indices))
    for key in (f"{name}[{suffix}]", suffix, name, "None", "null"):
        if key in row:
            return float(row[key])
    if not indices and len(row) == 1:
        return float(next(iter(row.values())))
    raise AssertionError((name, indices, list(row)[:3]))


def economic_check(params, result):
    values = result["variable_values"]
    cost = baseline = residual = bound_violation = ramp_violation = 0.0
    previous = params["initial_unit_output"]
    for t, load in enumerate(params["load_forecast"]):
        dispatch = {u: value(values, "unit_output", u, t) for u in params["unit"]}
        residual = max(residual, abs(sum(dispatch.values()) - load))
        reference = dict(params["unit_min_output"])
        remaining = load - sum(reference.values())
        for u in sorted(params["unit"], key=params["fuel_cost"].get):
            extra = min(remaining, params["unit_max_output"][u] - reference[u])
            reference[u] += extra
            remaining -= extra
        assert abs(remaining) < TOL
        for u, output in dispatch.items():
            bound_violation = max(bound_violation, params["unit_min_output"][u] - output, output - params["unit_max_output"][u])
            ramp_violation = max(ramp_violation, output - previous[u] - params["ramp_up_limit"][u], previous[u] - output - params["ramp_down_limit"][u])
            cost += output * params["fuel_cost"][u]  # hourly periods
            baseline += reference[u] * params["fuel_cost"][u]
        previous = dispatch
    assert max(residual, bound_violation, ramp_violation) < TOL
    assert abs(cost - result["objective_value"]) < MONEY_TOL
    # For these inputs the cheapest-first allocation respects every ramp limit,
    # so it is a closed-form optimum, independent of the model/solver code.
    assert abs(cost - baseline) < MONEY_TOL
    return {"objective": cost, "closed_form_optimum": baseline, "max_power_residual_MW": residual,
            "max_bound_violation_MW": bound_violation, "max_ramp_violation_MW": ramp_violation}


def pv_check(params, result):
    values = result["variable_values"]
    dt = params["delta_t"]
    residual = soc_residual = violation = overlap = revenue = cycle = curtail = baseline = 0.0
    initial = value(values, "soc", 0)
    assert abs(initial - params["initial_soc"]) < TOL
    for t in params["time"]:
        ch, dis, grid, spilled = (value(values, field, t) for field in ("p_ch", "p_dis", "p_grid", "p_pv_curtail"))
        current, following = value(values, "soc", t), value(values, "soc", t + 1)
        residual = max(residual, abs(params["pv_forecast"][t] + dis - ch - grid - spilled))
        soc_residual = max(soc_residual, abs(following - current - dt * (params["eta_ch"] * ch - dis / params["eta_dis"])))
        violation = max(violation, -min(ch, dis, grid, spilled), grid - params["grid_limit"][t], ch - params["storage_power_capacity"], dis - params["storage_power_capacity"], params["soc_min"] * params["storage_energy_capacity"] - following, following - params["soc_max"] * params["storage_energy_capacity"])
        overlap = max(overlap, min(ch, dis))
        revenue += dt * params["price"][t] * grid
        cycle += dt * params["storage_cycle_cost"] * (ch + dis)
        curtail += dt * params["curtailment_penalty"] * spilled
        direct = min(params["pv_forecast"][t], params["grid_limit"][t])
        baseline += dt * (params["curtailment_penalty"] * (params["pv_forecast"][t] - direct) - params["price"][t] * direct)
    terminal_error = abs(value(values, "soc", params["terminal_time"]) - params["terminal_soc_target"])
    independent = cycle + curtail - revenue + params["weights"]["terminal_soc"] * terminal_error
    assert max(residual, soc_residual, violation, overlap, terminal_error) < TOL
    assert abs(independent - result["objective_value"]) < MONEY_TOL
    assert independent < baseline - 1  # improve on a feasible no-battery policy
    return {"objective": independent, "no_battery_policy_objective": baseline, "improvement_CNY": baseline - independent,
            "revenue_CNY": revenue, "cycle_cost_CNY": cycle, "curtailment_cost_CNY": curtail,
            "max_power_residual_MW": residual, "max_SOC_residual_MWh": soc_residual,
            "max_bound_violation": violation, "max_charge_discharge_overlap_MW": overlap, "terminal_SOC_error_MWh": terminal_error}


def hydro_check(params, result):
    values = result["variable_values"]
    dt, dv = params["time_step_seconds"] / 3600, params["time_step_seconds"] / 1_000_000
    water = power = violation = energy = spill = deviation = 0.0
    baseline_q = {s: [] for s in params["station"]}
    baseline_volumes = dict(params["initial_volume"])
    baseline_spill = baseline_deviation = baseline_energy = 0.0
    for s in params["station"]:
        assert abs(value(values, "volume", s, 0) - params["initial_volume"][s]) < TOL
    for t in params["time"]:
        total = baseline_total = 0.0
        for s in params["station"]:
            qg, qs, qo = (value(values, field, s, t) for field in ("q_gen", "q_spill", "q_out"))
            p = value(values, "station_power", s, t)
            capacity = sum(params["unit_pmax"][u] * params["availability"][u][t] for u in params["units"][s])
            inflow = baseline_inflow = params["local_inflow"][s][t]
            for edge in params["edges"]:
                if edge["downstream"] != s:
                    continue
                index = t - edge["delay_periods"]
                history = params["initial_upstream_outflow"][f"{edge['upstream']}->{s}"]
                inflow += history if index < 0 else value(values, "q_out", edge["upstream"], index)
                baseline_inflow += history if index < 0 else baseline_q[edge["upstream"]][index]
            v0, v1 = value(values, "volume", s, t), value(values, "volume", s, t + 1)
            water = max(water, abs(v1 - v0 - (inflow - qo) * dv))
            power = max(power, abs(p - qg * params["power_conversion"][s]), abs(qo - qg - qs))
            violation = max(violation, -min(p, qg, qs), p - capacity, params["volume_min"][s] - v1, v1 - params["volume_max"][s], params["ecological_flow_min"][s] - qo, qo - params["outflow_max"][s], qs - params["spill_max"][s])
            total += p
            spill += qs
            # A water-conserving reference releases exactly incoming water.
            # It holds every reservoir at its initial volume, including the
            # hard terminal target, and spills flow above generation capacity.
            baseline_q[s].append(baseline_inflow)
            bp = min(capacity, baseline_inflow * params["power_conversion"][s])
            baseline_spill += baseline_inflow - bp / params["power_conversion"][s]
            baseline_total += bp
            baseline_volumes[s] += (baseline_inflow - baseline_q[s][t]) * dv
            assert params["outflow_min"][s] <= baseline_q[s][t] <= params["outflow_max"][s]
            assert -TOL <= baseline_q[s][t] - bp / params["power_conversion"][s] <= params["spill_max"][s] + TOL
            assert params["volume_min"][s] - TOL <= baseline_volumes[s] <= params["volume_max"][s] + TOL
        deviation += abs(total - params["load_forecast"][t])
        baseline_deviation += abs(baseline_total - params["load_forecast"][t])
        energy += total * dt
        baseline_energy += baseline_total * dt
    terminal = sum(abs(value(values, "volume", s, 96) - params["target_terminal_volume"][s]) for s in params["station"])
    baseline_terminal = sum(abs(baseline_volumes[s] - params["target_terminal_volume"][s]) for s in params["station"])
    weights = params["weights"]
    def objective(dev, spl, end, generated):
        return weights["load_deviation"] * dev + weights["spill"] * spl + weights["terminal_volume"] * end - (weights["generation"] + weights["revenue"] * params["electricity_price"]) * generated
    independent = objective(deviation, spill, terminal, energy)
    benchmark = objective(baseline_deviation, baseline_spill, baseline_terminal, baseline_energy)
    assert max(water, power, violation) < TOL
    if params["terminal_storage_mode"] == "hard":
        assert terminal < TOL
    assert abs(independent - result["objective_value"]) < MONEY_TOL
    assert independent <= benchmark + MONEY_TOL
    return {"objective": independent, "feasible_water_conserving_policy_objective": benchmark, "generation_MWh": energy,
            "revenue_CNY": energy * params["electricity_price"], "max_water_residual_million_m3": water,
            "max_power_or_outflow_residual": power, "max_bound_violation": violation, "terminal_volume_deviation_million_m3": terminal}


def run_acceptance(api, document, output_dir=None):
    bases = {"economic": "MODEL-POWER-ECONOMIC-DISPATCH", "pv_storage": "MODEL-POWER-PV-STORAGE-DAY-AHEAD-DISPATCH-V2", "hydro": "MODEL-POWER-CASCADE-HYDRO-DISPATCH"}
    ids = {}
    for family, base_id in bases.items():
        base = api.get(f"/api/models/{base_id}")
        assert base.status_code == 200, base.text
        model = base.json()
        payload = {key: deepcopy(model[key]) for key in ("name", "scene", "template_id", "build_mode", "solver", "problem_type", "model_problem_type", "semantic_spec", "generic_spec", "component_spec", "ui_metadata") if key in model}
        payload["name"] = f"Synthetic acceptance {family}"
        params = next(case["parameters"] for case in document["cases"] if case["family"] == family)
        payload["parameters"] = deepcopy(params)
        payload["problem_type"] = payload["model_problem_type"] = "MILP" if family == "pv_storage" else "LP"
        payload["semantic_spec"]["sample_runtime_parameters"] = deepcopy(params)
        for source in (payload, payload.get("semantic_spec", {}), payload.get("component_spec", {}), payload.get("semantic_spec", {}).get("component_spec", {})):
            if source:
                config = source.setdefault("ui_metadata", {}).setdefault("time_dimension", {})
                config.update(default_horizon=params["horizon"], interval_minutes=15 if family != "economic" else 60, delta_t=0.25 if family != "economic" else 1)
                for row in source.get("sets", []):
                    if row.get("code") in {"time", "time_volume"}:
                        row["values"] = list(range(params["horizon"] + int(row["code"] == "time_volume")))
                        if "members" in row:
                            row["members"] = deepcopy(row["values"])
                        row["horizon"] = params["horizon"]
                for row in source.get("parameters", []) if isinstance(source.get("parameters"), list) else []:
                    if row.get("code") in params:
                        row["sample_value"] = deepcopy(params[row["code"]])
        created = api.post("/api/models", json=payload)
        assert created.status_code == 200, created.text
        model_id = created.json()["id"]
        tested = api.post(f"/api/models/{model_id}/test-jobs", json={"parameters": params, "idempotency_key": f"poc-test-{model_id}"})
        assert tested.status_code == 200, tested.text
        task = tested.json()
        deadline = time.monotonic() + 90
        while task["status"] not in {"SUCCESS", "FAILED", "INFEASIBLE", "TIMEOUT"} and time.monotonic() < deadline:
            time.sleep(0.1)
            task = api.get(f"/api/tasks/{task['id']}").json()
        assert task["status"] == "SUCCESS", task
        published = api.post(f"/api/models/{model_id}/publish")
        assert published.status_code == 200, published.text
        ids[family] = model_id

    outcomes = []
    for case in document["cases"]:
        started = time.monotonic()
        response = api.post("/api/tasks", json={"model_id": ids[case["family"]], "parameters": case["parameters"], "async_run": False, "mip_gap": 0.000001, "time_limit_seconds": 60})
        row = {"case_id": case["case_id"], "expected": case["expected"], "http_status": response.status_code, "api_duration_seconds": round(time.monotonic() - started, 4)}
        if case["expected"] == "INVALID":
            assert response.status_code == 422, (case["case_id"], response.text)
            row.update(actual="INVALID", diagnostic=response.json()["detail"])
        else:
            assert response.status_code == 200, (case["case_id"], response.text)
            task = response.json()
            assert task["status"] == case["expected"], (case["case_id"], task)
            result = api.get(f"/api/tasks/{task['id']}/result").json()
            row.update(actual=task["status"], task_id=task["id"], solver=result.get("solver"), termination=result.get("termination_condition"), solve_time_seconds=result.get("solve_time"), model_size=result.get("run_metrics"))
            if case["expected"] == "SUCCESS":
                row["checks"] = {"economic": economic_check, "pv_storage": pv_check, "hydro": hydro_check}[case["family"]](case["parameters"], result)
                row["reported_objective"] = result["objective_value"]
            else:
                assert result.get("objective_value") is None
            if output_dir:
                (output_dir / f"{case['case_id']}.result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        row["passed"] = True
        outcomes.append(row)
        print(f"{case['case_id']}: {row['actual']} (expected {case['expected']})", flush=True)
    report = {"synthetic": True, "customer_acceptance": False, "tolerances": document["tolerances"], "model_ids": ids, "passed": len(outcomes), "total": len(outcomes), "outcomes": outcomes}
    if output_dir:
        (output_dir / "acceptance.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-fixtures", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=Path("reports/review_20261017_poc"))
    args = parser.parse_args()
    # Standalone acceptance never writes to the user's persistent application data.
    with tempfile.TemporaryDirectory(prefix="optiforge-synthetic-poc-") as folder:
        os.environ.update(RUNTIME_STORE_PATH=f"{folder}/runtime.json", OPTIFORGE_RUNTIME_STORE=f"{folder}/runtime.json", LLM_ENABLED="false", OPTIFORGE_SYNC_JOBS="true")
        from fastapi.testclient import TestClient
        from app.main import app
        if args.generate_fixtures:
            FIXTURES.parent.mkdir(parents=True, exist_ok=True)
            FIXTURES.write_text(json.dumps(generate_cases(), ensure_ascii=False, indent=2), encoding="utf-8")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        with TestClient(app) as api:
            report = run_acceptance(api, json.loads(FIXTURES.read_text(encoding="utf-8")), args.output_dir)
        print(json.dumps({"passed": report["passed"], "total": report["total"], "output": str(args.output_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
