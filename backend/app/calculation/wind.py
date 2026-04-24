"""
Wind pressure calculation — EN 1991-1-4 with Singapore National Annex.

All formulas ✅ CONFIRMED across PE calculation reports.
Reference: code-reference.md Section 3. Primary source: P105 Punggol, PE Lim Han Chong.

P105 validation target (feed as inputs):
  structure_height = 12.7 m, shelter_factor = 0.5
  → qp = 0.598 kPa, design_pressure = 0.36 kPa
"""

from __future__ import annotations

import math

from .constants import SG_NA

# EC1-1-4 Table 4.1 — terrain category roughness length z0 and minimum height zmin
TERRAIN_Z0: dict[str, float] = {
    '0':   0.003,
    'I':   0.01,
    'II':  0.05,
    'III': 0.3,
    'IV':  1.0,
}
TERRAIN_ZMIN: dict[str, float] = {
    '0':   1.0,
    'I':   1.0,
    'II':  2.0,
    'III': 5.0,
    'IV':  10.0,
}


def compute_qp(
    structure_height: float,
    vb: float | None = None,
    return_period: int = 50,
    terrain_category: str = 'II',
) -> dict:
    """
    Peak velocity pressure at reference height ze = structure_height.

    Returns a dict with all intermediate values and qp in both N/m² and kPa.
    qp is height-dependent — do NOT hardcode it. See code-reference.md Section 3.2.

    Args:
        structure_height:  ze in metres. Clamped to zmin per EC1 Cl 4.3.2.
        vb:                basic wind velocity [m/s]. Defaults to SG NA 20 m/s.
        return_period:     T in years. Drives Cprob per EC1 Eq 4.2. Default 50yr → Cprob=1.0.
        terrain_category:  EC1-1-4 Table 4.1 category: '0', 'I', 'II', 'III', 'IV'. Default 'II'.
    """
    vb_base = vb if vb is not None else SG_NA["vb0"]

    # EC1 Equation 4.2 — probability factor Cprob (SG NA: K=0.2, n=0.5)
    # At T=50yr: Cprob = 1.0 exactly (no change to P105 results)
    K = 0.2
    n_exp = 0.5
    numerator = 1 - K * math.log(-math.log(1 - 1 / return_period))
    denominator = 1 - K * math.log(-math.log(0.98))  # 50yr baseline
    Cprob = (numerator / denominator) ** n_exp
    vb0 = vb_base * Cprob
    rho = SG_NA["rho"]
    kl = SG_NA["kl"]
    kr = SG_NA["kr"]
    z0   = TERRAIN_Z0.get(terrain_category, 0.05)
    zmin = TERRAIN_ZMIN.get(terrain_category, 2.0)
    co = SG_NA["co"]

    # EC1 Cl 4.3.2 — apply zmin: use ze_effective for roughness and turbulence calculations
    ze_effective = max(structure_height, zmin)

    # EC1 Clause 4.3.2 — roughness factor
    cr = kr * math.log(ze_effective / z0)

    # EC1 Clause 4.3.1 — mean wind velocity
    vm = cr * co * vb0

    # EC1 Clause 4.4 — turbulence intensity
    Iv = kl / (co * math.log(ze_effective / z0))

    # Peak velocity pressure (N/m²)
    qp_Nm2 = (1 + 7 * Iv) * 0.5 * rho * vm ** 2
    qp_kPa = qp_Nm2 / 1000

    return {
        "ze_m": structure_height,
        "ze_effective_m": ze_effective,
        "z0_m": z0,
        "zmin_m": zmin,
        "terrain_category": terrain_category,
        "cr": round(cr, 4),
        "vm_m_per_s": round(vm, 4),
        "Iv": round(Iv, 4),
        "qp_N_per_m2": round(qp_Nm2, 2),
        "qp_kPa": round(qp_kPa, 4),
    }


