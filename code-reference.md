# Engineering Code Reference — Noise Barrier Design System
## Union Noise / Hebei Jinbiao Construction Materials Pte Ltd

**Document purpose:** Canonical reference for all confirmed calculation methods, code clauses, formulas, and partial factors used in noise barrier PE calculation reports. This document is the engineering source that the calculation engine is built against. It is separate from the PRD (which defines what to build) and the CHANGELOG (which tracks implementation history).

**Reference implementation:** P105 Punggol project (PE Lim Han Chong, PE 4382, Han Engineering Consultants). All calculation modules are validated by reproducing P105 T1 and T2 outputs from known inputs. Discrepancies between P105 and other PE reports are noted but do not block implementation — P105 methodology is the build target for the prototype.

**Validation targets:**
- P105 T1 (12mH above ground, 3m spacing): M_Ed = 97.76 kNm → UB356×127×33, Mb,Rd = 112.90 kNm, UR = 0.87
- P105 T2 (12mH embedded, 3m spacing): M_Ed = 130.31 kNm → UB406×140×39, Mb,Rd = 133.33 kNm, UR = 0.98
- Foundation T1/T2: sliding DA1-C1 ODF = 5.52, overturning ODF = 1.15, bearing DA1-C1 qu = 279.44 kN/m²

**Sources reviewed:**
- PE Calc Report, Type 1 6mH, embedded footing — PE Lawson Chung (PE 5703), March 2026 (RM project)
- PE Calc Report, Type 1 6mH, exposed footing — PE Lawson Chung (PE 5703), Jan 2026 (Faber Walk)
- PE Calc Report, Type 2A 12.736mH, embedded footing (long span) — PE Lim Han Chong (PE 4382), Nov/Dec 2023 (P105 Punggol)
- PE Calc Report, Type 1 12mH, above ground footing — PE Lim Han Chong (PE 4382), Mar 2023 (P105 T1) ← primary reference
- PE Calc Report, Type 1 12mH, embedded footing — PE Lim Han Chong (PE 4382), Jun 2023 (P105 T2) ← primary reference
- NotebookLM consolidated analysis of the above reports, April 2026

**Confidence tags:**
- ✅ CONFIRMED — consistent across P105 reports or explicitly confirmed by client/SME
- ⚠️ PROVISIONAL — seen in non-P105 reports only, or has inter-report variation
- ❌ UNRESOLVED — explicit discrepancy within P105 reports, or data not yet available

---

## 1. Applicable Codes and Clause Index

| Code | Clause | Governs |
|---|---|---|
| EN 1991-1-4 | 4.3.1 | Mean wind velocity vm(z) |
| EN 1991-1-4 | 4.3.2 | Roughness factor cr(z) |
| EN 1991-1-4 | 4.3.4 | Orography factor co(z) |
| EN 1991-1-4 | 4.4 | Turbulence intensity Iv(z) |
| EN 1991-1-4 | 7.4.2 | Shelter factor ψs for walls and fences |
| EN 1991-1-4 | Table 7.9 | Net pressure coefficients — porous free-standing walls |
| EN 1991-1-4 | Figure 7.20 | Shelter factor chart (x/h vs ψs by solidity φ) |
| EN 1993-1-1 | 1.5 | Terms and definitions |
| EN 1993-1-1 | 6.2.5 | Bending resistance of cross-sections |
| EN 1993-1-1 | 6.2.6 | Shear resistance of cross-sections |
| EN 1993-1-1 | 6.3.2 | Lateral torsional buckling resistance |
| EN 1993-1-1 | Table 6.3 | Imperfection factors αLT |
| EN 1993-1-1 | Table 6.4 | Buckling curves for LTB |
| EN 1993-1-8 | 1.4, 1.5 | Terms and definitions — joints |
| EN 1993-1-8 | 2.2 | NDP partial safety factors |
| EN 1993-1-8 | 3.4 | Bolt category classification |
| EN 1993-1-8 | 3.6.1 | Design resistance of bolts (shear and tension) |
| EN 1993-1-8 | 4.5.3 | Fillet weld resistance (directional and simplified methods) |
| EN 1993-1-8 | 6.2.2(6) | Shear capacity of anchor bolts |
| EN 1992-1-1 | 3.1.6 | Design tensile strength of concrete fctd |
| EN 1992-1-1 | Table 2.1N | Bond condition factors η1, η2 |
| EN 1997-1 | Annex D.3 | Undrained bearing capacity |
| EN 1997-1 | Annex D.4 | Drained bearing capacity |
| EN 1997-1 | 2.4.7.2 | Verification of static equilibrium (EQU) |
| NA to SS EN 1991-1-4:2009 | NA 2.4 | Fundamental basic wind velocity vb,0 = 20 m/s |
| NA to SS EN 1991-1-4:2009 | NA 2.16 | Turbulence factor kl = 1.0 |
| NA to SS EN 1991-1-4:2009 | NA 2.18 | Air density ρ = 1.194 kg/m³ |
| NA to SS EN 1991-1-4:2009 | Table NA.1 | Terrain Category 2: z0 = 0.05 m, zmin = 2 m |

