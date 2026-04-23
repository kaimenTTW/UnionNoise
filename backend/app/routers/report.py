"""
POST /api/report/generate

Accepts full calculation payload from frontend, returns PDF binary.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.calculation.report import generate_pdf

router = APIRouter(prefix="/api", tags=["report"])


@router.post("/report/generate")
async def generate_report(payload: dict) -> Response:
    """
    Generate PE-format design calculation PDF.

    Request body (JSON):
      project_info:        {project_name, location, barrier_height, barrier_type}
      meta:                {created_by, created_at}
      report_meta:         {job_reference, revision, checked_by}  — all optional
      design_parameters:   full DesignParameters dict from frontend store
      calculation_results: {wind, steel, connection, subframe, lifting, foundation}

    Returns PDF binary with Content-Disposition attachment header.
    """
    try:
        pdf_bytes = generate_pdf(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {exc}") from exc

    project_name = payload.get("project_info", {}).get("project_name", "design_calculation")
    safe_name = re.sub(r"[^\w\-]", "_", project_name).strip("_") or "design_calculation"
    filename = f"design_calculation_{safe_name}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
