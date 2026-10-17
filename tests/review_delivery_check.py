"""Run only in disposable review containers, before and after recreation."""
import json
import os
import sys

import httpx


def main():
    if os.getenv("OPTIFORGE_REVIEW_ISOLATED") != "1":
        raise RuntimeError("Refusing to change a runtime that is not marked as an isolated review container")
    mode = sys.argv[1]
    token = os.environ["OPTIMIZATION_PLATFORM_API_TOKEN"]
    with httpx.Client(base_url="http://127.0.0.1:8000", headers={"Authorization": f"Bearer {token}"}, timeout=90) as api:
        auth = []
        for supplied in (None, "wrong", token):
            headers = {"Authorization": f"Bearer {supplied}"} if supplied else {"Authorization": ""}
            auth.append(api.get("/api/models", headers=headers).status_code)
        assert auth == [401, 401, 200], auth
        if mode == "prepare":
            solvers = api.get("/api/solvers/status").json()
            assert solvers["ipopt"]["available"], solvers
            params = api.get("/api/templates/nonlinear_hydro_power_demo/sample-runtime-parameters").json()
            response = api.post("/api/models/MODEL-POWER-NONLINEAR-HYDRO-POWER-DEMO/invoke", json={"parameters": params, "options": {"mode": "sync", "explain": False, "time_limit_seconds": 60}})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["status"] == "SUCCESS", result
            result = api.get(f"/api/tasks/{result['task_id']}/result").json()
            assert result["local_optimum_warning"] is True
            values = result["variable_values"]
            residuals = [abs(values["power"][f"power[{t}]"] - params["k"] * values["flow"][f"flow[{t}]"] * values["head"][f"head[{t}]"]) for t in params["time"]]
            assert max(residuals) < 1e-3, residuals
            assert abs(sum(values["power"].values()) - result["objective_value"]) < 1e-3
            saved = api.put("/api/llm/config", json={"provider": "openai_compatible", "enabled": False, "model": "review-disabled", "base_url": "http://127.0.0.1:9/v1", "api_key": "synthetic-review-key"})
            assert saved.status_code == 200, saved.text
            assert saved.json()["api_key_configured"]
            assert "synthetic-review-key" not in saved.text
            assert api.post("/api/models/MODEL-POWER-ECONOMIC-DISPATCH/offline").status_code == 200
            assert api.post("/api/templates/economic_dispatch/unpublish").status_code == 200
            nlp = {"solver": "Ipopt", "termination": result.get("termination_condition"), "objective": result["objective_value"], "max_independent_power_residual": max(residuals), "local_optimum_warning": True}
        else:
            nlp = None
        model = api.get("/api/models/MODEL-POWER-ECONOMIC-DISPATCH").json()
        template = api.get("/api/templates/economic_dispatch").json()
        assert model["status"] == template["status"] == "offline"
        assert api.post("/api/optimize/run", json={"model_code": "economic_dispatch"}).status_code == 409
        config = api.get("/api/llm/config").json()
        assert config["api_key_configured"] is True
        assert config.get("api_key_recovery_error") is None
        from scripts.docker_healthcheck import main as healthcheck
        assert healthcheck() == 0
        print(json.dumps({"mode": mode, "authentication_http_status": auth, "model_status": model["status"], "template_status": template["status"], "llm_key_recovered": True, "healthcheck": "passed", "nlp": nlp}, ensure_ascii=False))


if __name__ == "__main__":
    main()
