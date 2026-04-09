"""
POST /api/calculate

Full design chain: wind → steel section selection → foundation checks.
Returns structured results for all three modules.

All engineering formulas in backend/app/calculation/. See code-reference.md.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.calculation.foundation import compute_foundation
from app.calculation.steel import compute_steel_design
from app.calculation.wind import compute_design_pressure

router = APIRouter(prefix="/api", tags=["calculate"])


# ── Request model ─────────────────────────────────────────────────────────────

class CalculateRequest(BaseModel):
    # Wind
    structure_height: float = Field(..., description="Barrier height ze [m]. Drives qp calculation.")
    shelter_factor: float = Field(1.0, ge=0.0, le=1.0, description="ψs — 1.0 = no shelter. Use 0.5 for P105 validation.")

    # Steel post
    post_spacing: float = Field(..., gt=0, description="Post spacing (tributary width) [m].")
    subframe_spacing: float = Field(..., gt=0, description="Subframe spacing = Lcr for LTB [m].")
    post_length: float = Field(..., gt=0, description="L above foundation level [m]. T1: 11m, T2: 12.7m.")

    # Foundation
    footing_type: Literal["Exposed pad", "Embedded RC"] = Field(
        ..., description="Footing type — drives which foundation branch executes."
    )
    phi_k: float = Field(30.0, ge=0, le=50, description="Soil friction angle φk [degrees].")
    gamma_s: float = Field(20.0, gt=0, description="Soil unit weight γs [kN/m³].")
    cohesion_ck: float = Field(0.0, ge=0, description="Soil cohesion c'k [kPa].")
    allowable_soil_bearing: float = Field(75.0, gt=0, description="q_allow for exposed pad bearing [kPa].")

    # Footing geometry
    footing_B: float = Field(..., gt=0, description="Footing width in wind direction [m].")
    footing_W: float = Field(..., gt=0, description="Footing width perpendicular to wind [m].")
    footing_D: float = Field(0.0, ge=0, description="Embedment depth [m]. 0 for exposed pad.")

    # Vertical load
    vertical_load_G_kN: float = Field(
        ..., gt=0,
        description="Permanent vertical load — self-weight of post + footing [kN]."
    )


# ── Response models ───────────────────────────────────────────────────────────

class WindResult(BaseModel):
    ze_m: float
    cr: float
    vm_m_per_s: float
    Iv: float
    qp_N_per_m2: float
    qp_kPa: float
    cp_net: float
    shelter_factor: float
    design_pressure_kPa: float


class SteelResult(BaseModel):
    designation: str | None = None
    mass_kg_per_m: float | None = None
    w_kN_per_m: float | None = None
    M_Ed_kNm: float | None = None
    V_Ed_kN: float | None = None
    Mpl_kNm: float | None = None
    Mcr_kNm: float | None = None
    lambda_bar_LT: float | None = None
    phi_LT: float | None = None
    chi_LT: float | None = None
    Mb_Rd_kNm: float | None = None
    UR_moment: float | None = None
    delta_mm: float | None = None
    delta_allow_mm: float | None = None
    UR_deflection: float | None = None
    Lcr_mm: float | None = None
    post_length_m: float | None = None
    pass_: bool = Field(False, alias="pass")
    error: str | None = None

    class Config:
        populate_by_name = True


class FoundationResult(BaseModel):
    footing_type: str
    inputs: dict
    SLS: dict
    DA1_C1: dict
    DA1_C2: dict
    pass_: bool = Field(..., alias="pass")

    class Config:
        populate_by_name = True


class CalculateResponse(BaseModel):
    wind: WindResult
    steel: SteelResult
    foundation: FoundationResult


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/calculate", response_model=CalculateResponse)
def calculate(body: CalculateRequest) -> CalculateResponse:
    """
    Run the full design chain:
    1. Wind pressure (EC1 + SG NA)
    2. Steel post selection from parts library (EC3 LTB + deflection)
    3. Foundation checks (EC7 DA1-C1, DA1-C2, SLS)

    P105 T1 validation inputs:
      structure_height=12.7, shelter_factor=0.5, post_spacing=3.0,
      subframe_spacing=1.5, post_length=11.0, footing_type="Exposed pad",
      footing_B=<from PE report>, footing_W=<from PE report>,
      vertical_load_G_kN=<footing+post weight from PE report>
    """
    # ── 1. Wind ──
    try:
        wind_raw = compute_design_pressure(
            structure_height=body.structure_height,
            shelter_factor=body.shelter_factor,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Wind calculation failed: {exc}") from exc

    wind_result = WindResult(**wind_raw)

    # ── 2. Steel ──
    try:
        steel_raw = compute_steel_design(
            design_pressure_kPa=wind_raw["design_pressure_kPa"],
            post_spacing_m=body.post_spacing,
            subframe_spacing_m=body.subframe_spacing,
            post_length_m=body.post_length,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Steel calculation failed: {exc}") from exc

    if "error" in steel_raw:
        steel_result = SteelResult(**{"pass": False, "error": steel_raw["error"]})
    else:
        steel_result = SteelResult(**{**steel_raw})

    # ── 3. Foundation ──
    # Derive SLS forces from steel calculation:
    # H_SLS = w × L (unfactored — divide ULS V_Ed by γQ = 1.5)
    # M_SLS = w × L² / 2 (unfactored — divide ULS M_Ed by γQ = 1.5)
    if steel_raw.get("V_Ed_kN") and steel_raw.get("M_Ed_kNm"):
        H_SLS = steel_raw["V_Ed_kN"] / 1.5
        M_SLS = steel_raw["M_Ed_kNm"] / 1.5
    else:
        # Fallback: compute directly from wind UDL
        w = wind_raw["design_pressure_kPa"] * body.post_spacing
        H_SLS = w * body.post_length
        M_SLS = w * body.post_length ** 2 / 2

    try:
        foundation_raw = compute_foundation(
            H_SLS_kN=H_SLS,
            M_SLS_kNm=M_SLS,
            P_G_kN=body.vertical_load_G_kN,
            footing_type=body.footing_type,
            phi_k_deg=body.phi_k,
            gamma_s_kN_m3=body.gamma_s,
            c_k_kPa=body.cohesion_ck,
            allowable_soil_bearing_kPa=body.allowable_soil_bearing,
            footing_B_m=body.footing_B,
            footing_W_m=body.footing_W,
            footing_D_m=body.footing_D,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Foundation calculation failed: {exc}") from exc

    foundation_result = FoundationResult(**{**foundation_raw, "pass": foundation_raw["pass"]})

    return CalculateResponse(
        wind=wind_result,
        steel=steel_result,
        foundation=foundation_result,
    )
