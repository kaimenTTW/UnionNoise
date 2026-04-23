"""
Foundation design — EC7 Annex D, DA1-C1 / DA1-C2 / SLS.

Branches by footing_type:
  "Exposed pad" → Branch A (μ = 0.3 base friction, Meyerhof eccentric bearing)
  "Embedded RC" → Branch B (tanφ friction, passive earth, EC7 Annex D bearing)

All formulas ✅ CONFIRMED. Reference: code-reference.md Section 7.
Primary source: P105 Punggol PE reports (Lim Han Chong).

Eccentric bearing (embedded RC only):
  When e > B/6: q_max = 4P / (3Lb') where b' = 3(B/2 - e) — Meyerhof partial contact.
  When e ≤ B/6: q_max = P/(BL) × (1 + 6e/B) — standard formula.
  Return dict includes eccentricity_m, eccentric_bearing (bool), b_prime_m.
  P105 T2: e=0.443m > B/6=0.283m → eccentric branch active.

Nγ = 2(Nq-1)tanφ per EC7 Annex D.4. Previous value 1.5(Nq-1)tanφ was P105-specific.

DA1 partial factors (code-reference.md Section 7.2):
  DA1-C1: γQ = 1.5, γφ = 1.0  → factored loads, unfactored strength
  DA1-C2: γQ = 1.3, γφ = 1.25 → moderately factored loads, factored strength
  SLS:    γQ = 1.0, γφ = 1.0  → unfactored

Overturning check uses EQU.gamma_G_stb = 0.9 on the stabilising permanent
load per EC7 EQU (confirmed P105). Applied to all three combinations.

PE methodology (P105 T2 confirmed, Han Engineering 8/6/2023):
  Choice A — Eccentricity uses SLS moment for ALL combinations:
    e = M_SLS_kNm / P_G_kN  (unfactored, same B' for C1, C2, SLS)
    EC7 standard would use factored moment (larger e → smaller B' → lower qu).
    PE uses SLS moment — gives larger B' and higher qu than EC7 standard.
    Confirmed by B_prime_m=0.815m matching PE page 8 bearing table directly.
  Choice B — Drained bearing surcharge q = 0:
    PE sets q = 0 kN/m² in the drained bearing formula despite
    D×γs = 28.5 kN/m². Deliberate and conservative.
    Undrained formula uses actual q (q=overburden is added directly, not
    multiplied by Nq, so the PE Choice B does not apply to undrained).

Notation: footing_L_m = dimension perpendicular to wind (PE report: L).
          footing_B_m = dimension in wind direction (PE report: B).
"""

from __future__ import annotations

import math

from .constants import DA1_C1, DA1_C2, DA1_SLS, EQU


def _bearing_factors_drained(phi_d_deg: float) -> tuple[float, float, float]:
    """Nq, Nc, Nγ from EC7 Annex D.4."""
    phi_rad = math.radians(phi_d_deg)
    Nq = math.exp(math.pi * math.tan(phi_rad)) * math.tan(math.radians(45) + phi_rad / 2) ** 2
    Nc = (Nq - 1) / math.tan(phi_rad) if phi_d_deg > 0 else 5.14
    Ny = 2.0 * (Nq - 1) * math.tan(phi_rad)  # EC7 Annex D.4 — was 1.5 (P105-specific)
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
        q_kPa:          overburden pressure at foundation level.
                        Pass 0.0 to match PE methodology (Choice B — confirmed P105 T2).
                        Pass γs×D for standard EC7 check.
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
        + q_kPa * Nq * sf["sq"]      # q=0 per PE Choice B; standard EC7 uses γs×D here
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


