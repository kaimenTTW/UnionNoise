"""
Subframe check — CHS GI pipe bending.

Section: CHS 48.3x2.4mm GI pipe (galvanised steel)
         fy = 400 N/mm² (confirmed P105)
         Class 2 section — use elastic modulus Wel

Moment formula: M_Ed = (1.5/10) x w x L²
  /10 = continuous beam assumption — confirmed P105 T1/T2
  w   = design_pressure x subframe_spacing

Reference: code-reference.md Section 5, P105 confirmed.
"""

from __future__ import annotations

import math

from .constants import STEEL


def compute_subframe(
    design_pressure_kPa: float,
    subframe_spacing_m: float,
    post_spacing_m: float,
) -> dict:
    """
    CHS 48.3x2.4mm GI pipe bending check.

    Args:
        design_pressure_kPa:  governing design wind pressure [kPa].
        subframe_spacing_m:   vertical spacing between subframe rails [m].
                              Tributary height per rail.
        post_spacing_m:       span between posts [m]. Used as beam span L.

    Returns:
        Dict with section properties, M_Ed, Mc_Rd, UR and pass flag.
    """
    # CHS 48.3x2.4 section properties
    d = 48.3        # mm — outer diameter
    t = 2.4         # mm — wall thickness
    di = d - 2 * t  # mm — inner diameter = 43.5 mm

    I_mm4 = math.pi / 64 * (d ** 4 - di ** 4)
    Wel_mm3 = I_mm4 / (d / 2)   # elastic section modulus (Class 2)

    fy = 400.0      # N/mm² — GI pipe (confirmed P105)
    gamma_M0 = STEEL["gamma_M0"]  # 1.0

    # UDL on subframe rail [kN/m]
    w_kN_per_m = design_pressure_kPa * subframe_spacing_m

    # ULS design moment — continuous beam /10 (confirmed P105 T1/T2)
    M_Ed_kNm = (1.5 / 10) * w_kN_per_m * post_spacing_m ** 2

    # Bending resistance — Class 2, elastic modulus
    Mc_Rd_kNm = Wel_mm3 * fy / gamma_M0 / 1e6

    UR_subframe = M_Ed_kNm / Mc_Rd_kNm

    return {
        "section": "CHS 48.3x2.4 GI",
        "fy_N_per_mm2": fy,
        "w_kN_per_m": round(w_kN_per_m, 4),
        "M_Ed_kNm": round(M_Ed_kNm, 4),
        "Wel_mm3": round(Wel_mm3, 2),
        "Mc_Rd_kNm": round(Mc_Rd_kNm, 4),
        "UR_subframe": round(UR_subframe, 4),
        "pass": UR_subframe < 1.0,
    }


if __name__ == "__main__":
    # P105 T2 sample: design_pressure from wind module, subframe_spacing=1.5m, post_spacing=3.0m
    from .wind import compute_design_pressure

    wind = compute_design_pressure(structure_height=12.7, shelter_factor=0.5)
    result = compute_subframe(
        design_pressure_kPa=wind["design_pressure_kPa"],
        subframe_spacing_m=1.5,
        post_spacing_m=3.0,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    print(f"\nUR_subframe: {result['UR_subframe']:.4f}  pass={result['pass']}")
    if result["UR_subframe"] >= 1.0:
        print(f"FAIL: UR_subframe={result['UR_subframe']:.4f}")