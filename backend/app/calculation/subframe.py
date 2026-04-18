"""
Subframe check — CHS GI pipe bending.

Section: CHS 48.3x2.5mm GI pipe (galvanised steel)
         fy = 400 N/mm2 (confirmed P105)
         Class 2 section — use elastic modulus Wel with 1.2 enhancement factor

Note on wall thickness: PE calculation report page 3 describes CHS 48.3x2.3 (or 2.2mm),
but uses Wely=3.92 cm3 which corresponds to CHS 48.3x2.5 per standard EN 10219 section
tables. t=2.5mm is used here to match PE Wely and Mc targets. Verify section against
project specification.

Moment formula: M_Ed = (1.5/10) x w x L2
  /10 = continuous beam assumption — confirmed P105 T1/T2
  w   = design_pressure x subframe_spacing

Moment resistance: Mc = 1.2 x fy x Wel / gamma_M0
  Class 2 section with 1.2 factor per PE methodology (page 3 confirmed).

Validated against P105 T2 calculation report (Han Engineering, 8/6/2023):
  UDL = 0.54 kN/m  (0.36 x 1.5) ✓
  Mu  = 0.73 kNm   (1.5 x 0.54 x 9 / 10) ✓
  Mc  = 1.88 kNm   (1.2 x 400 x 3920 / 1e6) ✓
  UR  = 0.388 ✓

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
    CHS 48.3x2.5mm GI pipe bending check.

    Args:
        design_pressure_kPa:  governing design wind pressure [kPa].
        subframe_spacing_m:   vertical spacing between subframe rails [m].
                              Tributary height per rail.
        post_spacing_m:       span between posts [m]. Used as beam span L.

    Returns:
        Dict with section properties, M_Ed, Mc_Rd, UR and pass flag.
    """
    # CHS 48.3x2.5 section properties — matches PE Wely=3.92 cm3 (EN 10219 table value)
    d = 48.3        # mm — outer diameter
    t = 2.5         # mm — wall thickness (t=2.5 per EN 10219; PE uses Wely=3.92 cm3 = t≈2.5)
    di = d - 2 * t  # mm — inner diameter = 43.3 mm

    I_mm4 = math.pi / 64 * (d ** 4 - di ** 4)
    Wel_mm3 = I_mm4 / (d / 2)   # elastic section modulus

    fy = 400.0      # N/mm2 — GI pipe (confirmed P105)
    gamma_M0 = STEEL["gamma_M0"]  # 1.0

    # UDL on subframe rail [kN/m]
    w_kN_per_m = design_pressure_kPa * subframe_spacing_m

    # ULS design moment — continuous beam /10 (confirmed P105 T1/T2)
    M_Ed_kNm = (1.5 / 10) * w_kN_per_m * post_spacing_m ** 2

    # Bending resistance — Class 2, 1.2 x fy x Wel per PE methodology (page 3)
    Mc_Rd_kNm = 1.2 * fy * Wel_mm3 / gamma_M0 / 1e6

    UR_subframe = M_Ed_kNm / Mc_Rd_kNm

    return {
        "section": "CHS 48.3x2.5 GI",
        "fy_N_per_mm2": fy,
        "w_kN_per_m": round(w_kN_per_m, 4),
        "M_Ed_kNm": round(M_Ed_kNm, 4),
        "Wel_mm3": round(Wel_mm3, 2),
        "Mc_Rd_kNm": round(Mc_Rd_kNm, 4),
        "UR_subframe": round(UR_subframe, 4),
        "pass": UR_subframe < 1.0,
    }


if __name__ == "__main__":
    # P105 T2 validation (Han Engineering, 8/6/2023):
    # design_pressure=0.36 kPa, subframe_spacing=1.5m, post_spacing=3.0m
    # Expected: UDL=0.54, M_Ed=0.73, Mc=1.88, UR=0.388
    from .wind import compute_design_pressure

    wind = compute_design_pressure(structure_height=12.7, shelter_factor=0.5)
    result = compute_subframe(
        design_pressure_kPa=wind["design_pressure_kPa"],
        subframe_spacing_m=1.5,
        post_spacing_m=3.0,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    print(f"\ndesign_pressure: {wind['design_pressure_kPa']:.4f} kPa  (target: 0.36)")
    print(f"UDL (w):         {result['w_kN_per_m']:.4f} kN/m  (target: 0.54)")
    print(f"M_Ed:            {result['M_Ed_kNm']:.4f} kNm  (target: 0.73)")
    print(f"Wel:             {result['Wel_mm3']:.2f} mm3  (target: ~3920)")
    print(f"Mc_Rd:           {result['Mc_Rd_kNm']:.4f} kNm  (target: 1.88)")
    print(f"UR_subframe:     {result['UR_subframe']:.4f}       (target: 0.388)")
    print(f"pass:            {result['pass']}")
    if result["UR_subframe"] >= 1.0:
        print(f"FAIL: UR_subframe={result['UR_subframe']:.4f}")
