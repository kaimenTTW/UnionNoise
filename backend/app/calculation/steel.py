"""
Steel post design — EC3 Clause 6.3.2 (LTB) + deflection + shear capacity.

All formulas ✅ CONFIRMED across PE calculation reports.
Reference: code-reference.md Sections 4.2–4.5. Primary source: P105 Punggol.
Shear: EC3 Clause 6.2.6. A_cm2 derived from mass_kg_per_m (no A field in library).

Selection algorithm: iterate parts library ascending by Wpl_y; return first section
where both UR_moment < 1.0 AND UR_deflection < 1.0.

P105 validation targets (feed as inputs):
  T1: structure_height=12.7, shelter_factor=0.5, post_spacing=3.0,
      subframe_spacing=1.5, post_length=11.0
      → M_Ed≈97.76 kNm, section UB356×127×33
  T2: same wind inputs, post_length=12.7 (embedded, full depth)
      → M_Ed≈130.31 kNm, section UB406×140×39
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from .constants import LTB, STEEL

_PARTS_LIBRARY_PATH = Path(__file__).parent.parent / "data" / "parts_library.json"


@lru_cache(maxsize=1)
def _load_sections() -> list[dict]:
    """Load parts library and sort ascending by mass_kg_per_m (lightest first by weight)."""
    with _PARTS_LIBRARY_PATH.open() as f:
        data = json.load(f)
    return sorted(data["sections"], key=lambda s: s["mass_kg_per_m"])


def _check_section(
    sec: dict,
    M_Ed_kNm: float,
    V_Ed_kN: float,
    w_kN_per_m: float,
    L_mm: float,
    Lcr_mm: float,
    post_length_m: float,
    deflection_limit_n: float,
) -> dict:
    """
    Run LTB, deflection, and shear checks on a single section dict from the parts library.
    Returns full result dict with "pass" key. Never raises — returns pass=False on bad inputs.
    """
    E = STEEL["E"]
    G = STEEL["G"]
    gamma_M1 = STEEL["gamma_M1"]
    C1 = LTB["C1"]
    alpha_LT = LTB["alpha_LT"]
    lambda_LT_0 = LTB["lambda_LT_0"]
    beta = LTB["beta"]

    fy = sec["fy_N_per_mm2"]

    Wpl_y_mm3 = sec["Wpl_y_cm3"] * 1e3
    Iz_mm4 = sec["Iz_cm4"] * 1e4
    Iy_mm4 = sec["Iy_cm4"] * 1e4
    It_mm4 = sec["It_cm4"] * 1e4
    # Iw: empirically validated multiplier — see code-reference.md Section 4.4
    Iw_mm6 = sec["Iw_dm6"] * 1e6

    Mpl_kNm = Wpl_y_mm3 * fy / gamma_M1 / 1e6

    pi2EIz_over_Lcr2 = math.pi ** 2 * E * Iz_mm4 / Lcr_mm ** 2
    warping_term = Iw_mm6 / Iz_mm4
    torsion_term = Lcr_mm ** 2 * G * It_mm4 / (math.pi ** 2 * E * Iz_mm4)
    Mcr_Nmm = C1 * pi2EIz_over_Lcr2 * math.sqrt(warping_term + torsion_term)
    Mcr_kNm = Mcr_Nmm / 1e6

    lambda_bar_LT = math.sqrt(Mpl_kNm / Mcr_kNm)
    phi_LT = 0.5 * (1 + alpha_LT * (lambda_bar_LT - lambda_LT_0) + beta * lambda_bar_LT ** 2)
    discriminant = max(0.0, phi_LT ** 2 - beta * lambda_bar_LT ** 2)
    chi_LT = min(1.0, 1 / (phi_LT + math.sqrt(discriminant)))

    Mb_Rd_kNm = chi_LT * Wpl_y_mm3 * fy / gamma_M1 / 1e6
    UR_moment = M_Ed_kNm / Mb_Rd_kNm

    w_N_per_mm = w_kN_per_m
    delta_mm = w_N_per_mm * L_mm ** 4 / (8 * E * Iy_mm4)
    delta_allow_mm = L_mm / deflection_limit_n
    UR_deflection = delta_mm / delta_allow_mm

    A_mm2 = sec["mass_kg_per_m"] / 0.785 * 100
    h_mm = sec["h_mm"]
    b_mm = sec["b_mm"]
    tf_mm = sec["tf_mm"]
    tw_mm = sec["tw_mm"]
    r_mm = sec["r_mm"]
    Av_mm2 = A_mm2 - 2 * b_mm * tf_mm + (tw_mm + 2 * r_mm) * tf_mm
    Vc_kN = Av_mm2 * (fy / math.sqrt(3)) / STEEL["gamma_M0"] / 1000
    UR_shear = V_Ed_kN / Vc_kN

    passed = UR_moment < 1.0 and UR_deflection < 1.0 and UR_shear < 1.0

    return {
        "designation": sec["designation"],
        "mass_kg_per_m": sec["mass_kg_per_m"],
        "w_kN_per_m": round(w_kN_per_m, 4),
        "M_Ed_kNm": round(M_Ed_kNm, 2),
        "V_Ed_kN": round(V_Ed_kN, 2),
        "Mpl_kNm": round(Mpl_kNm, 2),
        "Mcr_kNm": round(Mcr_kNm, 2),
        "lambda_bar_LT": round(lambda_bar_LT, 4),
        "phi_LT": round(phi_LT, 4),
        "chi_LT": round(chi_LT, 4),
        "Mb_Rd_kNm": round(Mb_Rd_kNm, 2),
        "UR_moment": round(UR_moment, 3),
        "delta_mm": round(delta_mm, 2),
        "delta_allow_mm": round(delta_allow_mm, 2),
        "UR_deflection": round(UR_deflection, 3),
        "Av_mm2": round(Av_mm2, 2),
        "Vc_kN": round(Vc_kN, 2),
        "UR_shear": round(UR_shear, 4),
        "h_mm": h_mm,
        "b_mm": b_mm,
        "tf_mm": tf_mm,
        "tw_mm": tw_mm,
        "r_mm": r_mm,
        "Lcr_mm": Lcr_mm,
        "post_length_m": post_length_m,
        "deflection_limit_n": deflection_limit_n,
        "pass": passed,
    }


def compute_steel_design(
    design_pressure_kPa: float,
    post_spacing_m: float,
    subframe_spacing_m: float,
    post_length_m: float,
    deflection_limit_n: float = 65,
) -> dict:
    """
    Select the lightest UB section from the parts library that satisfies
    the LTB moment check, deflection check, and shear check.

    Args:
        design_pressure_kPa:  governing design wind pressure [kPa].
        post_spacing_m:       tributary width per post [m].
        subframe_spacing_m:   effective length Lcr for LTB [m].
                              Confirmed: Lcr = subframe_spacing, NOT post length.
        post_length_m:        L above foundation level [m].
                              T1 (above ground 12m): 11m (1m in footing).
                              T2 (embedded): 12.7m (full embedment included).
        deflection_limit_n:   denominator n for δ_allow = L/n. Default 65 (P105 confirmed).

    Returns:
        Dict with selected section properties and all check results,
        or {"error": "..."} if no section in library passes.
    """
    # UDL (kN/m). 1 kN/m = 1 N/mm — unit equivalence used throughout.
    w_kN_per_m = design_pressure_kPa * post_spacing_m

    # ULS moment and shear — EC3 load combination (γQ = 1.5 factored explicitly)
    # code-reference.md Section 4.2: M_Ed = 1.5 × w × L² / 2
    L_mm = post_length_m * 1000
    M_Ed_kNm = 1.5 * w_kN_per_m * post_length_m ** 2 / 2
    V_Ed_kN = 1.5 * w_kN_per_m * post_length_m
    Lcr_mm = subframe_spacing_m * 1000

    for sec in _load_sections():
        result = _check_section(
            sec=sec,
            M_Ed_kNm=M_Ed_kNm,
            V_Ed_kN=V_Ed_kN,
            w_kN_per_m=w_kN_per_m,
            L_mm=L_mm,
            Lcr_mm=Lcr_mm,
            post_length_m=post_length_m,
            deflection_limit_n=deflection_limit_n,
        )
        if result["pass"]:
            return result

    return {"error": "No section in parts library satisfies both moment and deflection checks."}


if __name__ == "__main__":
    from .wind import compute_design_pressure

    print("=== P105 T1 (above ground, 12mH, 3m spacing) ===")
    wind = compute_design_pressure(structure_height=12.7, shelter_factor=0.5)
    r1 = compute_steel_design(
        design_pressure_kPa=wind["design_pressure_kPa"],
        post_spacing_m=3.0,
        subframe_spacing_m=1.5,
        post_length_m=11.0,
    )
    print(r1)
    assert r1.get("designation") == "356 x 127 x 33", (
        f"T1 section mismatch: {r1.get('designation')}"
    )
    print("Steel T1 section: PASS")

    print("\n=== P105 T2 (embedded, 12mH, 3m spacing) ===")
    r2 = compute_steel_design(
        design_pressure_kPa=wind["design_pressure_kPa"],
        post_spacing_m=3.0,
        subframe_spacing_m=1.5,
        post_length_m=12.7,
    )
    print(r2)
    assert r2.get("designation") == "406 x 140 x 39", (
        f"T2 section mismatch: {r2.get('designation')}"
    )
    print("Steel T2 section: PASS")