---

## 2. Singapore National Annex Modifications

✅ CONFIRMED — all values consistent across all reports reviewed.

The NA to SS EN 1991-1-4:2009 overrides the following base EN 1991-1-4 values:

| Parameter | SG NA Value | NA Clause | Notes |
|---|---|---|---|
| Basic wind velocity vb,0 | 20 m/s | NA 2.4 | Fixed for all SG projects |
| Air density ρ | 1.194 kg/m³ | NA 2.18 | Fixed for all SG projects |
| Turbulence factor kl | 1.0 | NA 2.16 | Overrides EC1 recommended value |
| Terrain categorisation | Simplified — z0 = 0.05 m for most inland areas | Table NA.1 | Standard EN 1991-1-4 terrain categories not applicable in SG |
| zmin | 2 m | Table NA.1 | Consistent with terrain category 2 |
| Minimum ultimate horizontal load | 1.5% of characteristic dead weight | National Foreword | Applies to all buildings |

> **Note:** Directional factor cdir = 1, Season factor cseason = 1 — both confirmed across all reports as unity (no modification).

---

## 3. Wind Analysis

### 3.1 Basic Wind Pressure

✅ CONFIRMED across all reports.

```
qb = 0.5 × ρ × vb²                                [N/m²]

Fixed values (SG NA):
  ρ = 1.194 kg/m³
  vb = 20 m/s
  → qb = 238.80 N/m² (constant for all SG projects)
```

### 3.2 Peak Velocity Pressure qp(z)

✅ CONFIRMED — full EC1 Clause 4.3 chain used across all reports.
**qp is NOT a fixed constant — it is height-dependent.**

```
Terrain parameters (SG NA Table NA.1, Terrain Category 2):
  z0 = 0.05 m
  zmin = 2 m
  kr = 0.19 × (z0 / 0.05)^0.07 = 0.19   (constant for SG)

Roughness factor (EC1 Clause 4.3.2):
  cr(z) = kr × ln(z / z0)                for zmin ≤ z ≤ 200m

Orography factor (EC1 Clause 4.3.4):
  co(z) = 1.0                            (flat terrain default)

Mean velocity (EC1 Clause 4.3.1):
  vm(z) = cr(z) × co(z) × vb

Turbulence intensity (EC1 Clause 4.4):
  Iv(z) = kl / (co(z) × ln(z / z0))     kl = 1.0 (SG NA 2.16)

Peak velocity pressure:
  qp(z) = [1 + 7 × Iv(z)] × 0.5 × ρ × vm(z)²     [N/m²]
```

**Reference outputs for validation (do not hardcode):**

| Project | z (m) | qp (N/m²) | qp (kPa) |
|---|---|---|---|
| RM / Faber Walk (6mH, 50yr) | 6.0 | ~394–435 | 0.394–0.435 |
| P105 T1/T2 (12mH) | 12.7 | 598.48 | 0.598 |

### 3.3 Wind Pressure Coefficient

✅ CONFIRMED for P105 reference implementation.

```
cp,net = 1.2     (EN 1991-1-4 Table 7.9 — noise panel considered porous)
```

The noise barrier panels are treated as porous in all P105 reports. cp,net = 1.2 is the confirmed value for the prototype build.

