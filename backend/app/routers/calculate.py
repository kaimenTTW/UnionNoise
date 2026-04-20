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

from app.calculation.connection import compute_connection
from app.calculation.foundation import compute_foundation
from app.calculation.lifting import compute_lifting
from app.calculation.subframe import compute_subframe
from app.calculation.wind import compute_design_pressure
from app.services.section_retrieval import select_section

router = APIRouter(prefix="/api", tags=["calculate"])


# ── Request model ─────────────────────────────────────────────────────────────

class CalculateRequest(BaseModel):
    # Wind
    structure_height: float = Field(..., description="Barrier height ze [m]. Drives qp calculation.")
    shelter_factor: float = Field(1.0, ge=0.0, le=1.0, description="ψs — 1.0 = no shelter. Use 0.5 for P105 validation.")
    vb: float | None = Field(None, gt=0, description="Basic wind velocity [m/s]. Omit to use SG NA default of 20 m/s.")
    return_period: int = Field(50, ge=1, description="Return period T [years]. Drives Cprob per EC1 Eq 4.2. Default 50yr → Cprob=1.0.")

    # Steel post
    post_spacing: float = Field(..., gt=0, description="Post spacing (tributary width) [m].")
    subframe_spacing: float = Field(..., gt=0, description="Subframe spacing = Lcr for LTB [m].")
    post_length: float = Field(..., gt=0, description="L above foundation level [m]. T1: 11m, T2: 12.7m.")
    deflection_limit_n: float = Field(65.0, gt=0, description="Deflection limit denominator n for δ_allow = L/n. Default 65 (P105 confirmed).")

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

    # Concrete
    fck: float = Field(
        25.0, gt=0,
        description="Concrete characteristic cylinder strength fck [N/mm²]. "
                    "C25/30 → 25, C28/35 → 28, C30/37 → 30. "
                    "P105 T2 uses fck=28 per material schedule. Default 25."
    )

    # Soil — undrained
    cu_kPa: float = Field(
        0.0, ge=0,
        description="Undrained shear strength cu [kPa]. Soft clay only. "
                    "When > 0, undrained bearing check (EC7 Annex D.3) runs alongside drained. "
                    "P105 T2 uses cu=30 kPa. Default 0 = drained checks only."
    )

    # Lifting
    post_weight_kN: float = Field(
        6.0, gt=0,
        description="Self-weight of steel post only [kN]. Used for lifting hole shear check. "
                    "The post is lifted via web holes before the footing is cast; "
                    "footing weight is not present at that stage."
    )


# ── Response models ───────────────────────────────────────────────────────────

class WindResult(BaseModel):
    ze_m: float
    cr: float
    vm_m_per_s: float
    Iv: float
    qp_N_per_m2: float
    qp_kPa: float
    vb_m_per_s: float
    cdir: float
    cseason: float
    return_period: int
    Cprob: float
    qb_N_per_m2: float
    qb_kPa: float
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
    Av_mm2: float | None = None
    Vc_kN: float | None = None
    UR_shear: float | None = None
    h_mm: float | None = None
    b_mm: float | None = None
    tf_mm: float | None = None
    tw_mm: float | None = None
    r_mm: float | None = None
    Lcr_mm: float | None = None
    post_length_m: float | None = None
    deflection_limit_n: float | None = None
    selection_source: str | None = None
    fallback_reason: str | None = None
    pass_: bool = Field(False, alias="pass")
    error: str | None = None

    class Config:
        populate_by_name = True


class ConnectionResult(BaseModel):
    config_id: str
    bolt_tension: dict
    bolt_shear: dict
    bolt_combined: dict
    bolt_embedment: dict
    weld: dict
    base_plate: dict
    g_clamp: dict
    all_checks_pass: bool


class SubframeResult(BaseModel):
    section: str
    fy_N_per_mm2: float
    w_kN_per_m: float
    M_Ed_kNm: float
    Wel_mm3: float
    Mc_Rd_kNm: float
    UR_subframe: float
    pass_: bool = Field(..., alias="pass")

    class Config:
        populate_by_name = True


