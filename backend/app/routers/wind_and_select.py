"""
POST /api/wind-and-select

Phase 1 endpoint — runs wind calculation and library section selection together.
Called by Step 3 on first "Run Calculations" click (no confirmed section).

Returns:
  wind_result: full wind chain dict (same fields as WindCalcResult on frontend)
  section_result: flat section + check fields + demand values + source/all_sections
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.calculation.wind import compute_design_pressure
from app.services.section_retrieval import parse_remarks, select_section

router = APIRouter(prefix="/api", tags=["wind-and-select"])


class WindAndSelectRequest(BaseModel):
    structure_height: float = Field(..., gt=0, description="Barrier height ze [m].")
    shelter_factor: float = Field(1.0, ge=0.0, le=1.0, description="ψs — 1.0 = no shelter.")
    vb: float | None = Field(None, gt=0, description="Basic wind velocity override [m/s]. Omit for SG NA 20 m/s.")
    return_period: int = Field(50, ge=1, description="Return period [years].")
    cp_net: float = Field(1.2, gt=0, description="Net pressure coefficient cp,net.")
    terrain_category: str = Field('II', description="EC1-1-4 Table 4.1 terrain category: '0', 'I', 'II', 'III', 'IV'.")
    post_spacing: float = Field(..., gt=0, description="Post spacing (tributary width) [m].")
    subframe_spacing: float = Field(..., gt=0, description="Subframe spacing = Lcr [m].")
    post_length: float = Field(..., gt=0, description="Post length above foundation [m].")
    deflection_limit_n: float = Field(65.0, gt=0, description="Deflection limit denominator n.")
    remarks: str = Field("", description="Optional engineer notes for section search.")


@router.post("/wind-and-select")
def wind_and_select(body: WindAndSelectRequest) -> dict:
    """
    Phase 1: wind calculation + library section selection.
    Phase 2 (foundation/connection/subframe/lifting) runs separately via /api/calculate
    once the engineer confirms the section.
    """
    try:
        wind = compute_design_pressure(
            structure_height=body.structure_height,
            shelter_factor=body.shelter_factor,
            vb=body.vb,
            return_period=body.return_period,
            cp_net=body.cp_net,
            terrain_category=body.terrain_category,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Wind calculation failed: {exc}") from exc

    w_kN_per_m = wind["design_pressure_kPa"] * body.post_spacing
    L_mm = body.post_length * 1000
    M_Ed_kNm = 1.5 * w_kN_per_m * body.post_length ** 2 / 2
    V_Ed_kN = 1.5 * w_kN_per_m * body.post_length
    Lcr_mm = body.subframe_spacing * 1000

    constraints = parse_remarks(body.remarks) if body.remarks.strip() else {}

    try:
        section_raw = select_section(
            M_Ed_kNm=M_Ed_kNm,
            V_Ed_kN=V_Ed_kN,
            w_kN_per_m=w_kN_per_m,
            L_mm=L_mm,
            Lcr_mm=Lcr_mm,
            post_length_m=body.post_length,
            deflection_limit_n=body.deflection_limit_n,
            constraints=constraints,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Section selection failed: {exc}") from exc

    return {
        "wind_result": wind,
        "section_result": {
            **section_raw,
            "M_Ed_kNm": section_raw.get("M_Ed_kNm", M_Ed_kNm),
            "V_Ed_kN": section_raw.get("V_Ed_kN", V_Ed_kN),
            "w_kN_per_m": section_raw.get("w_kN_per_m", w_kN_per_m),
            "L_mm": L_mm,
            "Lcr_mm": Lcr_mm,
        },
    }