> ⚠️ NOTE for future: Faber Walk report (Lawson Chung) uses Zone D approach instead of porous treatment. This is a noted difference between PEs — does not affect P105 validation but will need resolution when expanding to other project types.

### 3.4 Shelter Factor ψs

✅ CONFIRMED value for P105 validation: ψs = 0.5 (EC1 Section 7.4.2, Figure 7.20)

**For the P105 validation run:** ψs = 0.5 is the known input. Feed it directly to reproduce the 0.36 kPa output.

**For general use (all projects):** ψs is derived from EC1 Figure 7.20 — it is NOT a user-entered constant. The derivation flow below must be implemented for the system to be usable on any project.

```
Inputs required:
  x   = spacing between barrier and upwind sheltering structure [m]
        (user measures from site plan or enters from site visit)
  h   = height of barrier (already a project input) [m]
  φ   = solidity ratio of upwind sheltering structure
        φ = 1.0 for solid building wall (most common case)
        φ = 0.8–1.0 range supported per EC1

Derivation:
  ratio = x / h
  ψs = lookup from digitised EN 1991-1-4 Figure 7.20
       interpolated from (x/h, φ) → ψs
       stored as: backend/app/data/shelter_factor_table.json

Restrictions (EN 1991-1-4 Section 7.4.2):
  - φ ≤ 0.8: treat upwind structure as plane lattice, not solid wall
  - Shelter factor does NOT apply in end zones
    (within distance h from free end of barrier)

Default (no shelter present):
  ψs = 1.0
```

**UI flow:**
- Boolean toggle: "Is there a sheltering structure upwind?" Yes / No
- If Yes: user enters x (m) and selects φ (dropdown: 0.8 / 0.9 / 1.0)
- h is taken automatically from barrier height already entered
- System computes x/h, looks up ψs, displays derived value for confirmation
- If No: ψs = 1.0, no additional fields shown

**Implementation dependency:** Figure 7.20 must be digitised into `shelter_factor_table.json` before this module can be built. This is a one-time manual task — read (x/h, ψs) values off the chart for each φ curve and store as a lookup table with interpolation.

### 3.5 Design Wind Pressure

✅ CONFIRMED across all reports.

```
design_pressure = qp(z) × cp,net × ψs             [kPa]

Confirmed values (P105 reports):
  qp = 0.598 kPa (at z=12.7m)
  cp,net = 1.2
  ψs = 0.5
  → design_pressure = 0.598 × 1.2 × 0.5 = 0.36 kPa
```

---

## 4. Steel Post Design

### 4.1 Section Classification

✅ CONFIRMED — EC1 Clause 1.5 (reference), EC3 Clause 6.2.5.

```
ε = sqrt(235 / fy)

Flange: cf = (b - tw - 2r) / 2
        cf/tf < 9ε → Class 1 (Plastic)

Web:    cw = hw
        d/t < 72ε → Class 1 (Plastic)
```

All UB sections used in reports are Class 1. CHS subframe is Class 2 — see Section 6.

### 4.2 Loading

✅ CONFIRMED across all reports.

```
Design UDL:      w = design_pressure × post_spacing           [kN/m]
Post moment ULS: M_Ed = 1.5 × w × L² / 2                    [kNm]
Post shear ULS:  V_Ed = 1.5 × w × L                         [kN]

Where L = post_length above foundation level (NOT total post length)
```

**Post length vs total length distinction:**
- P105 T1 (above ground): total height 12m, post length = 11m (1m in footing)
- P105 T2 (embedded): total height 12m, post length = 12.7m (full embedment depth included)
- This is a footing-type-dependent input — confirm derivation rule with PE.

### 4.3 Bending and Shear Resistance

✅ CONFIRMED — EC3 Clause 6.2.5 and 6.2.6.

```
Moment capacity: Mc = fy × Wpl,y / γM1               [kNm]
                 also check: 1.2 × fy × Wel,y / γM1
                 governing = min of both

Shear capacity:  Vc = Av × (fy / √3) / γM0           [kN]
Shear area:      Av = A - [2 × b × tf + (tw + 2r) × tf]

Partial factors: γM0 = 1.0, γM1 = 1.0
```

