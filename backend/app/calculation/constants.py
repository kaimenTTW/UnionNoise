"""
Calculation constants — Union Noise design engine.

APPLICABLE_CODES: static list cited verbatim in PE submission reports.
SG_NA: Singapore National Annex overrides to EN 1991-1-4.
All values ✅ CONFIRMED across PE calculation reports. See code-reference.md Section 1–2.
"""

APPLICABLE_CODES: list[dict] = [
    {
        "en_designation": "EN 1990:2002",
        "eurocode_label": "Eurocode 0 — Basis of Structural Design",
        "governs": "Load combinations and partial factors",
    },
    {
        "en_designation": "EN 1991-1-4:2005",
        "eurocode_label": "Eurocode 1 — Wind Actions",
        "governs": "Wind load analysis (EC1 Clause 4.3 chain, Table 7.9)",
    },
    {
        "en_designation": "EN 1993-1-1:2005",
        "eurocode_label": "Eurocode 3 — Steel Structures (General)",
        "governs": "Steel post design — bending, shear, lateral torsional buckling",
    },
    {
        "en_designation": "EN 1993-1-8:2005",
        "eurocode_label": "Eurocode 3 — Design of Joints",
        "governs": "Bolt capacity, weld design",
    },
    {
        "en_designation": "EN 1992-1-1:2004",
        "eurocode_label": "Eurocode 2 — Concrete Structures",
        "governs": "Bolt anchorage bond length (EC2 Clause 3.1.6)",
    },
    {
        "en_designation": "EN 1997-1:2004",
        "eurocode_label": "Eurocode 7 — Geotechnical Design",
        "governs": "Foundation design (DA1-C1, DA1-C2)",
    },
    {
        "en_designation": "NA to SS EN 1991-1-4:2009",
        "eurocode_label": "Singapore National Annex — Wind Actions",
        "governs": "SG-specific constants: vb0, ρ, kl, terrain category II",
    },
]

# Singapore National Annex — EN 1991-1-4.
# All values ✅ CONFIRMED. Sources: code-reference.md Section 2, all PE reports reviewed.
SG_NA: dict = {
    "vb0": 20.0,      # m/s — basic wind velocity (NA 2.4)
    "rho": 1.194,     # kg/m³ — air density (NA 2.18)
    "kl": 1.0,        # turbulence factor (NA 2.16)
    "kr": 0.19,       # roughness factor coefficient (terrain cat II, z0=0.05m)
    "z0": 0.05,       # m — roughness length (NA Table NA.1, terrain cat II)
    "zmin": 2.0,      # m — minimum reference height (NA Table NA.1)
    "co": 1.0,        # orography factor — flat terrain default (EC1 Clause 4.3.4)
    "cp_net": 1.2,    # net pressure coefficient — porous panel (EN 1991-1-4 Table 7.9)
    "cdir": 1.0,      # directional factor — confirmed unity across all reports
    "cseason": 1.0,   # season factor — confirmed unity across all reports
}

# Material constants — ✅ CONFIRMED across all PE reports. code-reference.md Section 9.
STEEL: dict = {
    "E": 210_000,   # N/mm² — Young's modulus
    "G": 81_000,    # N/mm² — shear modulus
    "fy_S275": 275, # N/mm²
    "fy_S355": 355, # N/mm²
    "gamma_M0": 1.0,
    "gamma_M1": 1.0,
    "gamma_M2": 1.25,
    "gamma_s_steel": 78.5,  # kN/m³ — steel self-weight
}

# Bolt tensile stress areas — threaded (net) area per ISO 898-1 / EC3-1-8.
# Used for all bolt capacity checks. Gross area over-estimates capacity.
BOLT_STRESS_AREA: dict = {
    16: 157,   # mm² — M16
    20: 245,   # mm² — M20
    24: 353,   # mm² — M24
    30: 561,   # mm² — M30
}

CONCRETE: dict = {
    "fck_C2530": 25,  # N/mm² — characteristic cylinder strength
    "fck_C2835": 28,
    "fck_C3037": 30,
    "gamma_c": 1.5,
    "gamma_c_density": 25,  # kN/m³ — concrete self-weight
}

# LTB parameters — ✅ CONFIRMED. code-reference.md Section 4.4.
# PROVISIONAL: αLT = 0.34 used throughout P105 regardless of h/b ratio.
LTB: dict = {
    "C1": 1.0,        # moment gradient factor — conservative (uniform moment)
    "alpha_LT": 0.34, # imperfection factor — buckling curve b (PROVISIONAL: all sections)
    "lambda_LT_0": 0.4,
    "beta": 0.75,
}

# DA1 partial factors — ✅ CONFIRMED. code-reference.md Section 7.2.
DA1_C1: dict = {"gamma_Q": 1.5, "gamma_G_fav": 1.35, "gamma_phi": 1.0, "fos_sliding": 1.35, "fos_overturning": 1.0}
DA1_C2: dict = {"gamma_Q": 1.3, "gamma_G_fav": 1.0,  "gamma_phi": 1.25, "fos_sliding": 1.0,  "fos_overturning": 1.0}
DA1_SLS: dict = {"gamma_Q": 1.0, "gamma_G_fav": 1.0,  "gamma_phi": 1.0,  "fos_sliding": 1.5,  "fos_overturning": 1.5}

# EQU partial factors — ✅ CONFIRMED. code-reference.md Section 7.1.
EQU: dict = {
    "gamma_G_dst": 1.1,
    "gamma_G_stb": 0.9,
    "gamma_Q_dst": 1.5,
    "gamma_phi": 1.25,
    "gamma_c_prime": 1.25,
    "gamma_cu": 1.4,
}
