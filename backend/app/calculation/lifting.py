"""
Lifting checks — hook tension and lifting hole shear.

Two distinct operations with different load inputs:
  Hook (rebar in footing): carries full assembly weight (post + footing).
  Hole (post web shear):   carries post self-weight only — post is lifted
                           via holes before the footing is cast.

Hook: iterates rebar_library.json ascending by diameter.
      Selects lightest bar where both UR_tension < 1.0 AND UR_bond < 1.0.
      If no bar passes with n_hooks=4, retries with n_hooks=6.
Hole: drilled in post web — shear check at hole edge.

Validated against P105 T2 calculation report (Han Engineering, 8/6/2023):
  Hook checks (page 11):
    n_hooks = 4 ✓
    W_factored = 191.25 × 1.5 = 286.88 kN ✓
    F_hook = 286.88 / 4 = 71.72 kN ✓
    H20 selected: FT_Rd = 0.9 × 500 × 314 / 1.25 / 1000 = 113.04 kN
    UR_tension = 71.72 / 113.04 = 0.634 ✓ (passes)
    Note: PE report uses As=490.94 mm² (H25 gross area) for H20 bar — documented
          discrepancy. System uses correct rebar_library As values.

  Hole checks (page 6):
    tw = section["tw_mm"] = 6.4mm (PE used 6.0mm rounded down — corrected)
    edge_distance = 50 mm ✓
    V_Rd = 50 × 6.4 × 275 / sqrt(3) / 1000 = 50.74 kN
    W_post_factored = 6.0 × 1.5 = 9.0 kN; UR_hole = 9.0 / 50.74 = 0.177 ✓

References: EC3-1-8 Cl 3.6.1 (hook tension/shear),
            EC2 Cl 8.4.2 (anchorage bond),
            code-reference.md Section 6.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from .constants import CONCRETE, STEEL

_REBAR_LIBRARY_PATH = Path(__file__).parent.parent / "data" / "rebar_library.json"


@lru_cache(maxsize=1)
def _load_rebar_sections() -> list[dict]:
    with _REBAR_LIBRARY_PATH.open() as f:
        data = json.load(f)
    return sorted(data, key=lambda b: b["diameter_mm"])


def _try_hook_selection(
    F_hook_kN: float,
    fbd: float,
    embedment_mm: float,
    gamma_M2: float,
) -> dict | None:
    """Return hook result dict for lightest passing bar, or None if none pass."""
    for bar in _load_rebar_sections():
        As = bar["As_mm2"]
        d = bar["diameter_mm"]
        fub = bar["fub_N_per_mm2"]

        FT_Rd_kN = 0.9 * fub * As / gamma_M2 / 1000
        UR_tension = F_hook_kN / FT_Rd_kN

        L_required_mm = F_hook_kN * 1000 / (fbd * math.pi * d)
        UR_bond = L_required_mm / embedment_mm

        if UR_tension < 1.0 and UR_bond < 1.0:
            return {
                "bar": bar["bar"],
                "diameter_mm": d,
                "As_mm2": As,
                "FT_Rd_kN": round(FT_Rd_kN, 2),
                "UR_tension": round(UR_tension, 4),
                "L_required_mm": round(L_required_mm, 1),
                "UR_bond": round(UR_bond, 4),
                "pass_tension": True,
                "pass_bond": True,
            }
    return None


def compute_lifting(
    P_G_kN: float,
    section: dict,
    fck_N_per_mm2: float = 25.0,
    n_hooks: int = 4,
    embedment_mm: float = 450.0,
    post_weight_kN: float = 6.0,
) -> dict:
    """
    Lifting checks: hook tension, bond length, and post web shear at lifting hole.

    Args:
        P_G_kN:          Permanent vertical load [kN] — self-weight of post + footing.
        section:         Section properties dict — must include tw_mm.
        fck_N_per_mm2:   Concrete strength [N/mm²]. Default 25.
        n_hooks:         Starting number of hooks (default 4). Retried with 6 if no bar passes.
        embedment_mm:    Hook embedment length [mm]. Default 450 (P105 confirmed).
        post_weight_kN:  Steel post self-weight only [kN]. Default 6.0.
    """
    gamma_M2 = STEEL["gamma_M2"]    # 1.25
    gamma_M0 = STEEL["gamma_M0"]    # 1.0
    gamma_c = CONCRETE["gamma_c"]   # 1.5

    # ── Bond strength (EC2 Cl 8.4.2) ─────────────────────────────────────────
    fctm = 0.30 * fck_N_per_mm2 ** (2 / 3)
    fctk = 0.7 * fctm
    fctd = fctk / gamma_c
    fbd = 2.25 * 1.0 * 1.0 * fctd

    # ── Hook selection ────────────────────────────────────────────────────────
    W_factored_kN = P_G_kN * 1.5
    n_hooks_used = n_hooks
    F_hook_kN = W_factored_kN / n_hooks_used

    hook_result = _try_hook_selection(F_hook_kN, fbd, embedment_mm, gamma_M2)
    if hook_result is None and n_hooks_used == 4:
        n_hooks_used = 6
        F_hook_kN = W_factored_kN / n_hooks_used
        hook_result = _try_hook_selection(F_hook_kN, fbd, embedment_mm, gamma_M2)

    if hook_result is None:
        hook_dict: dict = {
            "error": "No rebar size passes with n_hooks=4 or n_hooks=6 — refer to PE",
            "n_hooks": n_hooks_used,
            "W_factored_kN": round(W_factored_kN, 2),
            "F_hook_kN": round(F_hook_kN, 2),
            "fbd_N_per_mm2": round(fbd, 4),
            "L_provided_mm": embedment_mm,
            "pass_tension": False,
            "pass_bond": False,
            "pe_note": (
                "PE report uses As=490.94mm² (H25 area) for H20 bar. "
                "System uses correct rebar_library As values."
            ),
        }
    else:
        hook_dict = {
            **hook_result,
            "n_hooks": n_hooks_used,
            "W_factored_kN": round(W_factored_kN, 2),
            "F_hook_kN": round(F_hook_kN, 2),
            "fbd_N_per_mm2": round(fbd, 4),
            "L_provided_mm": embedment_mm,
            "pe_note": (
                "PE report uses As=490.94mm² (H25 area) for H20 bar. "
                "System uses correct rebar_library As values."
            ),
        }

    # ── Lifting hole — post web shear ─────────────────────────────────────────
    edge_distance_mm = 50.0
    tw_for_hole_mm = section["tw_mm"]
    fy_post = section.get("fy_N_per_mm2", 275.0)

    Av_hole_mm2 = edge_distance_mm * tw_for_hole_mm
    V_Rd_hole_kN = Av_hole_mm2 * (fy_post / math.sqrt(3)) / gamma_M0 / 1000
    W_post_factored_kN = post_weight_kN * 1.5
    UR_hole_shear = W_post_factored_kN / V_Rd_hole_kN

    hook_pass = hook_dict.get("pass_tension", False) and hook_dict.get("pass_bond", False)

    return {
        "hook": hook_dict,
        "hole": {
            "hole_diameter_mm": 35.0,
            "edge_distance_mm": edge_distance_mm,
            "tw_mm": tw_for_hole_mm,
            "tw_note": f"tw={tw_for_hole_mm}mm from section dict (P105 PE page 6 used 6.0mm rounded down from 6.4mm)",
            "Av_mm2": round(Av_hole_mm2, 2),
            "V_Rd_kN": round(V_Rd_hole_kN, 2),
            "post_weight_kN": post_weight_kN,
            "W_post_factored_kN": round(W_post_factored_kN, 2),
            "load_note": "Hole load = post self-weight only (footing not yet cast when lifting via holes)",
            "UR_shear": round(UR_hole_shear, 4),
            "pass_shear": UR_hole_shear < 1.0,
        },
        "all_checks_pass": hook_pass and UR_hole_shear < 1.0,
    }


if __name__ == "__main__":
    # P105 T2 validation (Han Engineering, 8/6/2023):
    # P_G=191.25 kN, fck=25, n_hooks=4
    # Expected: H20 selected, F_hook=71.72, FT_Rd=113.04, UR_tension=0.634 ✓
    section_t2 = {"tw_mm": 6.4, "fy_N_per_mm2": 275}
    result = compute_lifting(
        P_G_kN=191.25,
        section=section_t2,
        fck_N_per_mm2=25.0,
        n_hooks=4,
        embedment_mm=450.0,
        post_weight_kN=6.0,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    h = result["hook"]
    print(f"\nBar selected:      {h.get('bar')}  (target: H20)")
    print(f"W_factored:        {h.get('W_factored_kN'):.2f} kN  (target: 286.88)")
    print(f"F_hook:            {h.get('F_hook_kN'):.2f} kN  (target: 71.72)")
    print(f"FT_Rd:             {h.get('FT_Rd_kN'):.2f} kN  (target: 113.04)")
    print(f"UR_tension:        {h.get('UR_tension'):.4f}       (target: 0.634)")
    hole = result["hole"]
    print(f"tw_mm:             {hole.get('tw_mm')}  (target: 6.4)")
    print(f"Av_mm2:            {hole.get('Av_mm2'):.1f}  (target: 320.0)")
    print(f"V_Rd_kN:           {hole.get('V_Rd_kN'):.2f}  (target: 50.74)")
    print(f"UR_shear:          {hole.get('UR_shear'):.3f}  (target: 0.177)")
    print(f"all_pass:          {result['all_checks_pass']}")
    assert abs(hole["UR_shear"] - 0.177) < 0.001, f"UR_shear mismatch: {hole['UR_shear']}"
    assert hole["pass_shear"], "Hole shear check failed"
    print("Lifting validation: PASS")