### 4.4 Lateral Torsional Buckling

✅ CONFIRMED — EC3 Clause 6.3.2. Consistent across all reports.

```
C1 = 1.0 (conservative, uniform moment)
G = 81,000 N/mm²
E = 210,000 N/mm²

Lcr = subframe_spacing (NOT post length)
      Confirmed: Lcr = 1500mm at 1.5m subframe spacing
      Confirmed: Lcr = 3000mm for CHS subframe members

Mcr = C1 × (π²EIz/Lcr²) × sqrt(Iw/Iz + Lcr²×G×It / (π²×E×Iz))

λ'LT = sqrt(Mpl / Mcr)

Buckling curve selection (EN 1993-1-1 Table 6.4):
  Rolled I/H sections, h/b > 2 → Curve b → αLT = 0.34
  Rolled I/H sections, h/b ≤ 2 → Curve a → αLT = 0.21
  ⚠️ PROVISIONAL: All reports use αLT = 0.34 regardless of h/b ratio
  (conservative approach). Confirm with PE whether this is intentional.

λLT,0 = 0.4, β = 0.75 (EN 1993-1-1 recommended values)

φLT = 0.5 × [1 + αLT × (λ'LT - 0.4) + 0.75 × λ'LT²]
χLT = 1 / (φLT + sqrt(φLT² - 0.75 × λ'LT²))   ≤ 1.0

Mb,Rd = χLT × Wpl,y × fy / γM1
UR: M_Ed / Mb,Rd < 1.0
```

### 4.5 Deflection Check

✅ CONFIRMED across all reports.

```
δ = w × L⁴ / (8 × E × I)                             [mm]
δ_allow = L / 65                                       [mm]
UR: δ / δ_allow < 1.0
```

### 4.6 UB Section Selection — Confirmed Sections

✅ CONFIRMED from reports. For reference only — actual selection iterates through parts library.

| Project | Height | Post spacing | Footing | Section |
|---|---|---|---|---|
| RM / Faber Walk | 6mH | 3m | Embedded / Exposed | UB 254×102×17.9 S275 |
| P105 T1 | 12mH | 3m | Above ground | UB 356×127×33 S275 |
| P105 T2 | 12mH | 3m | Embedded | UB 406×140×39 S275 |
| P105 T2A | 12mH | 6m | Embedded | UB 406×140×46 S275 |

---

## 5. Connection Design

### 5.1 Anchor Bolt / Cast-In Bolt Design

✅ CONFIRMED — EC3 Clause 6.2.2(6), EC2 Clause 3.1.6.

```
Tension force from moment:
  T = M_Ed / Ds                     Ds = bolt distance from post centreline
  Ft per bolt = T / Nt              Nt = number of bolts in tension

Shear per bolt:
  Fs = V_Ed / Ns                    Ns = number of bolts in shear

Tension capacity (EC3):
  FT,Rd = k2 × fub × As / γM2
  k2 = 0.9, γM2 = 1.25

Shear capacity (EC3 Clause 6.2.2(6)):
  Fr = αv × As × fub / γM2
  αv = 0.44 - 0.0003 × fyb

Anchorage bond length (EC2 Clause 3.1.6):
  fctk0.05 = 0.21 × fck^(2/3)
  fctd = αcc × fctk0.05 / γc       αcc=1, γc=1.5
  fbd = 2.25 × η1 × η2 × fctd      η1=1 (good bond), η2=1 (bar ≤ 32mm)
  L_required = Ft / (fbd × π × D)
  L_proposed > L_required → OK
```

**Bolt sizes confirmed across reports:**
| Project | Post spacing | Bolt specification |
|---|---|---|
| RM / Faber Walk (6mH) | 3m | M16 Grade 8.8, 4 bolts |
| P105 T1 (12mH above ground) | 3m | M20 Grade 8.8, 6 bolts (3T + 3S) |
| P105 T2 (12mH embedded) | 3m | M24 Grade 8.8, 6 bolts (3T + 3S) |
| P105 T2A (12mH long span) | 6m | M24 Grade 8.8, 6 bolts (3T + 3S) |

### 5.2 Base Plate Design

