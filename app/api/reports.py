from __future__ import annotations

from fastapi import APIRouter

from app.services.report_service import ReportExportRequest, report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.post("/export")
def export_report(req: ReportExportRequest) -> dict:
    return report_service.export(req)
