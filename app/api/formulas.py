from __future__ import annotations

from fastapi import APIRouter

from app.formulas.service import analyze_formula
from app.schemas.formula import FormulaAnalyzeRequest


router = APIRouter(prefix="/api/formulas", tags=["formulas"])


@router.post("/parse")
def parse_formula(request: FormulaAnalyzeRequest) -> dict:
    return analyze_formula(request, compile_requested=False)


@router.post("/validate")
def validate_formula(request: FormulaAnalyzeRequest) -> dict:
    return analyze_formula(request, compile_requested=False)


@router.post("/compile")
def compile_formula(request: FormulaAnalyzeRequest) -> dict:
    return analyze_formula(request, compile_requested=True)


@router.post("/expand")
def expand_formula(request: FormulaAnalyzeRequest) -> dict:
    return analyze_formula(request, compile_requested=True, expand_requested=True)


@router.post("/analyze")
def analyze_formula_endpoint(request: FormulaAnalyzeRequest) -> dict:
    return analyze_formula(request, compile_requested=True)