✅ CONFIRMED — EC3 Annex method.

```
fcd = fck / γc
c = t × sqrt(fy / (3 × fcd × γM0))       cantilever from column face
beff = 2c + tf
leff = 2c + b
Area = beff × leff
Compression resistance = fcd × Area
UR: compression_force / compression_resistance < 1.0

Concrete crushing resistance:
  fjd = βj × fcd × sqrt(Ac1 / Ac0)       βj = 1.5 (joint material coefficient)
```

### 5.3 Weld Design

⚠️ PROVISIONAL — two different methods observed across reports. Both are valid EC3 approaches.

**Method A — Stress decomposition (Faber Walk, RM reports — Lawson Chung):**
```
τ_II (shear):       V_Ed / (throat × weld_length)
τ_⊥, σ_⊥ (tension): F_tension / (throat × weld_length)
Combined check:     sqrt(σ_⊥² + 3(τ_⊥² + τ_II²)) ≤ fu / (βw × γM2)
Also:               Fv,w,Rd = fu / (βw × γM2 × sqrt(2))     [simplified method]
```

**Method B — Weld group moment of inertia (P105 reports — Lim Han Chong):**
```
Welding length = perimeter of weld group (flanges + web contribution)
Moment of inertia of weld group, Iw (mm³)
Direct shear: Fs = V_Ed / welding_length
Shear from moment: FT = M_Ed × (h/2) / Iw
Resultant: FR = sqrt(Fs² + FT²)
Check: FR < weld_resistance (220 N/mm² × throat × 1mm)
```

> ❌ UNRESOLVED: Which method is standard for Union Noise submissions? Both produce similar results but the implementation differs. Recommend confirming with Lawson Chung as the signing PE for most projects.

### 5.4 G Clamp Design

⚠️ PROVISIONAL — present in P105 reports only. Likely applies to all projects using fixed beam clamps.

```
Input: failure_load from Singapore Test Services test report
       (STS Report No. 10784-0714-02391-8-MEME, 11 Aug 2014)
       Fixed beam clamp (Right-Angle Coupler Grip) 48.6
       Failure load = 23.29 kN (23.39 kN from test table)

Total wind force = design_pressure × barrier_height × post_spacing
Factored load = total_wind_force × 1.5
Load per clamp = factored_load / n_clamps_per_post

Check: load_per_clamp < failure_load → OK

Confirmed: n_clamps_per_post = 5 at 12mH, 3m spacing, 0.45 kPa external wind pressure
```

> **Note:** The wind pressure used in G clamp check (0.45 kPa) differs from the design wind pressure (0.36 kPa). The 0.45 kPa appears to be an unfactored external pressure before shelter factor reduction, or a separate worst-case check. ❌ UNRESOLVED — clarify with PE which pressure to use for clamp check.

---

## 6. Subframe Design

⚠️ PROVISIONAL — two different moment formulas observed. Requires SME resolution.

**Section confirmed:** CHS 48.3×2.2 GI pipe, fy = 400 N/mm² (galvanised steel)
**Section class:** Class 2 (semi-compact) — elastic modulus Wel governs, not plastic Wpl

```
Section modulus for CHS:
  Z = π × d³ / 32   (approximate for thin-wall circular section)
  or use tabulated Wel directly

Subframe span = post_spacing (subframe spans between posts)
Wind load on subframe = design_pressure × subframe_spacing (tributary width)

❌ UNRESOLVED — Moment formula discrepancy:
  Formula A (Faber Walk, RM): M_Ed = (1.5/12) × w × L²  → fixed-end beam
  Formula B (P105 T1/T2):     M_Ed = (1.5/10) × w × L²  → continuous beam

The /10 formula implies the subframe is continuous over multiple spans (which
it is in practice). The /12 formula implies fully fixed ends. /10 is typically
used for two-span continuous beams. Confirm with PE which applies.

Shear: F = 1.5 × w × L / 2  (or /n depending on continuity assumption)
UR: M_Ed / (Wel × fy) < 1.0    (Class 2 — elastic)
```

---

## 7. Foundation Design

### 7.1 Partial Factors for EQU

✅ CONFIRMED — consistent across all reports referencing NA to SS EN.

