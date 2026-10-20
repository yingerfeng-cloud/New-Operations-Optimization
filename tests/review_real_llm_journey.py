"""Opt-in real-provider acceptance with synthetic inputs and an isolated runtime.

Run with explicit RUNTIME_STORE_PATH and OPTIFORGE_LLM_CONFIG_FILE. Credentials
stay in the local file and encrypted runtime. This is not a default pytest test.
"""
from copy import deepcopy
import json
import hashlib
import os
import shutil
import sys
import re
from pathlib import Path
import time
from uuid import uuid4


def main():
    runtime = Path(os.environ["RUNTIME_STORE_PATH"]).resolve()
    private = Path("reports/review_20261020_local/real-llm").resolve()
    if runtime.parent != private or os.environ.get("OPTIFORGE_RUNTIME_STORE") != str(runtime):
        raise RuntimeError("Use only the dedicated ignored real-LLM review runtime")
    skills_copy = private / "agent_skills"
    if not skills_copy.exists():
        shutil.copytree("agent_skills", skills_copy, ignore=shutil.ignore_patterns(".DS_Store"))
    os.environ["OPTIFORGE_AGENT_SKILLS_DIR"] = str(skills_copy)
    from fastapi.testclient import TestClient
    from app.main import app
    from app.storage.memory_store import STORE
    from app.templates.power_templates import get_template
    from tests.review_synthetic_poc import economic_check

    evidence = Path(os.environ.get("OPTIFORGE_REVIEW_EVIDENCE_FILE", "reports/review_20261020_evidence/llm-live-journey.json"))
    evidence.parent.mkdir(parents=True, exist_ok=True)
    resume = "--resume-after-solve" in sys.argv or "--resume-explanation-only" in sys.argv
    report = {"synthetic_inputs": True, "customer_data": False, "real_provider_calls": True, "stages": [], "passed": False}

    if resume:
        report = json.loads(evidence.read_text())
        assert not report["passed"] and any(row["stage"] == "actual_solve" and row["actual_objective"] == 160300 for row in report["stages"])

    def record(label, data):
        report["stages"].append({"stage": label, **data})
        evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"stage": label, **data}, ensure_ascii=False), flush=True)

    def save_private(label, data):
        path = private / f"{label}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        path.chmod(0o600)

    with TestClient(app) as client:
        config_response = client.post("/api/llm/config/import-local")
        assert config_response.status_code == 200, "Local import failed (contents withheld)"
        config = config_response.json()
        report.update(provider=config["provider"], model=config["model"])

        def conversation(title):
            response = client.post("/api/agent/conversations", json={"title": title})
            assert response.status_code == 200
            return response.json()["conversation_id"]

        def turn(cid, label, text):
            start = time.monotonic()
            response = client.post(f"/api/agent/v3/conversations/{cid}/turns", json={"message": text, "client_turn_id": "review-" + uuid4().hex})
            save_private(label, response.json())
            assert response.status_code == 200, f"{label}: HTTP {response.status_code} (private diagnostics retained)"
            data = response.json()
            record(label, {"http_status": response.status_code, "duration_seconds": round(time.monotonic() - start, 3),
                           "tasks": [{"task_id": task["task_id"], "status": task["status"], "workflow": (task.get("result") or {}).get("workflow_state")} for task in data.get("tasks", [])]})
            return data

        if resume:
            solved = next(row for row in report["stages"] if row["stage"] == "actual_solve")
            job = STORE.tasks[solved["task_id"]]
            assert job.status == "SUCCESS" and job.objective_value == 160300
            agent_task_id = report["stages"][0]["tasks"][0]["task_id"]
            cid = STORE.agent_tasks[agent_task_id]["conversation_id"]
            final_approval_id = next(row["approval_id"] for row in STORE.agent_approvals.values() if row["task_id"] == agent_task_id and row["status"] == "APPROVED")
            record("resume_after_solve", {"same_conversation": True, "same_task_id": job.id, "no_recalculation": True})
        else:
            baseline_jobs = set(STORE.tasks)
            cid = conversation("Review 20261020 real LLM synthetic economic dispatch")
            first = turn(cid, "missing_input", "请帮我创建火电机组经济调度优化任务，以发电成本最小为目标。我还没提供机组、负荷和成本参数，请选择合适模型并追问缺少的输入，先不要执行求解。")
            assert len(first.get("tasks", [])) == 1, "Model must invoke the optimization Skill before collecting inputs"
            agent_task_id = first["tasks"][0]["task_id"]
            assert set(STORE.tasks) == baseline_jobs, "No solve before confirmation"
            params = deepcopy(get_template("economic_dispatch")["sample_runtime_parameters"])
            bad = {**params, "load_forecast": params["load_forecast"][:-1]}
            invalid = turn(cid, "invalid_input", "请把以下合成验收参数更新到刚才创建的同一个经济调度优化任务，调用平台检查参数并指出错误；先不要执行求解：" + json.dumps(bad, ensure_ascii=False))
            assert set(STORE.tasks) == baseline_jobs, "Invalid parameters must not start a solve"
            assert any(task["task_id"] == agent_task_id for task in invalid["tasks"]), "Parameter correction must stay on the same task"
            ready = turn(cid, "corrected_input", "更正如下，以下 JSON 是完整合成输入。请使用这些值继续同一个经济调度任务，列出确认信息并等待确认，禁止擅自求解：" + json.dumps(params, ensure_ascii=False))
            assert set(STORE.tasks) == baseline_jobs, "No solve before approval"
            assert any(task["task_id"] == agent_task_id for task in ready["tasks"])
            final_approval_id = None
            for _ in range(3):
                detail = client.get(f"/api/agent/conversations/{cid}").json()
                approvals = detail.get("pending_approvals") or []
                if not approvals:
                    break
                approval = approvals[0]
                final_approval_id = approval["approval_id"]
                action = (approval.get("payload") or {}).get("action")
                response = client.post(f"/api/agent/v3/approvals/{final_approval_id}/resolve", json={"decision": "approve", "comment": "合成验收场景明确确认"})
                save_private(f"approval-{action}", response.json())
                assert response.status_code == 200, f"Approval failed: {response.status_code}"
                record("approval", {"action": action, "status": response.json()["task"]["status"]})
            assert final_approval_id and len(set(STORE.tasks) - baseline_jobs) == 1, "Exactly one solver task after approvals"
            job = STORE.tasks[next(iter(set(STORE.tasks) - baseline_jobs))]
            assert job.status == "SUCCESS", f"Solve was {job.status}"
            result = client.get(f"/api/tasks/{job.id}/result").json()
            for key, expected in params.items():
                assert job.request.parameters.get(key, job.request.payload.get(key)) == expected, f"Input mismatch: {key}"
            checks = economic_check(params, result)
            assert abs(result["objective_value"] - 160300) < 0.02, "Independent known answer is 160300"
            context = job.request.payload.get("_result_context") or {}
            model = STORE.models[job.request.model_id]
            assert context.get("id") == model.id and context.get("content_hash") == model.content_hash
            assert context.get("function_dependencies", {}) == model.function_dependencies
            record("actual_solve", {"task_id": job.id, "status": job.status, "model_id": model.id, "version": model.version,
                "model_content_hash": model.content_hash, "prepared_model_snapshot_sha256": hashlib.sha256(json.dumps(context,sort_keys=True,ensure_ascii=False).encode()).hexdigest(), "function_manifest": {key: {"revision": row["revision"], "content_hash": row["content_hash"]} for key, row in model.function_dependencies.items()},
                "expected_objective": 160300, "actual_objective": result["objective_value"], "independent_checks": checks})
        job_ids = set(STORE.tasks)
        repeated = client.post(f"/api/agent/v3/approvals/{final_approval_id}/resolve", json={"decision": "approve"})
        assert repeated.status_code == 200 and set(STORE.tasks) == job_ids
        record("duplicate_confirmation", {"http_status": 200, "same_solver_task": True})
        explanation = turn(cid, "explanation", "请解释刚才已完成的经济调度结果：给出实际成本、功率平衡和边界约束的含义，并说明模型版本。只解释已有结果，不要新建任务，不要把成本写成利润。")
        text = explanation["message"]["text"]
        assert set(STORE.tasks) == job_ids
        assert "160300" in text.replace(",", "").replace("，", "") or "16.03" in text
        assert "MWh" in text or "兆瓦时" in text
        assert not re.search(r"675\s*MW(?!h)", text, re.IGNORECASE)
        record("grounded_explanation", {"text": text, "no_new_solver_task": True, "energy_unit_verified": True,
            "grounding_audit": explanation.get("turn", {}).get("grounding_audit")})
        if "--resume-explanation-only" in sys.argv:
            assert any(row["stage"] == "cancel" for row in report["stages"])
            assert any(row["stage"] == "provider_failure_recovery" for row in report["stages"])
            report["passed"] = True
            evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            return

        # A deliberate provider configuration fault, restored before retrying.
        # This is labelled injection; successful turns still call the real model.
        fail_cid = conversation("Review provider fault and cancel synthetic task")
        try:
            assert client.put("/api/llm/config", json={"model": "review-nonexistent-model-20261020"}).status_code == 200
            failed = client.post(f"/api/agent/v3/conversations/{fail_cid}/turns", json={"message": "请创建一个火电经济调度优化任务，先收集参数，不要执行求解。", "client_turn_id": "review-provider-fault"})
            save_private("provider-fault", failed.json())
            assert failed.status_code >= 400
        finally:
            assert client.put("/api/llm/config", json={"model": config["model"]}).status_code == 200
        failed_turns = [item for item in STORE.agent_turns.values() if item["conversation_id"] == fail_cid]
        assert len(failed_turns) == 1 and failed_turns[0]["status"] == "FAILED"
        failed_turn = failed_turns[0]
        resumed = client.post(f"/api/agent/v3/turns/{failed_turn['turn_id']}/retry")
        save_private("provider-retry", resumed.json())
        if resumed.status_code == 409:
            # Configuration errors (for example provider 404) are permanent for
            # that recorded attempt. Correct settings and start a new turn.
            data = turn(fail_cid, "provider_recovered_new_turn", "模型配置已修正。请继续创建火电经济调度优化任务，先收集参数，不要执行求解。")
            same_turn = False
            assert STORE.agent_turns[failed_turn["turn_id"]]["status"] == "FAILED"
        else:
            assert resumed.status_code == 200, f"Retry after config correction: HTTP {resumed.status_code}"
            data = resumed.json()
            same_turn = bool(data.get("retried") and data["turn"]["turn_id"] == failed_turn["turn_id"])
            assert same_turn
        assert len(data["tasks"]) == 1
        record("provider_failure_recovery", {"fault_injected": "nonexistent_model", "failure_http_status": failed.status_code,
            "retry_http_status": resumed.status_code, "same_turn_retried": same_turn, "real_model_restored": config["model"],
            "configuration_error_preserved_new_turn_succeeded": not same_turn})
        cancel_id = data["tasks"][0]["task_id"]
        cancelled = client.post(f"/api/agent/v3/tasks/{cancel_id}/cancel")
        assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
        assert set(STORE.tasks) == job_ids
        record("cancel", {"status": "CANCELLED", "no_solve_started": True})
        report["passed"] = True
        evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
