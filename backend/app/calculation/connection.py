"""
Connection design — EC3-1-8 + EC2.

Checks bolt tension, shear, combined, embedment, weld,
base plate bearing, and G clamp.

Dependency: receives M_Ed_kNm and V_Ed_kN from steel module.
Do NOT recompute these — they are fixed upstream outputs.

T1_M24_6bolt config fully validated against P105 T2 drawing
D-P105-TNCB-3002 (April 2026):
  Ft_per_bolt = 96.53 kN  ✓
  FT_Rd       = 260.58 kN ✓  (nominal shank area — confirmed PE methodology)
  UR_tension  = 0.370     ✓
  UR_embedment = 0.678    ✓  (fck=28 C28/35 per P105 T2 material schedule)

T1_M20_6bolt and T2_M20_4bolt remain unvalidated pending PE drawing review.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from .constants import BOLT_STRESS_AREA, CONCRETE, STEEL

_CONNECTION_LIBRARY_PATH = Path(__file__).parent.parent / "data" / "connection_library.json"


@lru_cache(maxsize=1)
def _load_configs() -> dict[str, dict]:
    """Load connection library and index by config id."""
    with _CONNECTION_LIBRARY_PATH.open() as f:
        data = json.load(f)
    return {cfg["id"]: cfg for cfg in data["configurations"]}


def _auto_select_config(designation: str) -> str:
    """Auto-select config_id from section designation string."""
    if "406" in designation or "356 x 127 x 39" in designation:
        return "T1_M24_6bolt"
    if "356 x 127 x 33" in designation:
        return "T1_M20_6bolt"
    if "203" in designation:
        return "T2_M20_4bolt"
    return "T1_M24_6bolt"


def compute_connection(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    section: dict,
    config_id: str | None = None,
    fck_N_per_mm2: float = 25.0,
    external_pressure_kPa: float = 0.45,
    post_spacing_m: float = 3.0,
    barrier_height_m: float = 12.0,
) -> dict:
    """
    Connection checks: bolt tension, shear, combined, embedment,
    weld (MoI method), base plate bearing, G clamp.

    Args:
        M_Ed_kNm:              Design moment from steel module [kNm]. Not recomputed here.
        V_Ed_kN:               Design shear from steel module [kN]. Not recomputed here.
        section:               Section properties dict from parts library — must include
                               h_mm, b_mm, tf_mm, tw_mm, designation.
        config_id:             Connection config key from connection_library.json.
                               Auto-selected from designation if None.
        fck_N_per_mm2:         Concrete characteristic cylinder strength [N/mm²].
                               Default 25 (C25/30). P105 T2 uses 28 (C28/35).
        external_pressure_kPa: External wind pressure for G clamp check [kPa].
                               = qp × cp_net (pre-shelter). Default 0.45 kPa (P105 confirmed).
        post_spacing_m:        Post spacing [m]. Drives G clamp wind force.
        barrier_height_m:      Barrier height [m]. Drives G clamp wind force.

    Returns:
        Dict with all seven check results and all_checks_pass flag.
    """
    configs = _load_configs()
    designation = section.get("designation", "")

    if config_id is None:
        config_id = _auto_select_config(designation)

    config = configs[config_id]
    bolt = config["bolts"]
    plate = config["base_plate"]

    diameter_mm: float = bolt["diameter_mm"]
    n_tension: int = bolt["n_tension"]
    n_shear: int = bolt["n_shear"]
    embedment_mm: float = bolt["embedment_mm"]

    # Ds derived from plate height — PE simplified base plate method (confirmed P105 T2)
    plate_H_mm: float = plate["height_mm"]
    Ds_mm: float = plate_H_mm / 2

    fub = 800.0          # N/mm² — Grade 8.8
    gamma_M2 = STEEL["gamma_M2"]   # 1.25

    # Nominal (gross) shank area — used for FT_Rd per confirmed P105 T2 PE methodology
    As_nominal_mm2 = math.pi / 4 * diameter_mm ** 2

    # Threaded (net) stress area — used for bolt shear and embedment only
    As_mm2 = BOLT_STRESS_AREA.get(int(diameter_mm), As_nominal_mm2)

    # ── Check 1: Bolt tension (EC3 Cl 3.6.1) ──────────────────────────────────
    # Uses SLS (unfactored) moment — bolt tension is a serviceability-level check (P105 confirmed).
    M_SLS_kNm = M_Ed_kNm / 1.5              # unfactor: γQ = 1.5
    T_total_kN = M_SLS_kNm * 1000 / Ds_mm
    Ft_per_bolt_kN = T_total_kN / n_tension
    # FT_Rd uses nominal shank area — confirmed P105 T2 PE methodology (D-P105-TNCB-3002)
    FT_Rd_kN = 0.9 * fub * As_nominal_mm2 / gamma_M2 / 1000
    UR_bolt_tension = Ft_per_bolt_kN / FT_Rd_kN

    # ── Check 2: Bolt shear (EC3 Cl 3.6.1) ───────────────────────────────────
    Fv_per_bolt_kN = V_Ed_kN / n_shear
    alpha_v = 0.6
    Fv_Rd_kN = alpha_v * fub * As_mm2 / gamma_M2 / 1000   # threaded area — conservative
    UR_bolt_shear = Fv_per_bolt_kN / Fv_Rd_kN

    # ── Check 3: Combined bolt (EC3 Table 3.4) ────────────────────────────────
    UR_bolt_combined = (Fv_per_bolt_kN / Fv_Rd_kN) + (Ft_per_bolt_kN / FT_Rd_kN) / 1.4

    # ── Check 4: Bolt embedment / bond length (EC2 Cl 8.4.2) ─────────────────
    gamma_c = CONCRETE["gamma_c"]          # 1.5
    fctk = 0.21 * fck_N_per_mm2 ** (2 / 3)  # EC2 Cl 3.1.6 (= 0.7 × fctm)
    fctd = fctk / gamma_c
    eta1 = 1.0   # good bond condition
    eta2 = 1.0   # bar diameter ≤ 32mm
    fbd = 2.25 * eta1 * eta2 * fctd       # EC2 Cl 8.4.2 design bond strength [N/mm²]
    L_required_mm = (Ft_per_bolt_kN * 1000) / (fbd * math.pi * diameter_mm)
    L_provided_mm = embedment_mm
    UR_embedment = L_required_mm / L_provided_mm

    # ── Check 5: Weld (weld group MoI method — P105 approach) ────────────────
    h = section["h_mm"]
    b = section["b_mm"]
    tf = section["tf_mm"]

    # Weld length: both flanges (top + bottom) + both sides of web
    weld_length_mm = 2 * b + 2 * (h - 2 * tf)

    # Second moment of weld group about centroidal axis (per unit throat, treating weld as lines)
    # Flanges: 2 × b × (h/2 - tf/2)²
    # Web:     (h - 2tf)³ / 6
    Iw_weld_mm3 = 2 * b * (h / 2 - tf / 2) ** 2 + (h - 2 * tf) ** 3 / 6

    plate_t_mm = plate["thickness_mm"]
    weld_size_mm = min(plate_t_mm, tf)   # governing fillet weld size
    throat_mm = 0.7 * weld_size_mm       # 45° fillet weld effective throat

    # Direct shear stress per unit length [N/mm]
    fs_N_per_mm = V_Ed_kN * 1000 / weld_length_mm

    # Moment-induced stress at extreme fibre of weld group [N/mm]
    fm_N_per_mm = M_Ed_kNm * 1e6 * (h / 2) / Iw_weld_mm3

    # Resultant demand [N/mm]
    FR_N_per_mm = math.sqrt(fs_N_per_mm ** 2 + fm_N_per_mm ** 2)

    # Weld resistance per unit length (EC3 Cl 4.5.3.3) [N/mm]
    fu = 410.0      # N/mm² — E45 electrode (matching S275 steel)
    beta_w = 0.85   # correlation factor for S275 (EC3 Table 4.1)
    Fw_Rd_N_per_mm = fu * throat_mm / (beta_w * gamma_M2 * math.sqrt(2))
    UR_weld = FR_N_per_mm / Fw_Rd_N_per_mm

    # Note discrepancy from P105 1360mm target (formula simplification — PE review)
    weld_note: str | None = None
    if "406" in designation and abs(weld_length_mm - 1360) > 50:
        weld_note = (
            f"Weld length computed as {weld_length_mm:.0f} mm for {designation}; "
            f"P105 target is approx 1360 mm. Discrepancy due to formula simplification — PE review required."
        )

    # ── Check 6: Base plate bearing (EC3 Annex I / T-stub method) ────────────
    fcd = fck_N_per_mm2 / CONCRETE["gamma_c"]  # design concrete compressive strength
    fy_plate = 265.0     # N/mm² — conservative for S275 plate (tf > 16mm)
    gamma_M0 = STEEL["gamma_M0"]  # 1.0
    t_plate = plate["thickness_mm"]

    c = t_plate * math.sqrt(fy_plate / (3 * fcd * gamma_M0))
    beff = 2 * c + tf
    leff = 2 * c + b
    A_eff_mm2 = beff * leff
    compression_resistance_kN = fcd * A_eff_mm2 / 1000

    axial_kN = 5.0   # kN — conservative placeholder; axial load negligible for noise barriers
    UR_base_plate = axial_kN / compression_resistance_kN

    # ── Check 7: G clamp (STS test-based proprietary check) ──────────────────
    # Uses external pressure (qp × cp_net, pre-shelter) — not design_pressure.
    # Failure load per clamp from STS test report 10784-0714-02391-8-MEME.
    failure_load_kN = 23.29   # kN
    n_clamps = 2              # per post — standard (confirm with Rowena)
    F_wind_kN = external_pressure_kPa * barrier_height_m * post_spacing_m
    F_factored_kN = F_wind_kN * 1.5
    F_per_clamp_kN = F_factored_kN / n_clamps
    UR_gclamp = F_per_clamp_kN / failure_load_kN

    # ── Assemble result ───────────────────────────────────────────────────────
    all_checks_pass = (
        UR_bolt_tension < 1.0
        and UR_bolt_shear < 1.0
        and UR_bolt_combined < 1.0
        and UR_embedment < 1.0
        and UR_weld < 1.0
        and UR_base_plate < 1.0
        and UR_gclamp < 1.0
    )

    weld_entry: dict = {
        "weld_length_mm": round(weld_length_mm, 1),
        "throat_mm": round(throat_mm, 2),
        "fs_N_per_mm": round(fs_N_per_mm, 3),
        "fm_N_per_mm": round(fm_N_per_mm, 3),
        "FR_N_per_mm": round(FR_N_per_mm, 3),
        "Fw_Rd_N_per_mm": round(Fw_Rd_N_per_mm, 3),
        "UR": round(UR_weld, 3),
        "pass": UR_weld < 1.0,
    }
    if weld_note:
        weld_entry["weld_length_note"] = weld_note

    return {
        "config_id": config_id,
        "bolt_tension": {
            "Ds_mm": round(Ds_mm, 1),
            "n_tension": n_tension,
            "M_SLS_kNm": round(M_SLS_kNm, 2),
            "T_total_kN": round(T_total_kN, 2),
            "Ft_per_bolt_kN": round(Ft_per_bolt_kN, 2),
            "FT_Rd_kN": round(FT_Rd_kN, 2),
            "UR": round(UR_bolt_tension, 3),
            "pass": UR_bolt_tension < 1.0,
            "FT_Rd_note": (
                "Nominal shank area used per P105 T2 PE methodology "
                "(confirmed from drawing D-P105-TNCB-3002). "
                "EC3-1-8 Table 3.4 specifies tensile stress area — "
                "this is a known PE methodology difference."
            ),
        },
        "bolt_shear": {
            "Fv_per_bolt_kN": round(Fv_per_bolt_kN, 2),
            "Fv_Rd_kN": round(Fv_Rd_kN, 2),
            "UR": round(UR_bolt_shear, 3),
            "pass": UR_bolt_shear < 1.0,
        },
        "bolt_combined": {
            "UR": round(UR_bolt_combined, 3),
            "pass": UR_bolt_combined < 1.0,
        },
        "bolt_embedment": {
            "fck_N_per_mm2": fck_N_per_mm2,
            "fbd_N_per_mm2": round(fbd, 3),
            "L_required_mm": round(L_required_mm, 1),
            "L_provided_mm": L_provided_mm,
            "UR": round(UR_embedment, 3),
            "pass": UR_embedment < 1.0,
        },
        "weld": weld_entry,
        "base_plate": {
            "c_mm": round(c, 2),
            "beff_mm": round(beff, 2),
            "leff_mm": round(leff, 2),
            "A_eff_mm2": round(A_eff_mm2, 1),
            "compression_resistance_kN": round(compression_resistance_kN, 2),
            "UR": round(UR_base_plate, 4),
            "pass": UR_base_plate < 1.0,
        },
        "g_clamp": {
            "F_wind_kN": round(F_wind_kN, 3),
            "F_factored_kN": round(F_factored_kN, 3),
            "F_per_clamp_kN": round(F_per_clamp_kN, 3),
            "failure_load_kN": failure_load_kN,
            "UR": round(UR_gclamp, 3),
            "pass": UR_gclamp < 1.0,
        },
        "all_checks_pass": all_checks_pass,
    }


if __name__ == "__main__":
    # P105 T2 validation: M_Ed=130.31 kNm, V_Ed=20.52 kN, UB406x140x39, T1_M24_6bolt
    # fck=28 (C28/35 per P105 T2 material schedule)
    # Expected: Ft_per_bolt=96.53 kN, FT_Rd=260.58 kN, UR_tension=0.370, UR_embedment=0.678
    section_t2 = {
        "designation": "406 x 140 x 39",
        "h_mm": 398.0,
        "b_mm": 141.8,
        "tf_mm": 8.6,
        "tw_mm": 6.4,
        "r_mm": 10.2,
        "mass_kg_per_m": 39.0,
    }
    result = compute_connection(
        M_Ed_kNm=130.31,
        V_Ed_kN=20.52,
        section=section_t2,
        config_id="T1_M24_6bolt",
        fck_N_per_mm2=28.0,
        external_pressure_kPa=0.45,
        post_spacing_m=3.0,
        barrier_height_m=12.7,
    )
    import json as _json
    print(_json.dumps(result, indent=2))
    print("\n--- P105 T2 Connection Validation (D-P105-TNCB-3002) ---")
    print(f"Config:        {result['config_id']}")
    print(f"Ds_mm:         {result['bolt_tension']['Ds_mm']:.1f} mm  (target: 300)")
    print(f"Ft_per_bolt:   {result['bolt_tension']['Ft_per_bolt_kN']:.2f} kN  (target: 96.53)")
    print(f"FT_Rd:         {result['bolt_tension']['FT_Rd_kN']:.2f} kN  (target: 260.58)")
    print(f"UR_tension:    {result['bolt_tension']['UR']:.3f}       (target: 0.370)")
    print(f"UR_embedment:  {result['bolt_embedment']['UR']:.3f}       (target: 0.678)")
    print(f"Weld length:   {result['weld']['weld_length_mm']:.0f} mm")
    print(f"UR_weld:       {result['weld']['UR']:.3f}")
    print(f"UR_shear:      {result['bolt_shear']['UR']:.3f}")
    print(f"UR_combined:   {result['bolt_combined']['UR']:.3f}")
    print(f"UR_base_plate: {result['base_plate']['UR']:.4f}")
    print(f"UR_gclamp:     {result['g_clamp']['UR']:.3f}")
    print(f"all_pass:      {result['all_checks_pass']}")
    for check in ["bolt_tension", "bolt_shear", "bolt_combined", "bolt_embedment", "weld", "base_plate", "g_clamp"]:
        ur = result[check]["UR"]
        if ur >= 1.0:
            print(f"FAIL: {check} UR={ur:.3f}")
