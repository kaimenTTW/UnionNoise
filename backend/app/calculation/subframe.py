"""
Subframe check — CHS GI pipe bending.

Iterates chs_library.json ascending by mass_kg_per_m, selects lightest section passing
the moment utilisation check (UR < 1.0).

Section class: Class 2 — use elastic modulus Wel with 1.2 enhancement factor.
fy = 400 N/mm² (GI pipe, confirmed P105).

Moment formula: M_Ed = (1.5/10) × w × L²
  /10 = continuous beam assumption — confirmed P105 T1/T2
  w   = design_pressure × subframe_spacing

Moment resistance: Mc = 1.2 × fy × Wel / gamma_M0
  Class 2 section with 1.2 factor per PE methodology (page 3 confirmed).

Validated against P105 T2 calculation report (Han Engineering, 8/6/2023):
  UDL = 0.54 kN/m  (0.36 × 1.5) ✓
  Mu  = 0.73 kNm   (1.5 × 0.54 × 9 / 10) ✓
  Mc  = 1.88 kNm   (1.2 × 400 × 3920 / 1e6) ✓
  UR  = 0.388 ✓  → selects CHS 48.3×2.5mm GI ✓

Reference: code-reference.md Section 5, P105 confirmed.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .constants import STEEL

_CHS_LIBRARY_PATH = Path(__file__).parent.parent / "data" / "chs_library.json"


@lru_cache(maxsize=1)
def _load_chs_sections() -> list[dict]:
    with _CHS_LIBRARY_PATH.open() as f:
        data = json.load(f)
    return sorted(data["sections"], key=lambda s: s["mass_kg_per_m"])


def compute_subframe(
    design_pressure_kPa: float,
    subframe_spacing_m: float,
    post_spacing_m: float,
) -> dict:
    """
    Select lightest CHS GI pipe section passing moment check.

    Args:
        design_pressure_kPa:  governing design wind pressure [kPa].
        subframe_spacing_m:   vertical spacing between subframe rails [m].
        post_spacing_m:       span between posts [m]. Used as beam span L.

    Returns:
        Dict with selected section properties, M_Ed, Mc_Rd, UR and pass flag.
    """
    gamma_M0 = STEEL["gamma_M0"]  # 1.0

    w_kN_per_m = design_pressure_kPa * subframe_spacing_m
    M_Ed_kNm = (1.5 / 10) * w_kN_per_m * post_spacing_m ** 2

    for sec in _load_chs_sections():
        od_mm = sec["od_mm"]
        t_mm = sec["t_mm"]
        fy = sec["fy_N_per_mm2"]
        Wel_mm3 = sec["Wel_cm3"] * 1000

        Mc_Rd_kNm = 1.2 * fy * Wel_mm3 / gamma_M0 / 1e6
        UR = M_Ed_kNm / Mc_Rd_kNm

        if UR < 1.0:
            hardware_note: str | None = None
            if od_mm > 48.3:
                hardware_note = (
                    f"Selected OD {od_mm}mm exceeds standard 48.3mm — confirm panel "
                    "guide and clamp hardware compatibility with Hebei Jinbiao before proceeding."
                )
            elif od_mm < 48.3:
                hardware_note = (
                    f"Selected OD {od_mm}mm is below standard 48.3mm GI pipe — "
                    "confirm panel guide and clamp hardware compatibility before proceeding. "
                    "P105 specifies CHS 48.3mm as the standard size."
                )
            return {
                "designation": f"CHS {od_mm}×{t_mm}mm GI",
                "od_mm": od_mm,
                "t_mm": t_mm,
                "mass_kg_per_m": sec["mass_kg_per_m"],
                "fy_N_per_mm2": fy,
                "w_kN_per_m": round(w_kN_per_m, 4),
                "M_Ed_kNm": round(M_Ed_kNm, 4),
                "Wel_mm3": round(Wel_mm3, 2),
                "Mc_Rd_kNm": round(Mc_Rd_kNm, 4),
                "UR_subframe": round(UR, 4),
                "hardware_note": hardware_note,
                "pass": True,
            }

    return {"error": "No CHS section passes — refer to PE", "pass": False}


if __name__ == "__main__":
    # P105 T2 validation: dp=0.36, subframe_spacing=1.5m, post_spacing=3.0m
    # Expected: CHS 48.3×2.5mm, UDL=0.54, M_Ed=0.73, Mc=1.88, UR=0.388
    result = compute_subframe(
        design_pressure_kPa=0.36,
        subframe_spacing_m=1.5,
        post_spacing_m=3.0,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    print(f"\ndesignation: {result.get('designation')}  (target: CHS 48.3×2.5mm GI)")
    print(f"UDL (w):     {result.get('w_kN_per_m'):.4f} kN/m  (target: 0.54)")
    print(f"M_Ed:        {result.get('M_Ed_kNm'):.4f} kNm  (target: 0.73)")
    print(f"Mc_Rd:       {result.get('Mc_Rd_kNm'):.4f} kNm  (target: 1.88)")
    print(f"UR_subframe: {result.get('UR_subframe'):.4f}       (target: 0.387)")
    print(f"pass:        {result.get('pass')}")