| Symbol | Value | Source |
|---|---|---|
| γG,dst (permanent unfavourable) | 1.1 | EN 1990 Table A1.2(A) |
| γG,stb (permanent favourable) | 0.9 | EN 1990 Table A1.2(A) |
| γQ,dst (variable unfavourable) | 1.5 | EN 1990 Table A1.2(A) |
| γφ (shearing resistance) | 1.25 | EN 1997-1 Table A.2 |
| γc' (cohesion) | 1.25 | EN 1997-1 Table A.2 |
| γcu (undrained shear strength) | 1.4 | EN 1997-1 Table A.2 |
| γM0 | 1.0 | EN 1993-1-1 Clause 6.1 |
| γM1 | 1.0 | EN 1993-1-1 Clause 6.1 |
| γM2 | 1.25 | EN 1993-1-8 Table 2.1 |
| γc (concrete) | 1.5 | EN 1992-1-1 Clause 2.4.2.4 |

### 7.2 Design Approach 1 — Two Combinations

✅ CONFIRMED across all foundation reports.

```
DA1-C1: γQ,dst = 1.5, γG,dst = 1.35, γφ = 1.0
         → factored loads, unfactored soil strength
         FOS limits: sliding > 1.35, overturning > 1.35

DA1-C2: γQ,dst = 1.3, γG,dst = 1.0, γφ = 1.25
         → less factored loads, factored soil strength
         → φd = φk / γφ = 30° / 1.25 = 24°
         FOS limits: sliding > 1.0, overturning > 1.0

SLS:     unfactored loads
         FOS limits: sliding > 1.5, overturning > 1.5
```

### 7.3 Branch A — Exposed Pad Footing

✅ CONFIRMED — Faber Walk report.

```
Sliding Check:
  Resisting force: F_R = μ × P_vertical         μ = 0.3 (base friction)
  FOS = F_R / H_design

Overturning Check:
  M_Rd = P_vertical × (B/2)
  FOS = M_Rd / M_design

Bearing Check (Meyerhof eccentric load):
  e = M / P_vertical
  if e > B/6: footing partially in tension
    b' = B - 2e
    q_max = 4P / (3 × L × b')
  if e ≤ B/6:
    q_max = P/A × (1 + 6e/B)
  UR: q_max / q_allow < 1.0
  (q_allow = 75 kPa default when no site investigation)
```

### 7.4 Branch B — Embedded RC Footing

✅ CONFIRMED — RM, P105 T2, P105 T2A reports.

**Key observation from P105 T1/T2:** Passive earth pressure = 0.00 kN in both reports despite being embedded. This is because the reports use the simplified EQU check with self-weight resistance only (Wt × B/2), not passive earth contribution. The passive earth resistance calculation is shown but evaluates to zero — likely because embedment depth into competent soil is not relied upon for these projects. ⚠️ PROVISIONAL — confirm with PE whether passive earth resistance is ever relied upon.

```
Overturning Check:
  M_Rd = Wt × (B/2) × γG,stb      (+ passive contribution if relied upon)
  FOS = M_Rd / (M_unfactored × γQ,dst)

Sliding Check (DA1-C1):
  F_R = Wt × tanφ                  (friction only — passive = 0 in reports)
  FOS = F_R / (F_unfactored × γQ,dst)

Sliding Check (DA1-C2):
  φd = φk / γφ = 30° / 1.25 = 24°
  F_R = Wt × tanφd
```

**Bearing Capacity — Drained Condition (EC7 Annex D.4):**
```
qu = c'×Nc×bc×sc×ic + q'×Nq×bq×sq×iq + 0.5×γs×B'×Nγ×bγ×sγ×iγ

Bearing factors:
  Nq = e^(π×tanφ) × tan²(45° + φ/2)
  Nc = (Nq - 1) × cotφ

  ❌ UNRESOLVED — Nγ formula discrepancy:
  Formula A (P105 T1/T2, Lim Han Chong): Ny = 1.5(Nq-1)tanφ
  Formula B (P105 T2A, Lim Han Chong):   Ny = 2(Nq-1)tanφ
  Both appear in EC7 Annex D as alternatives. Confirm with PE.

Shape factors:
  sq = 1 + (B'/L') × sinφ
  sc = (sq×Nq - 1) / (Nq - 1)
  sy = 1 - 0.3 × (B'/L')

Inclination factors iq, ic, iy:
  All = 1 in reviewed reports (vertical load assumption for these projects)
  Confirmed values in P105: iq=ic=iy=1, bq=bc=by=1

Soil parameters (user-configurable defaults):
  φk = 30°, γs = 19 kN/m³, c' = 5 kN/m²
  (Note: c'=5 in P105 reports; c'=0 in some earlier reports — site specific)
```