class LiftingResult(BaseModel):
    hook: dict
    hole: dict
    all_checks_pass: bool


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
    connection: ConnectionResult | None = None
    subframe: SubframeResult | None = None
    lifting: LiftingResult | None = None


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/calculate", response_model=CalculateResponse)
async def calculate(body: CalculateRequest) -> CalculateResponse:
    """
    Run the full design chain:
    1. Wind pressure (EC1 + SG NA)
    2. Steel post selection from parts library (EC3 LTB + deflection)
    3. Connection checks (EC3-1-8 + EC2)
    4. Subframe check (CHS GI pipe bending)
    5. Lifting checks (hook tension + bond + web shear)
    6. Foundation checks (EC7 DA1-C1, DA1-C2, SLS)

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
            vb=body.vb,
            return_period=body.return_period,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Wind calculation failed: {exc}") from exc

    wind_result = WindResult(**wind_raw)

    # ── 2. Steel section selection (live retrieval → parts_library fallback) ──
    try:
        w_kN_per_m = wind_raw["design_pressure_kPa"] * body.post_spacing
        L_mm = body.post_length * 1000
        M_Ed_kNm = 1.5 * w_kN_per_m * body.post_length ** 2 / 2
        V_Ed_kN = 1.5 * w_kN_per_m * body.post_length
        Lcr_mm = body.subframe_spacing * 1000

        steel_raw = await select_section(
            M_Ed_kNm=M_Ed_kNm,
            V_Ed_kN=V_Ed_kN,
            w_kN_per_m=w_kN_per_m,
            L_mm=L_mm,
            Lcr_mm=Lcr_mm,
            post_length_m=body.post_length,
            deflection_limit_n=body.deflection_limit_n,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Steel calculation failed: {exc}") from exc

    if "error" in steel_raw:
        steel_result = SteelResult(**{"pass": False, "error": steel_raw["error"]})
    else:
        steel_result = SteelResult(**{
            **steel_raw,
            "pass": steel_raw.get("pass", False),
            "selection_source": steel_raw.get("source"),
            "fallback_reason": steel_raw.get("fallback_reason"),
        })

    # ── 3. Connection ──
    connection_result: ConnectionResult | None = None
    if not steel_raw.get("error") and steel_raw.get("M_Ed_kNm") and steel_raw.get("V_Ed_kN"):
        try:
            # External pressure for G clamp = qp × cp_net (pre-shelter, pre-cp,net reduction)
            external_pressure_kPa = wind_raw["qp_kPa"] * wind_raw["cp_net"]
            connection_raw = compute_connection(
                M_Ed_kNm=steel_raw["M_Ed_kNm"],
                V_Ed_kN=steel_raw["V_Ed_kN"],
                section=steel_raw,
                fck_N_per_mm2=body.fck,
                external_pressure_kPa=external_pressure_kPa,
                post_spacing_m=body.post_spacing,
                barrier_height_m=body.structure_height,
            )
            connection_result = ConnectionResult(**connection_raw)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Connection calculation failed: {exc}") from exc

    # ── 4. Subframe ──
    subframe_result: SubframeResult | None = None
    try:
        subframe_raw = compute_subframe(
            design_pressure_kPa=wind_raw["design_pressure_kPa"],
            subframe_spacing_m=body.subframe_spacing,
            post_spacing_m=body.post_spacing,
        )
        subframe_result = SubframeResult(**{**subframe_raw, "pass": subframe_raw["pass"]})
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Subframe calculation failed: {exc}") from exc

    # ── 5. Lifting ──
    lifting_result: LiftingResult | None = None
    if not steel_raw.get("error") and steel_raw.get("tw_mm"):
        try:
            lifting_raw = compute_lifting(
                P_G_kN=body.vertical_load_G_kN,
                section=steel_raw,
                fck_N_per_mm2=body.fck,
                post_weight_kN=body.post_weight_kN,
            )
            lifting_result = LiftingResult(**lifting_raw)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Lifting calculation failed: {exc}") from exc

    # ── 6. Foundation ──
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
            cu_kPa=body.cu_kPa,
            allowable_soil_bearing_kPa=body.allowable_soil_bearing,
            footing_B_m=body.footing_B,
            footing_L_m=body.footing_W,
            footing_D_m=body.footing_D,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Foundation calculation failed: {exc}") from exc

    foundation_result = FoundationResult(**{**foundation_raw, "pass": foundation_raw["pass"]})

    return CalculateResponse(
        wind=wind_result,
        steel=steel_result,
        foundation=foundation_result,
        connection=connection_result,
        subframe=subframe_result,
        lifting=lifting_result,
    )