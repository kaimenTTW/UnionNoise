"""
Lifting checks — hook tension and lifting hole shear.

Hook: H20 rebar (high yield), fub = 500 N/mm²
      2 nos per footing (confirmed P105 material schedule)
Hole: drilled in post web — shear check at hole edge

References: EC3-1-8 Cl 3.6.1 (hook tension/shear),
            EC2 Cl 8.4.2 (anchorage bond),
            code-reference.md Section 6.
"""

from __future__ import annotations

import math

from .constants import CONCRETE, STEEL


def compute_lifting(
    P_G_kN: float,
    section: dict,
    fck_N_per_mm2: float = 25.0,
    n_hooks: int = 2,
    hook_diameter_mm: float = 20.0,
    embedment_mm: float = 450.0,
) -> dict:
    """
    Lifting checks: hook tension, bond length, and post web shear at lifting hole.

    Args:
        P_G_kN:              Permanent vertical load [kN] — self-weight of post + footing.
        section:             Section properties dict — must include tw_mm.
                             Optionally includes fy_N_per_mm2 (default 275 N/mm² if absent).
        fck_N_per_mm2:       Concrete characteristic cylinder strength [N/mm²]. Default 25.
        n_hooks:             Number of lifting hooks per footing. Default 2 (P105 confirmed).
        hook_diameter_mm:    Hook bar diameter [mm]. Default 20 (H20 rebar).
        embedment_mm:        Hook embedment length [mm]. Default 450 (P105 material schedule).

    Returns:
        Dict with hook tension, bond, and hole shear check results and all_checks_pass flag.
    """
    gamma_M2 = STEEL["gamma_M2"]    # 1.25
    gamma_M0 = STEEL["gamma_M0"]    # 1.0
    gamma_c = CONCRETE["gamma_c"]   # 1.5

    # ── Hook tension ──────────────────────────────────────────────────────────
    # Factored lifting load (ULS)
    W_factored_kN = P_G_kN * 1.5
    F_hook_kN = W_factored_kN / n_hooks

    fub_hook = 500.0    # N/mm² — high yield rebar
    As_hook = math.pi / 4 * hook_diameter_mm ** 2  # gross area (bar, not threaded)

    # Tension resistance per EC3-1-8 Cl 3.6.1 (k2 = 0.9)
    FT_Rd_hook_kN = 0.9 * fub_hook * As_hook / gamma_M2 / 1000
    UR_hook_tension = F_hook_kN / FT_Rd_hook_kN

    # ── Hook bond length (EC2 Cl 8.4.2) ──────────────────────────────────────
    fctm = 0.30 * fck_N_per_mm2 ** (2 / 3)   # EC2 Cl 3.1.6 mean tensile strength
    fctk = 0.7 * fctm                          # lower characteristic (5th percentile)
    fctd = fctk / gamma_c
    eta1 = 1.0   # good bond condition
    eta2 = 1.0   # bar diameter <= 32mm
    fbd = 2.25 * eta1 * eta2 * fctd           # EC2 Cl 8.4.2 design bond strength

    L_required_mm = F_hook_kN * 1000 / (fbd * math.pi * hook_diameter_mm)
    UR_hook_bond = L_required_mm / embedment_mm

    # ── Lifting hole — post web shear ─────────────────────────────────────────
    # Hole drilled in web; shear check at hole edge.
    # Standard: hole_diameter = 35mm; edge_distance = 50mm (conservative).
    hole_diameter_mm = 35.0
    edge_distance_mm = 50.0

    tw_mm = section["tw_mm"]
    fy_post = section.get("fy_N_per_mm2", 275.0)

    # Shear area at hole: edge distance × web thickness (single shear plane)
    Av_hole_mm2 = edge_distance_mm * tw_mm
    V_Rd_hole_kN = Av_hole_mm2 * (fy_post / math.sqrt(3)) / gamma_M0 / 1000

    # Load per hole = load per hook (one hook per hole)
    UR_hole_shear = F_hook_kN / V_Rd_hole_kN

    return {
        "hook": {
            "n_hooks": n_hooks,
            "hook_diameter_mm": hook_diameter_mm,
            "W_factored_kN": round(W_factored_kN, 2),
            "F_hook_kN": round(F_hook_kN, 2),
            "FT_Rd_kN": round(FT_Rd_hook_kN, 2),
            "UR_tension": round(UR_hook_tension, 4),
            "pass_tension": UR_hook_tension < 1.0,
            "fbd_N_per_mm2": round(fbd, 4),
            "L_required_mm": round(L_required_mm, 1),
            "L_provided_mm": embedment_mm,
            "UR_bond": round(UR_hook_bond, 4),
            "pass_bond": UR_hook_bond < 1.0,
        },
        "hole": {
            "hole_diameter_mm": hole_diameter_mm,
            "edge_distance_mm": edge_distance_mm,
            "tw_mm": tw_mm,
            "Av_mm2": round(Av_hole_mm2, 2),
            "V_Rd_kN": round(V_Rd_hole_kN, 2),
            "F_hole_kN": round(F_hook_kN, 2),
            "UR_shear": round(UR_hole_shear, 4),
            "pass_shear": UR_hole_shear < 1.0,
        },
        "all_checks_pass": (
            UR_hook_tension < 1.0
            and UR_hook_bond < 1.0
            and UR_hole_shear < 1.0
        ),
    }


if __name__ == "__main__":
    # P105 T2 sample: post+footing ~30 kN, UB406x140x39 tw=6.4mm
    section_t2 = {
        "tw_mm": 6.4,
        "fy_N_per_mm2": 275,
    }
    result = compute_lifting(
        P_G_kN=30.0,
        section=section_t2,
        fck_N_per_mm2=25.0,
        n_hooks=2,
        hook_diameter_mm=20.0,
        embedment_mm=450.0,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    print(f"\nHook tension UR: {result['hook']['UR_tension']:.4f}  pass={result['hook']['pass_tension']}")
    print(f"Hook bond    UR: {result['hook']['UR_bond']:.4f}  pass={result['hook']['pass_bond']}")
    print(f"Hole shear   UR: {result['hole']['UR_shear']:.4f}  pass={result['hole']['pass_shear']}")
    print(f"all_pass:        {result['all_checks_pass']}")
    if not result["hook"]["pass_tension"]:
        print(f"FAIL: hook_tension UR={result['hook']['UR_tension']:.4f}")
    if not result["hook"]["pass_bond"]:
        print(f"FAIL: hook_bond UR={result['hook']['UR_bond']:.4f}")
    if not result["hole"]["pass_shear"]:
        print(f"FAIL: hole_shear UR={result['hole']['UR_shear']:.4f}")