**Bearing Capacity — Undrained Condition (EC7 Annex D.3):**
```
qu = (π + 2) × cu × bc × ic × sc + q

Shape factor: sc = 1 + 0.2 × (B'/L')
Inclination:  ic = 0.5 × (1 + sqrt(1 - H/(A'×cu)))

Both DA1-C1 and DA1-C2 undrained checks performed in P105 reports.
Two cu values used per check — confirm whether this is standard practice.
```

### 7.5 Lifting Hook Design

✅ CONFIRMED — EC3 and EC2.

```
Factored footing weight: W_factored = W_footing × 1.5
Load per hook: F_hook = W_factored / n_hooks

Rebar hook (H20 High Yield Bar confirmed in P105):
  fub = 500 N/mm²
  As = π/4 × φ²
  Tension capacity: FT,Rd = k2 × fub × As / γM2   (k2=0.9, γM2=1.25)
  Shear capacity: Fr = αv × As × fub / γM2

Anchorage: same bond length formula as Section 5.1
  L_required = F_hook / (fbd × π × D)
```

---

## 8. Items Resolved for P105, Pending for General Use

The following items have inter-report discrepancies that are resolved for the P105 prototype build but will need PE/SME decisions before the system handles other PEs' methodology.

| # | Item | P105 Resolution | Future Action Needed |
|---|---|---|---|
| 1 | Wind pressure coefficient | cp,net = 1.2 porous ✅ | Confirm Zone D vs porous for Lawson Chung projects |
| 2 | Subframe moment formula | /10 (continuous beam) ✅ | Confirm /12 applicability for other configurations |
| 3 | Nγ bearing factor | 1.5(Nq-1)tanφ ✅ | Confirm which expression to use for non-P105 projects |
| 4 | Weld check method | Weld group MoI ✅ | Confirm if stress decomposition method also needed |
| 5 | G clamp wind pressure | 0.45 kPa external pressure used ✅ | Confirm rule for when shelter factor applies to clamp check |
| 6 | Passive earth resistance | Evaluated to zero in P105 — not relied upon ✅ | Confirm when passive resistance is included in other projects |
| 7 | Figure 7.20 shelter factor | ψs = 0.5 hardcoded for P105 validation | Digitise Figure 7.20 for general project use |
| 8 | αLT imperfection factor | 0.34 used throughout P105 ✅ | Confirm if 0.21 applies for any section in parts library |

---

## 9. Material Properties Summary

✅ CONFIRMED values across all reports.

| Material | Property | Value | Notes |
|---|---|---|---|
| Structural steel (posts, plates) | fy | 275 N/mm² | S275 — all reports |
| Structural steel | E | 210,000 N/mm² | All reports |
| Structural steel | G | 81,000 N/mm² | All reports |
| Structural steel | fu | 410 N/mm² | Used in weld checks |
| GI pipe (subframe) | fy | 400 N/mm² | Galvanised steel — confirmed P105 |
| Concrete (footing) | fck | 25 N/mm² | C25/30 — RM, Faber Walk, P105 |
| Concrete | γc | 25 kN/m³ | All reports |
| Steel self-weight | γs | 78.5 kN/m³ | All reports |
| Rebar (lifting hooks) | fub | 500 N/mm² | H20 high yield bar — P105 |
| Grade 8.8 bolts | fub | 800 N/mm² | All reports |
| Grade 8.8 bolts | fyb | 640 N/mm² | All reports |
| Weld strength | fw | 220 N/mm² | E45 weld — all reports |

---

*Last updated: April 2026*
*Next update: after PE/SME session resolving items in Section 8*
