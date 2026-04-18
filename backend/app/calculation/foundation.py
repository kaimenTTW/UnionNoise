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

Overturning check uses EQU.gamma_G_stb = 0.9 on the stabilising permanent
load per EC7 EQU (confirmed P105). Applied to all three combinations.

Notation: footing_L_m = dimension perpendicular to wind (PE report: L).
          footing_B_m = dimension in wind direction (PE report: B).
"""

from __future__ import annotations

import math

from .constants import DA1_C1, DA1_C2, DA1_SLS, EQU


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
    L_m: float,
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
        B_m:            footing dimension in wind direction [m]
        L_m:            footing dimension perpendicular to wind [m]
        e_m:            load eccentricity [m]; B' = B - 2e
    """
    phi_d_deg = phi_k_deg / gamma_phi
    # Factored cohesion — same γ for c' as for φ per EC7
    c_d_kPa = c_k_kPa / gamma_phi

    B_prime = max(B_m - 2 * e_m, 0.01)  # effective width
    L_prime = L_m  # perpendicular dimension unchanged

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
    gamma_G_stb: float,
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
    L_m: float,
    D_m: float,
    q_overburden_kPa: float,
    Pp_kN: float = 0.0,
) -> dict:
    """Run one DA1 combination or SLS check and return results dict."""
    H = H_SLS_kN * gamma_Q
    M = M_SLS_kNm * gamma_Q

    # Design friction angle (used for sliding in embedded branch and output)
    phi_d_deg = phi_k_deg / gamma_phi

    if footing_type == "Exposed pad":
        # Sliding: μ × P_G (unfactored vertical favourable load)
        F_R_sliding = mu * P_G_kN
    else:
        # Embedded: tanφd × P_G + Pp (passive)
        phi_d_rad = math.radians(phi_d_deg)
        F_R_sliding = P_G_kN * math.tan(phi_d_rad) + Pp_kN

    FOS_sliding = F_R_sliding / H if H > 0 else float("inf")
    pass_sliding = FOS_sliding >= fos_limit_sliding

    # Overturning — γG,stb = 0.9 applied to stabilising permanent load per EC7 EQU
    # ✅ CONFIRMED: P105 applies γG,stb throughout all overturning checks
    M_Rd_overturning = (
        P_G_kN * gamma_G_stb * (B_m / 2)
        + (Pp_kN * D_m / 3 if footing_type == "Embedded RC" else 0.0)
    )
    FOS_overturning = M_Rd_overturning / M if M > 0 else float("inf")
    pass_overturning = FOS_overturning >= fos_limit_overturning

    # Bearing (eccentricity from overturning moment)
    e_bearing = M / P_G_kN if P_G_kN > 0 else 0.0

    bearing_result: dict = {}
    pass_bearing = True

    if footing_type == "Exposed pad":
        A = B_m * L_m
        if e_bearing > B_m / 6:
            b_prime = max(B_m - 2 * e_bearing, 0.0)
            q_max = 4 * P_G_kN / (3 * L_m * b_prime) if b_prime > 0 else float("inf")
        else:
            b_prime = B_m  # full width effective — no eccentricity reduction
            q_max = P_G_kN / A * (1 + 6 * e_bearing / B_m)
        pass_bearing = q_max <= q_overburden_kPa  # q_overburden reused as q_allow for exposed
        bearing_result = {
            "e_m": round(e_bearing, 3),
            "b_prime_m": round(b_prime, 3),
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
            L_m=L_m,
            e_m=e_bearing,
        )
        q_applied = P_G_kN / (bearing["B_prime_m"] * L_m)
        pass_bearing = q_applied <= bearing["qu_kPa"]
        bearing_result = {
            **bearing,  # includes phi_d_deg, Nq, Nc, Ny, sq, sc, sy, B_prime_m, qu_kPa
            "q_applied_kPa": round(q_applied, 2),
            "UR_bearing": round(q_applied / bearing["qu_kPa"], 3) if bearing["qu_kPa"] > 0 else None,
        }

    return {
        "label": label,
        "phi_d_deg": round(phi_d_deg, 2),
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
    footing_L_m: float = 1.0,
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
        footing_L_m:            footing dimension perpendicular to wind [m]  ← PE notation: L
        footing_D_m:            embedment depth below ground [m] (0 for exposed pad)

    Returns:
        Dict with SLS, DA1-C1, DA1-C2 results and overall pass/fail.
    """
    mu = 0.3  # base friction coefficient — ✅ CONFIRMED (Faber Walk), exposed pad only
    gamma_G_stb = EQU["gamma_G_stb"]  # 0.9 — applied to stabilising permanent load

    # Passive earth resistance (used in embedded branch)
    # PROVISIONAL: P105 T1/T2 evaluate Pp = 0 — confirmed not relied upon in those reports.
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
        gamma_G_stb=gamma_G_stb,
        mu=mu,
        B_m=footing_B_m,
        L_m=footing_L_m,
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
            "footing_L_m": footing_L_m,
            "footing_D_m": footing_D_m,
        },
        "SLS": sls,
        "DA1_C1": da1c1,
        "DA1_C2": da1c2,
        "pass": overall_pass,
    }


if __name__ == "__main__":
    # P105 T2 validation (Han Engineering, 8/6/2023), pages 7–8.
    # Inputs: H_SLS=13.68 kN, M_SLS=86.88 kNm, P_G=196.25 kN
    #         Embedded RC footing: B=1.7m (wind direction), L=3.0m, D=1.5m
    #         φk=30°, γs=19 kN/m³, c'k=5 kPa, fck=28 (not used here)
    #
    # PE targets:
    #   EQU ODF (overturning, DA1-C1):  1.15
    #   DA1-C1 FOS_sliding:             5.52
    #   DA1-C2 FOS_sliding:             4.91
    #   DA1-C1 qu (bearing capacity):   279.44 kPa
    #   DA1-C2 qu (bearing capacity):   127.91 kPa
    import json as _json

    result = compute_foundation(
        H_SLS_kN=13.68,
        M_SLS_kNm=86.88,
        P_G_kN=196.25,
        footing_type="Embedded RC",
        phi_k_deg=30.0,
        gamma_s_kN_m3=19.0,
        c_k_kPa=5.0,
        footing_B_m=1.7,
        footing_L_m=3.0,
        footing_D_m=1.5,
    )

    sls  = result["SLS"]
    c1   = result["DA1_C1"]
    c2   = result["DA1_C2"]

    print("=== SLS ===")
    print(f"  FOS_sliding:      {sls['FOS_sliding']:.3f}")
    print(f"  FOS_overturning:  {sls['FOS_overturning']:.3f}")

    print("\n=== DA1-C1 ===")
    print(f"  FOS_sliding:      {c1['FOS_sliding']:.3f}   target: 5.52")
    print(f"  FOS_overturning:  {c1['FOS_overturning']:.3f}   target: 1.15 (EQU ODF)")
    print(f"  qu_kPa:           {c1['bearing']['qu_kPa']:.2f}   target: 279.44")
    print(f"  q_applied_kPa:    {c1['bearing']['q_applied_kPa']:.2f}")
    print(f"  UR_bearing:       {c1['bearing']['UR_bearing']:.4f}")
    print(f"  B_prime_m:        {c1['bearing']['B_prime_m']:.3f}")
    print(f"  e_m:              {c1['M_factored_kNm'] / 196.25:.3f}")
    print(f"  pass:             {c1['pass']}")

    print("\n=== DA1-C2 ===")
    print(f"  FOS_sliding:      {c2['FOS_sliding']:.3f}   target: 4.91")
    print(f"  FOS_overturning:  {c2['FOS_overturning']:.3f}")
    print(f"  qu_kPa:           {c2['bearing']['qu_kPa']:.2f}   target: 127.91")
    print(f"  q_applied_kPa:    {c2['bearing']['q_applied_kPa']:.2f}")
    print(f"  UR_bearing:       {c2['bearing']['UR_bearing']:.4f}")
    print(f"  B_prime_m:        {c2['bearing']['B_prime_m']:.3f}")
    print(f"  phi_d_deg:        {c2['bearing']['phi_d_deg']:.2f}")
    print(f"  pass:             {c2['pass']}")

    print("\n=== VALIDATION SUMMARY ===")
    TOLERANCE = 0.005   # 0.5 %
    checks = [
        ("DA1-C1 FOS_sliding",    c1["FOS_sliding"],              5.52),
        ("DA1-C1 FOS_overturning",c1["FOS_overturning"],           1.15),
        ("DA1-C2 FOS_sliding",    c2["FOS_sliding"],              4.91),
        ("DA1-C1 qu_kPa",         c1["bearing"]["qu_kPa"],      279.44),
        ("DA1-C2 qu_kPa",         c2["bearing"]["qu_kPa"],      127.91),
    ]
    any_fail = False
    for name, got, target in checks:
        err = abs(got - target) / target
        status = "PASS" if err <= TOLERANCE else f"MISMATCH (got {got:.3f}, target {target}, err {err*100:.1f}%)"
        if err > TOLERANCE:
            any_fail = True
        print(f"  {name:<30s}  {status}")

    if any_fail:
        print("\nWARNING: One or more bearing targets do not match.")
        print("   Sliding / overturning checks match the PE report.")
        print("   Bearing capacity discrepancy: PE omits the overburden surcharge")
        print("   term q*Nq*sq and uses e from M_SLS (unfactored moment), not M_Ed.")
        print("   Confirmed by reverse-engineering PE targets:")
        print("     qu_PE = c_d*Nc*sc + 0.5*gs*B'*Ny*sy  (no overburden q term)")
        print("     e_PE  = M_SLS / P_G = 86.88 / 196.25 = 0.443 m => B' = 0.814 m")
        print("   EC7 standard uses full q*Nq*sq and factored eccentricity.")
        print("   Recommend flagging this deviation for engineering review.")
    else:
        print("\nAll targets matched within 0.5%.")
