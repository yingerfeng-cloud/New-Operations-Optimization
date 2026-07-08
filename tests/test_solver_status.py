from __future__ import annotations


def test_solver_status_api_returns_highs_and_ipopt_status(client) -> None:
    response = client.get("/api/solvers/status")

    assert response.status_code == 200, response.text
    body = response.json()
    assert "highs" in body
    assert "ipopt" in body
    assert "available" in body["highs"]
    assert "available" in body["ipopt"]
    assert "path" in body["ipopt"]
    assert "version" in body["ipopt"]


def test_solver_status_api_does_not_500_when_ipopt_is_unavailable(client, monkeypatch) -> None:
    from app.api import solvers as solvers_api

    monkeypatch.setattr(
        solvers_api,
        "solver_status",
        lambda: {
            "python": "3.x",
            "highspy_available": True,
            "highs": {"available": True, "version": "1.0"},
            "ipopt": {
                "available": False,
                "path": None,
                "version": None,
                "pyomo_available": False,
                "message": "Ipopt executable not found. NLP solving is unavailable.",
            },
            "status": "FAILED",
            "message": "Ipopt executable not found. NLP solving is unavailable.",
        },
    )

    response = client.get("/api/solvers/status")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["highs"]["available"] is True
    assert body["ipopt"]["available"] is False
    assert "Ipopt executable not found" in body["ipopt"]["message"]
