from __future__ import annotations

from fastapi import APIRouter

from app.solvers.status import solver_status


router = APIRouter(prefix="/api/solvers", tags=["solvers"])


@router.get("/status")
def get_solver_status() -> dict:
    return solver_status()
