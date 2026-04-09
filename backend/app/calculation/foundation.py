"""
Foundation design — EC7 Annex D, DA1-C1 / DA1-C2 / SLS.

Branches by footing_type:
  "Exposed pad" → Branch A (μ = 0.3 base friction, Meyerhof eccentric bearing)
  "Embedded RC" → Branch B (tanφ friction, passive earth, EC7 Annex D bearing)

All formulas ✅ CONFIRMED. Reference: code-reference.md Section 7.
Primary source: P105 Punggol PE reports (Lim Han Chong).

DA1 partial factors (code-reference.md Section 7.2):
  DA1-C1: γQ = 1.5, γφ = 1.0  → factored loads, unfactored strength
  DA1-C2: γQ = 1.3, γφ = 1.25 → moderately factored loads, factored strength
  SLS:    γQ = 1.0, γφ = 1.0  → unfactored
"""

from __future__ import annotations

import math

from .constants import DA1_C1, DA1_C2, DA1_SLS


def _bearing_factors_drained(phi_d_deg: float) -> tuple[float, float, float]:
    """Nq, Nc, Nγ from EC7 Annex D.4 with P105 Nγ formula.

    Nγ = 1.5 × (Nq - 1) × tanφ   ← P105 T1/T2 confirmed formula.
    Alternative: 2(Nq-1)tanφ — see code-reference.md Section 7.4 / Section 8 item 3.
    """
    phi_rad = math.radians(phi_d_deg)
    Nq = math.exp(math.pi * math.tan(phi_rad)) * math.tan(math.radians(45) + phi_rad / 2) ** 2
    Nc = (Nq - 1) / math.tan(phi_rad) if phi_d_deg > 0 else 5.14
    Ny = 1.5 * (Nq - 1) * math.tan(phi_rad)  # P105 confirmed formula
    return Nq, Nc, Ny


def _shape_factors(B_prime: float, L_prime: float, phi_d_deg: float, Nq: float) -> dict:
    """EC7 Annex D.4 shape factors. Inclination factors = 1 (vertical load assumption)."""
    phi_rad = math.radians(phi_d_deg)
    sq = 1 + (B_prime / L_prime) * math.sin(phi_rad)
    sc = (sq * Nq - 1) / (Nq - 1) if Nq > 1 else 1.0
    sy = 1 - 0.3 * (B_prime / L_prime)
    return {"sq": round(sq, 4), "sc": round(sc, 4), "sy": round(sy, 4)}


def _bearing_capacity_drained(
    phi_k_deg: float,
    gamma_phi: float,
    c_k_kPa: float,
    gamma_s_kN_m3: float,
    q_kPa: float,
    B_m: float,
    W_m: float,
    e_m: float = 0.0,
) -> dict:
    """
    EC7 Annex D.4 drained bearing capacity qu [kPa].

    Args:
        phi_k_deg:      characteristic friction angle [degrees]
        gamma_phi:      partial factor on φ (1.0 for DA1-C1, 1.25 for DA1-C2)
        c_k_kPa:        characteristic cohesion c'k [kPa]
        gamma_s_kN_m3:  soil unit weight [kN/m³]
        q_kPa:          overburden pressure at foundation level = γs × D [kPa]
        B_m:            footing width in wind direction [m]
        W_m:            footing length perpendicular to wind [m]
        e_m:            load eccentricity [m]; B' = B - 2e
    """
    phi_d_deg = phi_k_deg / gamma_phi
    # Factored cohesion — same γ for c' as for φ per EC7
    c_d_kPa = c_k_kPa / gamma_phi

    B_prime = max(B_m - 2 * e_m, 0.01)  # effective width
    L_prime = W_m  # perpendicular dimension unchanged

    Nq, Nc, Ny = _bearing_factors_drained(phi_d_deg)
    sf = _shape_factors(B_prime, L_prime, phi_d_deg, Nq)

    # All inclination and base factors = 1 (vertical load, flat base — confirmed P105)
    qu = (
        c_d_kPa * Nc * sf["sc"]
        + q_kPa * Nq * sf["sq"]
        + 0.5 * gamma_s_kN_m3 * B_prime * Ny * sf["sy"]
    )
    return {
        "phi_d_deg": round(phi_d_deg, 2),
        "Nq": round(Nq, 3),
        "Nc": round(Nc, 3),
        "Ny": round(Ny, 3),
        "sq": sf["sq"], "sc": sf["sc"], "sy": sf["sy"],
        "B_prime_m": round(B_prime, 3),
        "qu_kPa": round(qu, 2),
    }