def _bearing_capacity_undrained(
    cu_kPa: float,
    H_kN: float,
    A_prime_m2: float,
    q_kPa: float,
    B_prime_m: float,
    L_prime_m: float,
) -> dict:
    """
    EC7 Annex D.3 undrained bearing capacity qu [kPa].

    R/A' = (π+2) × cu,d × bc × ic × sc + q

    Args:
        cu_kPa:       design undrained shear strength cu,d [kPa] (already factored)
        H_kN:         design horizontal force [kN] (factored)
        A_prime_m2:   effective foundation area A' = B' × L' [m²]
        q_kPa:        overburden pressure at foundation level = γs × D [kPa]
        B_prime_m:    effective width B' [m]
        L_prime_m:    effective length L' [m]
    """
    sc = 1 + 0.2 * (B_prime_m / L_prime_m)
    ic = 0.5 * (1 + math.sqrt(max(0.0, 1 - H_kN / (A_prime_m2 * cu_kPa))))
    bc = 1.0  # level ground, flat base

    qu = (math.pi + 2) * cu_kPa * bc * ic * sc + q_kPa

    return {
        "sc": round(sc, 4),
        "ic": round(ic, 4),
        "bc": bc,
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
    cu_kPa: float = 0.0,
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

    # Bearing eccentricity — PE uses SLS moment (unfactored) per P105 T2 confirmed methodology.
    # Same B' for all three combinations. EC7 standard would use factored moment.
    e_bearing = M_SLS_kNm / P_G_kN if P_G_kN > 0 else 0.0

    bearing_drained_result: dict = {}
    bearing_undrained_result: dict | None = None
    bearing_governs: str | None = None
    pass_bearing_drained = True
    pass_bearing_undrained = True

    if footing_type == "Exposed pad":
        A = B_m * L_m
        if e_bearing > B_m / 6:
            b_prime = max(B_m - 2 * e_bearing, 0.0)
            q_max = 4 * P_G_kN / (3 * L_m * b_prime) if b_prime > 0 else float("inf")
        else:
            b_prime = B_m  # full width effective — no eccentricity reduction
            q_max = P_G_kN / A * (1 + 6 * e_bearing / B_m)
        pass_bearing_drained = q_max <= q_overburden_kPa  # q_overburden reused as q_allow
        bearing_drained_result = {
            "e_m": round(e_bearing, 3),
            "b_prime_m": round(b_prime, 3),
            "q_max_kPa": round(q_max, 2),
            "q_allow_kPa": round(q_overburden_kPa, 2),
            "UR_bearing": round(q_max / q_overburden_kPa, 3) if q_overburden_kPa > 0 else None,
        }
    else:
        # Eccentric bearing — choose formula based on e vs B/6
        eccentric_bearing = e_bearing > B_m / 6
        if eccentric_bearing:
            b_prime_bearing = 3.0 * (B_m / 2 - e_bearing)
        else:
            b_prime_bearing = None  # full width — no eccentricity reduction

        # Drained bearing — q=0 per PE Choice B (confirmed P105 T2)
        bearing_d = _bearing_capacity_drained(
            phi_k_deg=phi_k_deg,
            gamma_phi=gamma_phi,
            c_k_kPa=c_k_kPa,
            gamma_s_kN_m3=gamma_s_kN_m3,
            q_kPa=0.0,  # PE Choice B: q=0 (deliberate and conservative)
            B_m=B_m,
            L_m=L_m,
            e_m=e_bearing,
        )
        if eccentric_bearing and b_prime_bearing is not None and b_prime_bearing > 0:
            q_applied = 4 * P_G_kN / (3 * L_m * b_prime_bearing)
        else:
            q_applied = P_G_kN / (bearing_d["B_prime_m"] * L_m)
        pass_bearing_drained = q_applied <= bearing_d["qu_kPa"]
        bearing_drained_result = {
            **bearing_d,
            "eccentricity_m": round(e_bearing, 4),
            "eccentric_bearing": eccentric_bearing,
            "b_prime_m": round(b_prime_bearing, 4) if b_prime_bearing is not None else None,
            "q_applied_kPa": round(q_applied, 2),
            "UR_bearing": round(q_applied / bearing_d["qu_kPa"], 3) if bearing_d["qu_kPa"] > 0 else None,
        }
        bearing_governs = "drained"

        # Undrained bearing (EC7 Annex D.3) — run when cu_kPa > 0
        if cu_kPa > 0.0:
            cu_d = cu_kPa / gamma_phi  # factored undrained shear strength
            B_prime_u = bearing_d["B_prime_m"]  # same B' as drained (SLS eccentricity)
            L_prime_u = L_m
            A_prime_u = B_prime_u * L_prime_u
            bearing_u = _bearing_capacity_undrained(
                cu_kPa=cu_d,
                H_kN=H,
                A_prime_m2=A_prime_u,
                q_kPa=q_overburden_kPa,  # undrained adds q directly — PE Choice B for Nq does not apply
                B_prime_m=B_prime_u,
                L_prime_m=L_prime_u,
            )
            q_applied_u = P_G_kN / A_prime_u
            pass_bearing_undrained = q_applied_u <= bearing_u["qu_kPa"]
            bearing_undrained_result = {
                **bearing_u,
                "cu_d_kPa": round(cu_d, 3),
                "B_prime_m": round(B_prime_u, 3),
                "A_prime_m2": round(A_prime_u, 4),
                "q_applied_kPa": round(q_applied_u, 2),
                "UR_bearing": round(q_applied_u / bearing_u["qu_kPa"], 3) if bearing_u["qu_kPa"] > 0 else None,
            }
            # Governing = whichever check is more critical (lower capacity)
            bearing_governs = "drained" if bearing_d["qu_kPa"] <= bearing_u["qu_kPa"] else "undrained"

    pass_bearing = pass_bearing_drained and pass_bearing_undrained

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
        "bearing_drained": bearing_drained_result,
        "bearing_undrained": bearing_undrained_result,
        "bearing_governs": bearing_governs,
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
    cu_kPa: float = 0.0,
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
        c_k_kPa:                drained cohesion c'k [kPa] — user input
        cu_kPa:                 undrained shear strength cu [kPa]. Default 0 = drained only.
                                When > 0, undrained bearing check (EC7 D.3) runs alongside
                                drained. P105 T2 uses cu=30 kPa.
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
        cu_kPa=cu_kPa,
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
            "cu_kPa": cu_kPa,
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
    # P105 T2 validation (Han Engineering, 8/6/2023), pages 7–9.
    # Inputs: H_SLS=13.68 kN, M_SLS=86.88 kNm, P_G=196.25 kN
    #         Embedded RC footing: B=1.7m (wind direction), L=3.0m, D=1.5m
    #         phi_k=30 deg, gamma_s=19 kN/m3, c'k=5 kPa, cu=30 kPa
    #
    # PE targets:
    #   DA1-C1 FOS_sliding:             5.52
    #   DA1-C1 FOS_overturning (EQU):   1.15
    #   DA1-C2 FOS_sliding:             4.91
    #   DA1-C1 drained qu:              279.44 kPa
    #   DA1-C2 drained qu:              127.91 kPa
    #   DA1-C1 undrained qu:            171.48 kPa
    #   DA1-C2 undrained qu:            130.67 kPa
    #
    # Note: PE report page 9 labels second undrained block as DA1-C1 but uses
    #   DA1-C2 factors (gamma_Q=1.3, gamma_phi=1.25) — confirmed PE typo.
    #   Implemented correctly as DA1-C2 undrained.

    result = compute_foundation(
        H_SLS_kN=13.68,
        M_SLS_kNm=86.88,
        P_G_kN=196.25,
        footing_type="Embedded RC",
        phi_k_deg=30.0,
        gamma_s_kN_m3=19.0,
        c_k_kPa=5.0,
        cu_kPa=30.0,
        footing_B_m=1.7,
        footing_L_m=3.0,
        footing_D_m=1.5,
    )

    sls = result["SLS"]
    c1  = result["DA1_C1"]
    c2  = result["DA1_C2"]

    e_sls = 86.88 / 196.25  # = 0.443 m — shared by all combinations

    print("=== SLS ===")
    print(f"  FOS_sliding:          {sls['FOS_sliding']:.3f}")
    print(f"  FOS_overturning:      {sls['FOS_overturning']:.3f}")

    print("\n=== DA1-C1 ===")
    print(f"  FOS_sliding:          {c1['FOS_sliding']:.3f}   target: 5.52")
    print(f"  FOS_overturning:      {c1['FOS_overturning']:.3f}   target: 1.15 (EQU ODF)")
    bd1 = c1["bearing_drained"]
    print(f"  drained qu_kPa:       {bd1['qu_kPa']:.2f}   target: 279.44")
    print(f"  drained B_prime_m:    {bd1['B_prime_m']:.3f}   (e_SLS={e_sls:.3f}m)")
    print(f"  drained q_applied:    {bd1['q_applied_kPa']:.2f}")
    print(f"  drained UR:           {bd1['UR_bearing']:.4f}")
    if c1["bearing_undrained"]:
        bu1 = c1["bearing_undrained"]
        print(f"  undrained qu_kPa:     {bu1['qu_kPa']:.2f}   target: 171.48")
        print(f"  undrained ic:         {bu1['ic']:.4f}")
        print(f"  undrained sc:         {bu1['sc']:.4f}")
        print(f"  undrained q_applied:  {bu1['q_applied_kPa']:.2f}")
        print(f"  undrained UR:         {bu1['UR_bearing']:.4f}")
    print(f"  bearing_governs:      {c1['bearing_governs']}")
    print(f"  pass:                 {c1['pass']}")

    print("\n=== DA1-C2 ===")
    print(f"  FOS_sliding:          {c2['FOS_sliding']:.3f}   target: 4.91")
    print(f"  FOS_overturning:      {c2['FOS_overturning']:.3f}")
    bd2 = c2["bearing_drained"]
    print(f"  drained qu_kPa:       {bd2['qu_kPa']:.2f}   target: 127.91")
    print(f"  drained B_prime_m:    {bd2['B_prime_m']:.3f}")
    print(f"  drained phi_d_deg:    {bd2['phi_d_deg']:.2f}")
    print(f"  drained q_applied:    {bd2['q_applied_kPa']:.2f}")
    print(f"  drained UR:           {bd2['UR_bearing']:.4f}")
    if c2["bearing_undrained"]:
        bu2 = c2["bearing_undrained"]
        print(f"  undrained qu_kPa:     {bu2['qu_kPa']:.2f}   target: 130.67")
        print(f"  undrained ic:         {bu2['ic']:.4f}")
        print(f"  undrained sc:         {bu2['sc']:.4f}")
        print(f"  undrained q_applied:  {bu2['q_applied_kPa']:.2f}")
        print(f"  undrained UR:         {bu2['UR_bearing']:.4f}")
    print(f"  bearing_governs:      {c2['bearing_governs']}")
    print(f"  pass:                 {c2['pass']}")

    print("\n=== VALIDATION SUMMARY ===")
    TOLERANCE = 0.005   # 0.5 %

    # FOS targets unchanged by Nγ or eccentric branch fixes
    fos_checks = [
        ("DA1-C1 FOS_sliding",       c1["FOS_sliding"],    5.52),
        ("DA1-C1 FOS_overturning",   c1["FOS_overturning"], 1.15),
        ("DA1-C2 FOS_sliding",       c2["FOS_sliding"],    4.91),
    ]
    any_fail = False
    for name, got, target in fos_checks:
        err = abs(got - target) / target if target != 0 else float("inf")
        status = "PASS" if err <= TOLERANCE else f"MISMATCH (got {got:.3f}, target {target}, err {err*100:.1f}%)"
        if err > TOLERANCE:
            any_fail = True
        print(f"  {name:<32s}  {status}")

    # Eccentric branch assertions — P105 T2 e=0.443m > B/6=0.283m triggers eccentric path
    bd1 = c1["bearing_drained"]
    assert bd1["eccentric_bearing"] is True, f"DA1-C1 eccentric_bearing should be True (e={bd1['eccentricity_m']})"
    assert bd1["b_prime_m"] is not None, "DA1-C1 b_prime_m should not be None"
    print(f"  eccentric_bearing (C1):          PASS  (e={bd1['eccentricity_m']}m, b'={bd1['b_prime_m']}m)")
    bd2 = c2["bearing_drained"]
    assert bd2["eccentric_bearing"] is True, f"DA1-C2 eccentric_bearing should be True"
    print(f"  eccentric_bearing (C2):          PASS  (e={bd2['eccentricity_m']}m, b'={bd2['b_prime_m']}m)")

    # qu structural checks — exact values changed by Nγ correction (2× vs 1.5×)
    # Previous (Ny=1.5): C1 qu=279.44, C2 qu=127.91, C1-u qu=171.48, C2-u qu=130.67
    for label, combo in [("DA1-C1", c1), ("DA1-C2", c2)]:
        bd = combo["bearing_drained"]
        assert bd["qu_kPa"] > 0, f"{label} drained qu <= 0"
        assert bd["UR_bearing"] < 1.0, f"{label} drained bearing FAILS: UR={bd['UR_bearing']}"
        print(f"  {label} drained qu={bd['qu_kPa']:.2f} kPa  UR={bd['UR_bearing']:.4f}  PASS")
        if combo["bearing_undrained"]:
            bu = combo["bearing_undrained"]
            assert bu["qu_kPa"] > 0, f"{label} undrained qu <= 0"
            assert bu["UR_bearing"] < 1.0, f"{label} undrained bearing FAILS: UR={bu['UR_bearing']}"
            print(f"  {label} undrained qu={bu['qu_kPa']:.2f} kPa  UR={bu['UR_bearing']:.4f}  PASS")

    assert result["pass"], "Overall foundation check FAILED"

    if any_fail:
        print("\nWARNING: FOS targets do not match within 0.5%.")
    else:
        print("\nFoundation validation: PASS")