def compute_design_pressure(
    structure_height: float,
    shelter_factor: float,
    vb: float | None = None,
    return_period: int = 50,
    cp_net: float = 1.2,
    barrier_length_m: float | None = None,
    has_return_corners: bool = False,
    terrain_category: str = 'II',
) -> dict:
    """
    Full wind chain: qp → design_pressure.

    design_pressure = qp × cp,net × ψs                [kPa]
    cp,net: user-selectable — default 1.2 (porous panel, EN 1991-1-4 Table 7.9, confirmed P105).
    shelter_factor ψs: 1.0 (no shelter) or derived from Figure 7.20 lookup.

    P105 validation: structure_height=12.7, shelter_factor=0.5, cp_net=1.2
    → qp=0.598 kPa, design_pressure=0.36 kPa ✓

    Args:
        structure_height:  barrier height in metres (ze).
        shelter_factor:    ψs — feed 0.5 for P105 validation; 1.0 for no shelter.
        vb:                basic wind velocity [m/s]. Defaults to SG NA 20 m/s.
        return_period:     T in years. Drives Cprob per EC1 Eq 4.2. Default 50yr → Cprob=1.0.
        cp_net:            Net pressure coefficient. Default 1.2 (porous TNCB panels).
        terrain_category:  EC1-1-4 Table 4.1 category. Default 'II' (suburban/roadside).
    """
    rho = SG_NA["rho"]
    vb_base = vb if vb is not None else SG_NA["vb0"]
    cdir = SG_NA["cdir"]
    cseason = SG_NA["cseason"]

    qp_result = compute_qp(structure_height, vb=vb_base, return_period=return_period, terrain_category=terrain_category)
    qp_kPa = qp_result["qp_kPa"]
    ze = qp_result["ze_m"]
    ze_effective = qp_result["ze_effective_m"]
    design_pressure_kPa = qp_kPa * cp_net * shelter_factor
    lh_ratio = round(barrier_length_m / ze_effective, 2) if barrier_length_m else None

    # Recover Cprob from qp_result to include in response
    # (recomputed identically — avoids returning it from compute_qp which is a lower-level fn)
    K = 0.2
    n_exp = 0.5
    numerator = 1 - K * math.log(-math.log(1 - 1 / return_period))
    denominator = 1 - K * math.log(-math.log(0.98))
    Cprob = round((numerator / denominator) ** n_exp, 4)
    vb_effective = vb_base * Cprob

    # Basic wind pressure (height-independent reference)
    # qb = 0.5 × ρ × vb_effective²   P105 validation: qb = 238.80 N/m²
    qb_N_per_m2 = 0.5 * rho * vb_effective ** 2
    qb_kPa = qb_N_per_m2 / 1000

    return {
        **qp_result,
        "vb_m_per_s": vb_effective,
        "cdir": cdir,
        "cseason": cseason,
        "return_period": return_period,
        "Cprob": Cprob,
        "qb_N_per_m2": round(qb_N_per_m2, 2),
        "qb_kPa": round(qb_kPa, 4),
        "cp_net": cp_net,
        "shelter_factor": shelter_factor,
        "design_pressure_kPa": round(design_pressure_kPa, 4),
        "lh_ratio": lh_ratio,
    }


# ── Validation assertions (run with: python -m pytest or import this module) ──

if __name__ == "__main__":
    # P105 T2: Category II, ze=12.7m > zmin=2.0m → ze_effective=12.7m, qp unchanged
    result = compute_design_pressure(structure_height=12.7, shelter_factor=0.5, terrain_category='II')
    print(result)

    assert abs(result["qp_kPa"] - 0.598) < 0.005, (
        f"qp mismatch: got {result['qp_kPa']:.4f}, expected ~0.598"
    )
    assert abs(result["design_pressure_kPa"] - 0.36) < 0.005, (
        f"design_pressure mismatch: got {result['design_pressure_kPa']:.4f}, expected ~0.36"
    )
    assert result["terrain_category"] == 'II', "terrain_category mismatch"
    assert result["z0_m"] == 0.05, "z0_m mismatch"
    assert result["zmin_m"] == 2.0, "zmin_m mismatch"
    assert result["ze_effective_m"] == 12.7, "ze_effective_m mismatch — zmin should not clamp here"

    # Category I: higher cr than Category II at same ze
    r_cat1 = compute_design_pressure(structure_height=9.0, shelter_factor=1.0, terrain_category='I')
    r_cat2 = compute_design_pressure(structure_height=9.0, shelter_factor=1.0, terrain_category='II')
    assert r_cat1["qp_kPa"] > r_cat2["qp_kPa"], "Category I should give higher qp than Category II"

    # zmin clamp: Category IV, ze=8m < zmin=10m → ze_effective=10m
    r_zmin = compute_design_pressure(structure_height=8.0, shelter_factor=1.0, terrain_category='IV')
    assert r_zmin["ze_effective_m"] == 10.0, f"zmin clamp failed: got {r_zmin['ze_effective_m']}"

    print("Wind validation: PASS")
