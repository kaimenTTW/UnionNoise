"""
POST /api/select-section

AI-assisted steel section retrieval. Computes design demand from wind + geometry,
then calls the section retrieval service (Claude web search + library fallback).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.calculation.wind import compute_design_pressure
from app.services.section_retrieval import select_section

router = APIRouter(prefix="/api", tags=["select-section"])


class SelectSectionRequest(BaseModel):
    # Wind
    structure_height: float = Field(..., gt=0, description="Barrier height ze [m].")
    shelter_factor: float = Field(1.0, ge=0.0, le=1.0, description="psi_s — 1.0 = no shelter.")
    vb: float | None = Field(None, gt=0, description="Basic wind velocity [m/s]. Omit for SG NA 20 m/s.")
    return_period: int = Field(50, ge=1, description="Return period [years].")
    cp_net: float = Field(1.2, gt=0, description="Net pressure coefficient cp,net.")

    # Post geometry
    post_spacing: float = Field(..., gt=0, description="Post spacing (tributary width) [m].")
    subframe_spacing: float = Field(..., gt=0, description="Subframe spacing = Lcr for LTB [m].")
    post_length: float = Field(..., gt=0, description="Post length above foundation [m].")
    deflection_limit_n: float = Field(65.0, gt=0, description="Deflection limit denominator n.")

    # Engineer remarks
    remarks: str = Field("", description="Optional additional considerations for section search.")


class SelectSectionResponse(BaseModel):
    designation: str | None = None
    mass_kg_per_m: float | None = None
    source: str | None = None      # "live" | "cache"
    fallback_reason: str | None = None
    M_Ed_kNm: float | None = None
    V_Ed_kN: float | None = None
    w_kN_per_m: float | None = None
    Mb_Rd_kNm: float | None = None
    UR_moment: float | None = None
    UR_deflection: float | None = None
    UR_shear: float | None = None
    fy_N_per_mm2: float | None = None
    all_sections: list[dict] | None = None
    pass_: bool = Field(False, alias="pass")
    error: str | None = None

    class Config:
        populate_by_name = True


@router.post("/select-section", response_model=SelectSectionResponse)
async def select_section_endpoint(body: SelectSectionRequest) -> SelectSectionResponse:
    """
    Compute design demand from wind inputs, then select the lightest passing UB section
    via Claude web search (fallback: grade-specific parts library cache).
    """
    try:
        wind = compute_design_pressure(
            structure_height=body.structure_height,
            shelter_factor=body.shelter_factor,
            vb=body.vb,
            return_period=body.return_period,
            cp_net=body.cp_net,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Wind calculation failed: {exc}") from exc

    w_kN_per_m = wind["design_pressure_kPa"] * body.post_spacing
    L_mm = body.post_length * 1000
    M_Ed_kNm = 1.5 * w_kN_per_m * body.post_length ** 2 / 2
    V_Ed_kN = 1.5 * w_kN_per_m * body.post_length
    Lcr_mm = body.subframe_spacing * 1000

    try:
        result = await select_section(
            M_Ed_kNm=M_Ed_kNm,
            V_Ed_kN=V_Ed_kN,
            w_kN_per_m=w_kN_per_m,
            L_mm=L_mm,
            Lcr_mm=Lcr_mm,
            post_length_m=body.post_length,
            deflection_limit_n=body.deflection_limit_n,
            remarks=body.remarks,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Section selection failed: {exc}") from exc

    if "error" in result and not result.get("designation"):
        return SelectSectionResponse(**{"pass": False, "error": result["error"]})

    return SelectSectionResponse(**{
        **result,
        "pass": result.get("pass", False),
        "M_Ed_kNm": M_Ed_kNm,
        "V_Ed_kN": V_Ed_kN,
        "w_kN_per_m": w_kN_per_m,
    })
