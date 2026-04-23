"""
Connection design — EC3-1-8 + EC2.

Checks bolt tension, shear, combined, embedment, weld,
base plate bearing, and G clamp.

Dependency: receives M_Ed_kNm and V_Ed_kN from steel module.
Do NOT recompute these — they are fixed upstream outputs.

T1_M24_6bolt config fully validated against P105 T2 calculation
report (Han Engineering, 8/6/2023) and drawing D-P105-TNCB-3002:
  Ft_per_bolt = 96.53 kN  ✓  (Ds=450mm, n_tension=3, M_Ed ULS)
  FT_Rd       = 260.58 kN ✓  (nominal shank area per PE methodology)
  UR_tension  = 0.370     ✓
  UR_embedment = 0.730    ✓  (fck=25 per PE calc; L_req=475mm < 650mm)
  weld_length  = 1360 mm  ✓  (from config — PE page 5)
  n_clamps     = 5        ✓  (PE page 4)

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


def _derive_connection(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    section: dict,
    fck_N_per_mm2: float,
) -> dict:
    """
    Derive minimum-passing connection geometry from M_Ed, V_Ed, and section.

    Derivation per Rowena confirmation (April 2026):
      edge_distance = 50mm fixed, bolt-to-flange = 50mm fixed,
      Ds = plate_height - 2*edge_distance = plate_height - 100mm.

    Returns a dict with plate/bolt geometry and embedment, or {"error": ..., "pass": False}.
    """
    fub = 800.0
    gamma_M2 = STEEL["gamma_M2"]
    gamma_c = CONCRETE["gamma_c"]

    b_mm = section["b_mm"]
    edge = 50.0

    # Plate width: next 50mm multiple above (b + 2*edge), minimum 300mm
    plate_width_mm = max(300, math.ceil((b_mm + 2 * edge) / 50) * 50)

    # Bond strength for embedment check (EC2 Cl 8.4.2) — constant for given fck
    fctm = 0.30 * fck_N_per_mm2 ** (2 / 3)
    fctk = 0.7 * fctm
    fctd = fctk / gamma_c
    fbd = 2.25 * fctd

    # Bolt diameter iteration — M16, M20, M24, M30
    for d in (16, 20, 24, 30):
        As_nom = math.pi / 4 * d ** 2
        FT_Rd_kN = 0.9 * fub * As_nom / gamma_M2 / 1000
        As_shear = BOLT_STRESS_AREA.get(d, As_nom)
        Fv_Rd_kN = 0.6 * fub * As_shear / gamma_M2 / 1000

        n_cols = max(2, math.floor((plate_width_mm - 2 * edge) / (2.4 * d)))
        n_tension = n_cols
        n_shear = n_tension * 2

        Fv_per_bolt_kN = V_Ed_kN / n_shear

        # Check shear independently (does not depend on Ds)
        if Fv_per_bolt_kN >= Fv_Rd_kN:
            continue

        # Find minimum Ds so that both tension UR < 1.0 and embedment L_req <= 750mm.
        # From tension:  Ft = M*1000/(Ds*n_t) < FT_Rd  =>  Ds > M*1000/(FT_Rd*n_t)
        # From embedment: L_req = Ft*1000/(fbd*pi*d) <= 750  => Ft <= 750*fbd*pi*d/1000
        #                  => Ds >= M*1000 / (n_t * 750*fbd*pi*d/1000) = M*1e6 / (n_t * 750*fbd*pi*d)
        Ds_for_tension = M_Ed_kNm * 1000 / (FT_Rd_kN * n_tension)
        Ds_for_embedment = M_Ed_kNm * 1e6 / (n_tension * 750.0 * fbd * math.pi * d)
        Ds_min = max(Ds_for_tension, Ds_for_embedment)

        plate_height_mm = math.ceil((Ds_min + 100) / 50) * 50
        Ds_mm = plate_height_mm - 100.0

        Ft_per_bolt_kN = M_Ed_kNm * 1000 / Ds_mm / n_tension
        UR_tension = Ft_per_bolt_kN / FT_Rd_kN
        UR_shear = Fv_per_bolt_kN / Fv_Rd_kN
        UR_combined = UR_shear + UR_tension / 1.4

        if UR_tension >= 1.0 or UR_combined >= 1.0:
            continue

        L_req_mm = Ft_per_bolt_kN * 1000 / (fbd * math.pi * d)
        std_depths = [450, 550, 650, 750]
        embedment_mm = next((v for v in std_depths if v >= L_req_mm), 750)

        if L_req_mm > 750:
            continue  # rounding pushed it over; try next diameter

        plate_thickness_mm = 20

        return {
            "plate_width_mm": plate_width_mm,
            "plate_height_mm": plate_height_mm,
            "plate_thickness_mm": plate_thickness_mm,
            "Ds_mm": Ds_mm,
            "bolt_diameter_mm": float(d),
            "bolt_grade": "8.8",
            "n_tension": n_tension,
            "n_shear": n_shear,
            "embedment_mm": embedment_mm,
            "L_required_mm": L_req_mm,
            "embedment_sufficient": True,
        }

    return {"error": "No bolt diameter in M16–M30 satisfies tension, shear, combined, and embedment checks.", "pass": False}


def compute_connection(
    M_Ed_kNm: float,
    V_Ed_kN: float,
    section: dict,
    config_id: str | None = None,
    fck_N_per_mm2: float = 25.0,
    qp_kPa: float = 0.598,
    shelter_factor: float = 0.5,
    post_spacing_m: float = 3.0,
    barrier_height_m: float = 12.0,
) -> dict:
    """
    Connection checks: bolt tension, shear, combined, embedment,
    weld (MoI method), base plate bearing, G clamp.

    Args:
        M_Ed_kNm:          Design moment from steel module [kNm]. ULS — used directly.
        V_Ed_kN:           Design shear from steel module [kN]. Not recomputed here.
        section:           Section properties dict from parts library — must include
                           h_mm, b_mm, tf_mm, tw_mm, designation.
        config_id:         Connection config key from connection_library.json.
                           Auto-selected from designation if None.
        fck_N_per_mm2:     Concrete characteristic cylinder strength [N/mm²].
                           Default 25 (C25/30). P105 T2 PE embedment check uses fck=25
                           despite C28/35 project concrete — conservative PE choice.
        qp_kPa:            Peak velocity pressure [kPa]. Passed from frontend Phase 1 result.
                           Default 0.598 kPa (P105 value at ze=12.7m).
        shelter_factor:    ψs from Figure 7.20. External pressure = qp × shelter_factor.
                           cp,net not applied — clamp sees direct face pressure, not net
                           barrier pressure. P105: 0.598 × 0.5 = 0.299 kPa
                           (PE used 0.45 — slightly different shelter assumption at clamp face).
        post_spacing_m:    Post spacing [m]. Drives G clamp wind force.
        barrier_height_m:  Barrier panel height [m]. G clamp uses barrier_height/2
                           as tributary height (confirmed P105 T2 PE methodology).

    Returns:
        Dict with all seven check results and all_checks_pass flag.
    """
    fub = 800.0          # N/mm² — Grade 8.8
    gamma_M2 = STEEL["gamma_M2"]   # 1.25

    # ── Geometry source: dynamic derivation or explicit config ────────────────
    derived = config_id is None
    if derived:
        geo = _derive_connection(M_Ed_kNm, V_Ed_kN, section, fck_N_per_mm2)
        if not geo.get("pass", True) and "error" in geo:
            return {
                "config_id": None,
                "error": geo["error"],
                "all_checks_pass": False,
            }
        diameter_mm: float = geo["bolt_diameter_mm"]
        n_tension: int = geo["n_tension"]
        n_shear: int = geo["n_shear"]
        embedment_mm: float = geo["embedment_mm"]
        Ds_mm: float = geo["Ds_mm"]
        plate_width_mm: float = geo["plate_width_mm"]
        plate_height_mm: float = geo["plate_height_mm"]
        t_plate: float = geo["plate_thickness_mm"]
        e1 = e2 = 50.0
        config_id = "derived"
        weld_length_override: float | None = None
        n_clamps_provided: int = 5  # default; no config for derived path
    else:
        configs = _load_configs()
        config = configs[config_id]
        bolt = config["bolts"]
        plate = config["base_plate"]
        diameter_mm = bolt["diameter_mm"]
        n_tension = bolt["n_tension"]
        n_shear = bolt["n_shear"]
        embedment_mm = bolt["embedment_mm"]
        Ds_mm = bolt.get("Ds_mm", plate["height_mm"] / 2)
        plate_width_mm = plate["width_mm"]
        plate_height_mm = plate["height_mm"]
        t_plate = plate["thickness_mm"]
        e1 = bolt.get("e1_mm", 50.0)
        e2 = bolt.get("e2_mm", 50.0)
        weld_length_override = config.get("weld_length_mm")
        n_clamps_provided = config.get("n_clamps_per_post", 5)

    # Nominal (gross) shank area — used for FT_Rd per confirmed P105 T2 PE methodology
    As_nominal_mm2 = math.pi / 4 * diameter_mm ** 2

    # Threaded (net) stress area — used for bolt shear only
    As_mm2 = BOLT_STRESS_AREA.get(int(diameter_mm), As_nominal_mm2)

    # ── Check 1: Bolt tension (EC3 Cl 3.6.1) ──────────────────────────────────
    # PE report uses ULS design moment M_Ed directly (page 10, confirmed P105 T2).
    T_total_kN = M_Ed_kNm * 1000 / Ds_mm
    Ft_per_bolt_kN = T_total_kN / n_tension
    # FT_Rd uses nominal shank area — confirmed P105 T2 PE methodology
    FT_Rd_kN = 0.9 * fub * As_nominal_mm2 / gamma_M2 / 1000
    UR_bolt_tension = Ft_per_bolt_kN / FT_Rd_kN

    # ── Check 2: Bolt shear (EC3 Cl 3.6.1) ───────────────────────────────────
    Fv_per_bolt_kN = V_Ed_kN / n_shear
    alpha_v = 0.6
    Fv_Rd_kN = alpha_v * fub * As_mm2 / gamma_M2 / 1000   # threaded area — conservative
    UR_bolt_shear = Fv_per_bolt_kN / Fv_Rd_kN

    # ── Check 2b: Bolt bearing (EC3-1-8 Table 3.4) ───────────────────────────
    d0 = diameter_mm + 2.0  # hole diameter [mm]
    fu = 410.0              # N/mm² — plate steel S275/S355 ultimate

    alpha_d = e1 / (3.0 * d0)
    alpha_fub = fub / fu
    alpha_bearing = min(alpha_d, alpha_fub, 1.0)

    k1 = min(2.8 * e2 / d0 - 1.7, 2.5)

    Fb_Rd_kN = k1 * alpha_bearing * fub * diameter_mm * t_plate / gamma_M2 / 1000

    governing_bolt_force_kN = max(Fv_per_bolt_kN, Ft_per_bolt_kN)
    UR_bolt_bearing = governing_bolt_force_kN / Fb_Rd_kN

    # ── Check 3: Combined bolt (EC3 Table 3.4) ────────────────────────────────
    UR_bolt_combined = (Fv_per_bolt_kN / Fv_Rd_kN) + (Ft_per_bolt_kN / FT_Rd_kN) / 1.4

    # ── Check 4: Bolt embedment / bond length (EC2 Cl 8.4.2) ─────────────────
    gamma_c = CONCRETE["gamma_c"]          # 1.5
    fctk = 0.21 * fck_N_per_mm2 ** (2 / 3)  # EC2 Cl 3.1.6 (= 0.7 x fctm)
    fctd = fctk / gamma_c
    eta1 = 1.0   # good bond condition
    eta2 = 1.0   # bar diameter <= 32mm
    fbd = 2.25 * eta1 * eta2 * fctd       # EC2 Cl 8.4.2 design bond strength [N/mm2]
    L_required_mm = (Ft_per_bolt_kN * 1000) / (fbd * math.pi * diameter_mm)
    L_provided_mm = embedment_mm
    UR_embedment = L_required_mm / L_provided_mm

    # ── Check 5: Weld (weld group MoI method — P105 approach) ────────────────
    h = section["h_mm"]
    b = section["b_mm"]
    tf = section["tf_mm"]

    # Weld length: PE-confirmed config value if available, else formula
    weld_length_mm: float = weld_length_override or (2 * b + 2 * (h - 2 * tf))

    # Second moment of weld group about centroidal axis (per unit throat, treating weld as lines)
    # Flanges: 2 x b x (h/2 - tf/2)^2
    # Web:     (h - 2tf)^3 / 6
    Iw_weld_mm3 = 2 * b * (h / 2 - tf / 2) ** 2 + (h - 2 * tf) ** 3 / 6

    weld_size_mm = min(t_plate, tf)      # governing fillet weld size
    throat_mm = 0.7 * weld_size_mm      # 45-degree fillet weld effective throat

    # Direct shear stress per unit length [N/mm]
    fs_N_per_mm = V_Ed_kN * 1000 / weld_length_mm

    # Moment-induced stress at extreme fibre of weld group [N/mm] — uses M_Ed (ULS)
    fm_N_per_mm = M_Ed_kNm * 1e6 * (h / 2) / Iw_weld_mm3

    # Resultant demand [N/mm]
    FR_N_per_mm = math.sqrt(fs_N_per_mm ** 2 + fm_N_per_mm ** 2)

    # Weld resistance per unit length (EC3 Cl 4.5.3.3) [N/mm]
    # fu already defined above (410 N/mm2 — E45 electrode matching S275 steel)
    beta_w = 0.85   # correlation factor for S275 (EC3 Table 4.1)
    Fw_Rd_N_per_mm = fu * throat_mm / (beta_w * gamma_M2 * math.sqrt(2))
    UR_weld = FR_N_per_mm / Fw_Rd_N_per_mm

    weld_source = "config" if weld_length_override else "formula (2b+2(h-2tf))"

    # ── Check 6: Base plate bearing (EC3 Annex I / T-stub method) ────────────
    fcd = fck_N_per_mm2 / CONCRETE["gamma_c"]  # design concrete compressive strength
    fy_plate = 265.0     # N/mm2 — conservative for S275 plate (tf > 16mm)
    gamma_M0 = STEEL["gamma_M0"]  # 1.0

    c = t_plate * math.sqrt(fy_plate / (3 * fcd * gamma_M0))
    beff = 2 * c + tf
    leff = 2 * c + b
    A_eff_mm2 = beff * leff
    compression_resistance_kN = fcd * A_eff_mm2 / 1000

    axial_kN = 5.0   # kN — conservative placeholder; axial load negligible for noise barriers
    UR_base_plate_bearing = axial_kN / compression_resistance_kN

    # ── Check 6b: Base plate bending ─────────────────────────────────────────
    e_bolt_mm = 50.0
    Z_plate_mm3 = plate_width_mm * t_plate ** 2 / 4
    M_cap_kNm = fy_plate * Z_plate_mm3 / 1e6
    M_demand_kNm_plate = Ft_per_bolt_kN * e_bolt_mm / 1000
    UR_base_plate_bending = M_demand_kNm_plate / M_cap_kNm

    # ── Check 7: G clamp (STS test-based proprietary check) ──────────────────
    # External pressure = qp × shelter_factor. cp,net not applied — clamp sees
    # direct face pressure, not net barrier pressure.
    # Failure load per clamp from STS test report 10784-0714-02391-8-MEME.
    # G clamp tributary height = barrier_height/2 — confirmed P105 T2 PE page 4.
    # n_clamps from config; defaults to 5 (PE page 4 confirmed).
    failure_load_kN = 23.29   # kN
    external_pressure_kPa = qp_kPa * shelter_factor
    F_wind_kN = external_pressure_kPa * (barrier_height_m / 2) * post_spacing_m
    F_factored_kN = F_wind_kN * 1.5
    n_clamps_required = math.ceil(F_factored_kN / failure_load_kN)
    n_clamps = max(n_clamps_required, n_clamps_provided)
    F_per_clamp_kN = F_factored_kN / n_clamps
    UR_gclamp = F_per_clamp_kN / failure_load_kN

    # ── Assemble result ───────────────────────────────────────────────────────
    all_checks_pass = (
        UR_bolt_tension < 1.0
        and UR_bolt_shear < 1.0
        and UR_bolt_bearing < 1.0
        and UR_bolt_combined < 1.0
        and UR_embedment < 1.0
        and UR_weld < 1.0
        and UR_base_plate_bearing < 1.0
        and UR_base_plate_bending < 1.0
        and UR_gclamp < 1.0
    )

    return {
        "config_id": config_id,
        "bolt_diameter_mm": float(diameter_mm),
        "bolt_tension": {
            "bolt_diameter_mm": float(diameter_mm),
            "Ds_mm": round(Ds_mm, 1),
            "n_tension": n_tension,
            "T_total_kN": round(T_total_kN, 2),
            "Ft_per_bolt_kN": round(Ft_per_bolt_kN, 2),
            "FT_Rd_kN": round(FT_Rd_kN, 2),
            "UR": round(UR_bolt_tension, 3),
            "pass": UR_bolt_tension < 1.0,
            "FT_Rd_note": (
                "Nominal shank area used per P105 T2 PE methodology "
                "(confirmed from calculation report Han Engineering 8/6/2023). "
                "EC3-1-8 Table 3.4 specifies tensile stress area — "
                "this is a known PE methodology difference."
            ),
        },
        "bolt_shear": {
            "n_shear": n_shear,
            "Fv_per_bolt_kN": round(Fv_per_bolt_kN, 2),
            "Fv_Rd_kN": round(Fv_Rd_kN, 2),
            "UR": round(UR_bolt_shear, 3),
            "pass": UR_bolt_shear < 1.0,
        },
        "bolt_bearing": {
            "d0_mm": d0,
            "e1_mm": e1,
            "e2_mm": e2,
            "alpha_d": round(alpha_d, 4),
            "alpha_fub": round(alpha_fub, 4),
            "alpha": round(alpha_bearing, 4),
            "k1": round(k1, 4),
            "Fb_Rd_kN": round(Fb_Rd_kN, 2),
            "UR": round(UR_bolt_bearing, 3),
            "pass": UR_bolt_bearing < 1.0,
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
        "weld": {
            "weld_length_mm": round(weld_length_mm, 1),
            "weld_length_source": weld_source,
            "throat_mm": round(throat_mm, 2),
            "fs_N_per_mm": round(fs_N_per_mm, 3),
            "fm_N_per_mm": round(fm_N_per_mm, 3),
            "FR_N_per_mm": round(FR_N_per_mm, 3),
            "Fw_Rd_N_per_mm": round(Fw_Rd_N_per_mm, 3),
            "UR": round(UR_weld, 3),
            "pass": UR_weld < 1.0,
        },
        "base_plate": {
            "plate_width_mm": float(plate_width_mm),
            "plate_height_mm": float(plate_height_mm),
            "plate_thickness_mm": float(t_plate),
            "base_plate_bearing": {
                "plate_width_mm": float(plate_width_mm),
                "plate_height_mm": float(plate_height_mm),
                "plate_thickness_mm": float(t_plate),
                "c_mm": round(c, 2),
                "beff_mm": round(beff, 2),
                "leff_mm": round(leff, 2),
                "A_eff_mm2": round(A_eff_mm2, 1),
                "compression_resistance_kN": round(compression_resistance_kN, 2),
                "UR": round(UR_base_plate_bearing, 4),
                "pass": UR_base_plate_bearing < 1.0,
            },
            "base_plate_bending": {
                "plate_width_mm": float(plate_width_mm),
                "plate_height_mm": float(plate_height_mm),
                "plate_thickness_mm": float(t_plate),
                "e_bolt_mm": round(e_bolt_mm, 1),
                "Z_plate_mm3": round(Z_plate_mm3, 1),
                "M_cap_kNm": round(M_cap_kNm, 3),
                "M_demand_kNm": round(M_demand_kNm_plate, 3),
                "UR": round(UR_base_plate_bending, 3),
                "pass": UR_base_plate_bending < 1.0,
            },
            # Top-level UR/pass: governing of the two sub-checks (for backward compat)
            "UR": round(max(UR_base_plate_bearing, UR_base_plate_bending), 4),
            "pass": UR_base_plate_bearing < 1.0 and UR_base_plate_bending < 1.0,
        },
        "g_clamp": {
            "n_clamps_required": n_clamps_required,
            "n_clamps_provided": n_clamps_provided,
            "n_clamps": n_clamps,
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
    import json as _json

    section_t2 = {
        "designation": "406 x 140 x 39",
        "h_mm": 398.0,
        "b_mm": 141.8,
        "tf_mm": 8.6,
        "tw_mm": 6.4,
        "r_mm": 10.2,
        "mass_kg_per_m": 39.0,
    }

    # ── Run A: dynamic derivation (config_id=None) ────────────────────────────
    print("=== Run A — Dynamic derivation (config_id=None) ===")
    ra = compute_connection(
        M_Ed_kNm=130.31,
        V_Ed_kN=20.52,
        section=section_t2,
        config_id=None,
        fck_N_per_mm2=25.0,
        qp_kPa=0.598,
        shelter_factor=0.5,
        post_spacing_m=3.0,
        barrier_height_m=12.0,
    )
    print(_json.dumps(ra, indent=2))
    print("\nNote: P105 PE used M24 (project preference). Engine minimum-passing "
          "selection may differ — PE reviews and overrides if needed.")

    bt = ra["bolt_tension"]
    bs = ra["bolt_shear"]
    be = ra["bolt_embedment"]
    assert bt["UR"] < 1.0, f"UR_tension={bt['UR']:.3f} >= 1.0"
    assert bs["UR"] < 1.0, f"UR_shear={bs['UR']:.3f} >= 1.0"
    assert ra["bolt_combined"]["UR"] < 1.0, f"UR_combined={ra['bolt_combined']['UR']:.3f} >= 1.0"
    assert be["L_required_mm"] <= be["L_provided_mm"], (
        f"embedment insufficient: L_req={be['L_required_mm']:.1f} > L_prov={be['L_provided_mm']}"
    )
    assert ra["bolt_tension"]["Ds_mm"] > 0
    print("Run A: all assertions PASS")

    # ── Run B: config path (config_id="T1_M24_6bolt") — PE validation ────────
    # G clamp: external_pressure = qp × shelter = 0.598 × 0.5 = 0.299 kPa
    # F_wind = 0.299 × 6.0 × 3.0 = 5.382 kN, F_factored = 8.073 kN
    # F_per_clamp = 8.073 / 5 = 1.615 kN, UR = 1.615 / 23.29 = 0.069
    print("\n=== Run B — Config path (T1_M24_6bolt) — P105 T2 PE validation ===")
    rb = compute_connection(
        M_Ed_kNm=130.31,
        V_Ed_kN=20.52,
        section=section_t2,
        config_id="T1_M24_6bolt",
        fck_N_per_mm2=25.0,
        qp_kPa=0.598,
        shelter_factor=0.5,
        post_spacing_m=3.0,
        barrier_height_m=12.0,
    )
    print(_json.dumps(rb, indent=2))
    print("\n--- P105 T2 Connection Validation (Han Engineering 8/6/2023) ---")
    print(f"Ft_per_bolt:   {rb['bolt_tension']['Ft_per_bolt_kN']:.2f} kN  (target: 96.53)")
    print(f"FT_Rd:         {rb['bolt_tension']['FT_Rd_kN']:.2f} kN  (target: 260.58)")
    print(f"UR_tension:    {rb['bolt_tension']['UR']:.3f}       (target: 0.370)")
    print(f"UR_embedment:  {rb['bolt_embedment']['UR']:.3f}       (target: 0.731)")
    print(f"G clamp n:     {rb['g_clamp']['n_clamps']}  (target: 5)")
    print(f"G clamp UR:    {rb['g_clamp']['UR']:.3f}       (target: 0.069)")
    assert abs(rb["bolt_tension"]["Ft_per_bolt_kN"] - 96.53) < 0.01, "Ft_per_bolt mismatch"
    assert abs(rb["bolt_tension"]["FT_Rd_kN"] - 260.58) < 0.01, "FT_Rd mismatch"
    assert abs(rb["bolt_tension"]["UR"] - 0.370) < 0.001, "UR_tension mismatch"
    assert abs(rb["bolt_embedment"]["UR"] - 0.731) < 0.001, "UR_embedment mismatch"
    assert rb["g_clamp"]["n_clamps"] == 5, "n_clamps mismatch"
    assert abs(rb["g_clamp"]["UR"] - 0.069) < 0.001, f"UR_gclamp mismatch: got {rb['g_clamp']['UR']:.3f}"
    print("Run B: all P105 T2 assertions PASS")
