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


def compute_qp(structure_height: float) -> dict:
    """
    Peak velocity pressure at reference height ze = structure_height.

    Returns a dict with all intermediate values and qp in both N/m² and kPa.
    qp is height-dependent — do NOT hardcode it. See code-reference.md Section 3.2.

    Args:
        structure_height: ze in metres. Clamped to zmin (2 m) per EC1.
    """
    vb0 = SG_NA["vb0"]
    rho = SG_NA["rho"]
    kl = SG_NA["kl"]
    kr = SG_NA["kr"]
    z0 = SG_NA["z0"]
    zmin = SG_NA["zmin"]
    co = SG_NA["co"]

    ze = max(structure_height, zmin)

    # EC1 Clause 4.3.2 — roughness factor
    cr = kr * math.log(ze / z0)

    # EC1 Clause 4.3.1 — mean wind velocity
    vm = cr * co * vb0

    # EC1 Clause 4.4 — turbulence intensity
    Iv = kl / (co * math.log(ze / z0))

    # Peak velocity pressure (N/m²)
    qp_Nm2 = (1 + 7 * Iv) * 0.5 * rho * vm ** 2
    qp_kPa = qp_Nm2 / 1000

    return {
        "ze_m": ze,
        "cr": round(cr, 4),
        "vm_m_per_s": round(vm, 4),
        "Iv": round(Iv, 4),
        "qp_N_per_m2": round(qp_Nm2, 2),
        "qp_kPa": round(qp_kPa, 4),
    }


def compute_design_pressure(structure_height: float, shelter_factor: float) -> dict:
    """
    Full wind chain: qp → design_pressure.

    design_pressure = qp × cp,net × ψs                [kPa]
    cp,net = 1.2 (porous panel — EN 1991-1-4 Table 7.9, confirmed P105)
    shelter_factor ψs: 1.0 (no shelter) or derived from Figure 7.20 lookup.

    P105 validation: structure_height=12.7, shelter_factor=0.5
    → qp=0.598 kPa, design_pressure=0.36 kPa ✓

    Args:
        structure_height: barrier height in metres (ze).
        shelter_factor:   ψs — feed 0.5 for P105 validation; 1.0 for no shelter.
    """
    cp_net = SG_NA["cp_net"]
    rho = SG_NA["rho"]
    vb = SG_NA["vb0"]
    cdir = SG_NA["cdir"]
    cseason = SG_NA["cseason"]

    qp_result = compute_qp(structure_height)
    qp_kPa = qp_result["qp_kPa"]
    design_pressure_kPa = qp_kPa * cp_net * shelter_factor

    # Basic wind pressure (height-independent reference)
    # qb = 0.5 × ρ × vb²   P105 validation: qb = 238.80 N/m²
    qb_N_per_m2 = 0.5 * rho * vb ** 2
    qb_kPa = qb_N_per_m2 / 1000

    return {
        **qp_result,
        "vb_m_per_s": vb,
        "cdir": cdir,
        "cseason": cseason,
        "qb_N_per_m2": round(qb_N_per_m2, 2),
        "qb_kPa": round(qb_kPa, 4),
        "cp_net": cp_net,
        "shelter_factor": shelter_factor,
        "design_pressure_kPa": round(design_pressure_kPa, 4),
    }


# ── Validation assertions (run with: python -m pytest or import this module) ──

if __name__ == "__main__":
    result = compute_design_pressure(structure_height=12.7, shelter_factor=0.5)
    print(result)

    assert abs(result["qp_kPa"] - 0.598) < 0.005, (
        f"qp mismatch: got {result['qp_kPa']:.4f}, expected ~0.598"
    )
    assert abs(result["design_pressure_kPa"] - 0.36) < 0.005, (
        f"design_pressure mismatch: got {result['design_pressure_kPa']:.4f}, expected ~0.36"
    )
    print("Wind validation: PASS")