def _run_combination(
    label: str,
    gamma_Q: float,
    gamma_phi: float,
    fos_limit_sliding: float,
    fos_limit_overturning: float,
    H_SLS_kN: float,
    M_SLS_kNm: float,
    P_G_kN: float,
    footing_type: str,
    phi_k_deg: float,
    c_k_kPa: float,
    gamma_s_kN_m3: float,
    mu: float,
    B_m: float,
    W_m: float,
    D_m: float,
    q_overburden_kPa: float,
    Pp_kN: float = 0.0,
    e_m: float = 0.0,
) -> dict:
    """Run one DA1 combination or SLS check and return results dict."""
    H = H_SLS_kN * gamma_Q
    M = M_SLS_kNm * gamma_Q

    if footing_type == "Exposed pad":
        # Sliding: μ × P_G (unfactored vertical favourable load)
        F_R_sliding = mu * P_G_kN
    else:
        # Embedded: tanφd × P_G + Pp (passive)
        phi_d = math.radians(phi_k_deg / gamma_phi)
        F_R_sliding = P_G_kN * math.tan(phi_d) + Pp_kN

    FOS_sliding = F_R_sliding / H if H > 0 else float("inf")
    pass_sliding = FOS_sliding >= fos_limit_sliding

    # Overturning
    M_Rd_overturning = P_G_kN * (B_m / 2) + (Pp_kN * D_m / 3 if footing_type == "Embedded RC" else 0.0)
    FOS_overturning = M_Rd_overturning / M if M > 0 else float("inf")
    pass_overturning = FOS_overturning >= fos_limit_overturning

    # Bearing (eccentricity from overturning moment)
    e_bearing = M / P_G_kN if P_G_kN > 0 else 0.0

    bearing_result: dict = {}
    pass_bearing = True

    if footing_type == "Exposed pad":
        A = B_m * W_m
        if e_bearing > B_m / 6:
            b_prime = B_m - 2 * e_bearing
            q_max = 4 * P_G_kN / (3 * W_m * b_prime) if b_prime > 0 else float("inf")
        else:
            q_max = P_G_kN / A * (1 + 6 * e_bearing / B_m)
        pass_bearing = q_max <= q_overburden_kPa  # q_overburden reused as q_allow for exposed
        bearing_result = {
            "e_m": round(e_bearing, 3),
            "q_max_kPa": round(q_max, 2),
            "q_allow_kPa": round(q_overburden_kPa, 2),
            "UR_bearing": round(q_max / q_overburden_kPa, 3) if q_overburden_kPa > 0 else None,
        }
    else:
        bearing = _bearing_capacity_drained(
            phi_k_deg=phi_k_deg,
            gamma_phi=gamma_phi,
            c_k_kPa=c_k_kPa,
            gamma_s_kN_m3=gamma_s_kN_m3,
            q_kPa=q_overburden_kPa,
            B_m=B_m,
            W_m=W_m,
            e_m=e_bearing,
        )
        q_applied = P_G_kN / (bearing["B_prime_m"] * W_m)
        pass_bearing = q_applied <= bearing["qu_kPa"]
        bearing_result = {
            **bearing,
            "q_applied_kPa": round(q_applied, 2),
            "UR_bearing": round(q_applied / bearing["qu_kPa"], 3) if bearing["qu_kPa"] > 0 else None,
        }

    return {
        "label": label,
        "H_factored_kN": round(H, 2),
        "M_factored_kNm": round(M, 2),
        "F_R_sliding_kN": round(F_R_sliding, 2),
        "FOS_sliding": round(FOS_sliding, 3),
        "pass_sliding": pass_sliding,
        "fos_limit_sliding": fos_limit_sliding,
        "M_Rd_overturning_kNm": round(M_Rd_overturning, 2),
        "FOS_overturning": round(FOS_overturning, 3),
        "pass_overturning": pass_overturning,
        "fos_limit_overturning": fos_limit_overturning,
        "bearing": bearing_result,
        "pass_bearing": pass_bearing,
        "pass": pass_sliding and pass_overturning and pass_bearing,
    }


def compute_foundation(
    H_SLS_kN: float,
    M_SLS_kNm: float,
    P_G_kN: float,
    footing_type: str,
    phi_k_deg: float = 30.0,
    gamma_s_kN_m3: float = 20.0,
    c_k_kPa: float = 0.0,
    allowable_soil_bearing_kPa: float = 75.0,
    footing_B_m: float = 1.0,
    footing_W_m: float = 1.0,
    footing_D_m: float = 0.0,
) -> dict:
    """
    Foundation check — three combinations: SLS, DA1-C1, DA1-C2.

    Args:
        H_SLS_kN:               unfactored horizontal wind force at base [kN]
        M_SLS_kNm:              unfactored moment at foundation base [kNm]
        P_G_kN:                 permanent vertical load (self-weight of post + footing) [kN]
        footing_type:           "Exposed pad" or "Embedded RC"
        phi_k_deg:              soil friction angle φk [degrees] — user input
        gamma_s_kN_m3:          soil unit weight γs [kN/m³] — user input
        c_k_kPa:                cohesion c'k [kPa] — user input
        allowable_soil_bearing_kPa: q_allow for exposed pad bearing [kPa]
        footing_B_m:            footing dimension in wind direction [m]
        footing_W_m:            footing dimension perpendicular to wind [m]
        footing_D_m:            embedment depth below ground [m] (0 for exposed pad)

    Returns:
        Dict with SLS, DA1-C1, DA1-C2 results and overall pass/fail.
    """
    mu = 0.3  # base friction coefficient — ✅ CONFIRMED (Faber Walk), exposed pad only

    # Passive earth resistance (used in embedded branch)
    # PROVISIONAL: P105 T1/T2 evaluate Pp = 0 — confirmed not relied upon in those reports.
    # Computed here for completeness; override to 0 if not relied upon.
    q_overburden = gamma_s_kN_m3 * footing_D_m  # kPa overburden at base

    Pp_DA1C1 = 0.0  # passive not relied upon (see code-reference.md Section 7.4)
    Pp_DA1C2 = 0.0

    # For exposed pad bearing check, pass q_allow as the capacity reference
    q_ref_for_exposed = allowable_soil_bearing_kPa

    common = dict(
        H_SLS_kN=H_SLS_kN,
        M_SLS_kNm=M_SLS_kNm,
        P_G_kN=P_G_kN,
        footing_type=footing_type,
        phi_k_deg=phi_k_deg,
        c_k_kPa=c_k_kPa,
        gamma_s_kN_m3=gamma_s_kN_m3,
        mu=mu,
        B_m=footing_B_m,
        W_m=footing_W_m,
        D_m=footing_D_m,
        q_overburden_kPa=q_overburden if footing_type == "Embedded RC" else q_ref_for_exposed,
    )

    sls = _run_combination(
        label="SLS",
        gamma_Q=DA1_SLS["gamma_Q"],
        gamma_phi=DA1_SLS["gamma_phi"],
        fos_limit_sliding=DA1_SLS["fos_sliding"],
        fos_limit_overturning=DA1_SLS["fos_overturning"],
        Pp_kN=0.0,
        **common,
    )
    da1c1 = _run_combination(
        label="DA1-C1",
        gamma_Q=DA1_C1["gamma_Q"],
        gamma_phi=DA1_C1["gamma_phi"],
        fos_limit_sliding=DA1_C1["fos_sliding"],
        fos_limit_overturning=DA1_C1["fos_overturning"],
        Pp_kN=Pp_DA1C1,
        **common,
    )
    da1c2 = _run_combination(
        label="DA1-C2",
        gamma_Q=DA1_C2["gamma_Q"],
        gamma_phi=DA1_C2["gamma_phi"],
        fos_limit_sliding=DA1_C2["fos_sliding"],
        fos_limit_overturning=DA1_C2["fos_overturning"],
        Pp_kN=Pp_DA1C2,
        **common,
    )

    overall_pass = sls["pass"] and da1c1["pass"] and da1c2["pass"]

    return {
        "footing_type": footing_type,
        "inputs": {
            "H_SLS_kN": H_SLS_kN,
            "M_SLS_kNm": M_SLS_kNm,
            "P_G_kN": P_G_kN,
            "phi_k_deg": phi_k_deg,
            "gamma_s_kN_m3": gamma_s_kN_m3,
            "c_k_kPa": c_k_kPa,
            "footing_B_m": footing_B_m,
            "footing_W_m": footing_W_m,
            "footing_D_m": footing_D_m,
        },
        "SLS": sls,
        "DA1_C1": da1c1,
        "DA1_C2": da1c2,
        "pass": overall_pass,
    }


if __name__ == "__main__":
    # Sanity-check: print DA1-C1 sliding FOS ≈ 5.52 and bearing qu ≈ 279 kPa
    # requires P105-specific footing geometry inputs from the PE report.
    print("Foundation module loaded — supply P105 footing inputs to validate.")
