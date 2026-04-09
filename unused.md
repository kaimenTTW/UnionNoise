# PRD: AI-Assisted Noise Barrier Design System

## Context for AI Assistants

This document is the product requirements document for an AI-assisted engineering workflow system built for Union Noise / Hebei Jinbiao. It doubles as a context file for Claude Code and Google AI Studio. When working on any part of this system, reference this document for architectural decisions, scope boundaries, and domain constraints.

### Source Confidence Legend

Not all information in this PRD carries equal confidence. Each section is tagged with a source indicator. When building, treat these accordingly:

| Tag | Meaning | How to Handle |
|-----|---------|---------------|
| ✅ CONFIRMED | Verified from multiple sample projects or direct client communication (kickoff meeting, Rowena) | Build against this with confidence |
| ⚠️ PROVISIONAL | Seen in one sample project only, inferred, or not yet validated by SME | Build the structure but use placeholder/configurable logic; isolate so it can be swapped |
| ❌ MISSING | Known gap — required to build but not yet received from client | Do not build calculation logic; scaffold the interface only |

> **Important:** Sample projects (CR208, Bayshore C2, others) are references for drawing presentation and format only — not engineering law. A pattern is only CONFIRMED when it appears consistently across multiple projects or is explicitly stated by the client or SME. A single sample project observation is at best ⚠️ PROVISIONAL.

> **Rule for contributors:** If you implement something based on a ⚠️ PROVISIONAL source, add a code comment `# PROVISIONAL: pending SME validation — see PRD Section X.X` so it is easy to find and update when confirmation arrives.

---

## 1. Problem Statement

Union Noise responds to tenders and RFPs for noise barrier projects. Each tender requires a fresh set of engineering drawings and a PE-endorsable design report, and producing these is slow, manual, and difficult to scale. Coordinators currently convert customer tender requirements into formal drawings using AutoCAD, referencing previous similar projects and manually plotting layouts — a process that consumes significant time per configuration.

An earlier demo that jumped directly from requirements to AutoCAD-style output was rejected by the client — a fast drawing generator that cannot explain the engineering path is not useful. The client is buying **decision support plus drawing acceleration**, not an autonomous black box.

### Core Success Criteria

- Engineers and project coordinators can produce engineering-grounded noise barrier drawings and design reports significantly faster than the current manual process.
- Every output is traceable to its engineering inputs: uploaded requirements, interpreted geometry, governing load assumptions, code clause references, member selections, and verification results.
- The system handles the common, repeatable design path for **temporary noise barrier projects** reliably. Edge cases and permanent projects are explicitly deferred and tracked.
- Projects are archivable, queryable, and re-runnable — users can return to a past project, tweak inputs, and regenerate outputs without starting from scratch.

---

## 2. Users and Stakeholders

| Role | Description | Interaction with System |
|------|-------------|------------------------|
| Project Coordinator | Prepares tender responses; not necessarily an engineer | Primary user — uploads documents, configures parameters, generates drawings and reports |
| Structural Engineer | Reviews and validates engineering logic | Reviews calculation outputs, validates assumptions, approves designs |
| Professional Engineer (PE) | Signs off on design reports for submission | Reviews and endorses the design report; introduction and summary require PE signature |
| Client Leadership (Ricky) | Founder of Union Noise | Evaluates whether the system delivers tangible business value |

---

## 3. System Architecture — Three-Layer Model

The system is structured as three distinct layers, with a centralized ProjectContext object that carries state across all layers. The system is designed for **repeatability** — each new tender instantiates a fresh ProjectContext, but the engineering logic, parts library, code references, and drawing templates are persistent shared assets.

### Layer 1: Ingestion and Context Assembly

**Purpose:** Extract structured parameters from uploaded client documents and establish the design context.

**Inputs:**
- Requirements document (PDF) — contains barrier specifications such as height, type, material preferences, and project constraints from the tender/RFP.
- Site plan (PDF) — provided by customers, shows the physical layout where barriers will be installed.

**Processing:**
- Extract structured parameters from requirements document: barrier height, barrier type, environmental constraints, client specifications.
- Extract spatial and contextual information from site plan: barrier alignment, distances, site boundaries, relevant landmarks, and potential obstructions.
- User confirms and adjusts extracted parameters as needed.
- User draws barrier baseline outline on the calibrated site plan.
- System generates segment table from the drawn outline.

**Output:** A populated ProjectContext object containing all design parameters needed for downstream calculation and drawing generation.

**Technical Considerations:**
- PDF extraction approach: evaluate Docling, vision model extraction, or a hybrid depending on document quality and consistency.
- Site plan calibration: user must specify scale by clicking two points with known distance.
- The ProjectContext schema must be defined rigorously upfront with versioning, as every downstream layer depends on it.
- Site plans vary significantly in quality and format — the extraction pipeline must handle this gracefully with user confirmation steps.
- Support for uploading additional drawing layers (trees, levels, structures) for topology and shelter factor calculations.

---

### Layer 2: Engineering Rules Engine

**Purpose:** Run transparent, auditable engineering calculations to determine structural viability and select appropriate components.

This is the layer where client trust is built or lost. Every formula, assumption, and pass/fail result must be inspectable and traceable. The system acts as a **junior assistant** — it suggests starting points based on requirements and codes, and the user reviews, adjusts, and approves before proceeding.

#### 2.1 Design Parameters (Client-Defined Input → Consideration → Output)

The calculation engine follows the client's own parameter mapping. Each row represents an input that feeds a specific engineering consideration and produces concrete outputs:

| Parameter (Input) | Consideration | Report (Output) |
|---|---|---|
| Basic wind speed | Design wind pressure | Factored wind pressure |
| Return period | Design wind speed | Design wind speed |
| Structure height (from ground) | Maximum wind pressure | Factored wind pressure |
| Post spacing | Tributary area | Member design, reaction forces |
| Subframe spacing | Beam unsupported length | UB section, buckling check |
| Allowable soil bearing pressure | Footing design | Footing dimension, moment checks |
| Concrete grade | Bolt design | Cast-in bolt (CIB) diameter, quantity, embedment |
| Steel grade | Beam design, plate design | UB section, deflection check, lifting hole checks, weld design |
| Rebar grade | Lifting hook design | Bar diameter, lifting hook quantity |
| Bolt grade | Bolt design | CIB diameter, quantity, embedment |
| Type of footing | Beam design, footing design | UB section, footing dimension |

> **Key insight:** Outputs are specific component selections and dimensions (UB section sizes, bolt diameters, footing dimensions), not just pass/fail verdicts. The calculation engine must produce these concrete values.

#### 2.2 Calculation Flow — Dependency Chain

The calculations are NOT independent modules — they form a dependency chain:

1. **Wind Analysis** (basic wind speed + return period + structure height → factored wind pressure)
2. **Steel Design** (wind loads + post spacing + subframe spacing + steel grade → UB section selection, member design, reaction forces, buckling checks, deflection checks, connection design, lifting hole checks, weld design)
3. **Foundation Design** (reaction forces + soil bearing pressure + concrete grade + rebar grade + bolt grade + footing type → footing dimensions, moment checks for sliding/overturning/bearing, anchor bolt design, lifting lug design, bar schedule)

Changing an upstream parameter (e.g., wind speed) must propagate through the entire chain.

**Utilization target ✅ CONFIRMED (PE calculation report):** The governing rule is UR < 1.0 across all checks. There is no mandatory 0.9 lower bound — that was CR208-specific. Individual checks in the PE report range from 0.05 to 0.97. The system must flag UR ≥ 1.0 as a hard failure. Surfacing under-utilization as a warning is a nice-to-have, not a requirement.

#### 2.3 Code Clause References

**Placement in workflow:** Code selection is the first action in Step 3 — Design Workspace, before any calculation runs. The confirmed codes govern the calculation engine and are cited in Section 3 of the PE submission report.

**UI pattern:** Multi-select checklist. Codes pre-selected based on project type (temporary barrier defaults below). Engineer confirms or adjusts before proceeding. Cannot run calculations until codes are confirmed.

| Display Label | Formal EN Designation | Governs | Default State |
|---|---|---|---|
| Eurocode 0 — Basis of Structural Design | EN 1990:2002 | Basis of structural design | ✅ Pre-selected (every project) |
| Eurocode 1 — Actions on Structures | EN 1991-1-1 to 1-7 | Actions on structures including wind | ✅ Pre-selected (every project) |
| Eurocode 2 — Design of Concrete Structures | EN 1992-1-1:2004, EN 1992-1-2:2004, EN 1992-2:2005, EN 1992-3:2006 | Design of concrete structures | ✅ Pre-selected (every project) |
| Eurocode 3 — Design of Steel Structures | EN 1993-1-1 to 1-12 (incl. EN 1993-1-8:2005 joints) | Design of steel structures | ✅ Pre-selected (every project) |
| Eurocode 7 — Geotechnical Design | EN 1997-1:2004 | Foundation design (DA1C1, DA1C2) | ✅ Pre-selected (every project) |
| Singapore National Annex | NA to SS EN 1991-1-4:2009 (and related parts) | SG-specific parameters (terrain, wind, etc.) | ✅ Pre-selected (every project) |
| SS 602:2014 | SS 602:2014 | Noise control on construction sites | ☐ Optional (acoustic requirements) |

**UI implementation note:** The checklist displays the **Display Label** column to the user. The **Formal EN Designation** is stored in ProjectContext and cited verbatim in Section 3 of the PE submission report. Do not display raw EN designations as the primary label — they are reference strings, not user-facing names.

> **Source:** Confirmed from PE calculation reports (Lawson Chung, Civil PE 5703; Lim Han Chong, Civil PE 4382). All four Eurocodes plus SG NA are used on every standard temporary barrier project. EN 1997 (EC7) added based on geotechnical design checks confirmed in foundation module. Formal EN designations confirmed from Eurocode document filenames provided by client.

> **Action for SME sessions:** Confirm whether the Singapore National Annex modifies any specific coefficients used in the calculation engine (terrain category, Cprob parameters K and n, load combination factors).

#### 2.4 Wind Pressure Calculation ✅ CONFIRMED (multiple PE calculation reports)

**Sources:**
- PE's Design Calculation Report, Type 1 6mH TNCB on embedded footing, PE Lawson Chung, March 2026 (RM project)
- PE's Design Calculation Report, Type 1 6mH TNCB on exposed footing, PE Lawson Chung, Jan 2026 (Faber Walk)
- PE's Design Calculation Report, Type 2A 12.736mH TNCB on embedded footing, PE Lim Han Chong / Han Engineering, Nov 2023 (P105 Punggol)

All three reports use the same EC1 equation 4.2 (Cprob) framework and EC1 Table 7.9 pressure coefficients. The differences between reports are systematic and driven by project inputs, not by PE discretion.

---

**Step 1 — Peak velocity pressure qp (height-dependent, not a fixed constant):**

Uses EC1 Clause 4.3 (roughness factor, turbulence, mean velocity) with Singapore National Annex. **qp must be computed dynamically from project inputs** — it is not a fixed value.

Fixed constants (SG NA):
- Basic wind velocity: vb0 = 20 m/s
- Air density: ρ = 1.194 kg/m³
- Terrain category: II (z0 = 0.05 m, zmin = 2 m)
- Orography factor: Co(ze) = 1.0 (flat terrain default)
- Cprob parameters: K = 0.2, n = 0.5 (EC1 recommended)

Project-specific inputs that drive qp:
- **Return period** — directly controls the Cprob probability factor. Confirmed values seen in practice: 50 years (standard), 10 years (shorter-duration projects), 5 years (short-term site works). The return period must be a user-editable input with a default of 50 years. ⚠️ PROVISIONAL: confirm default with client/SME for each project type.
- **Structure height ze** — roughness factor cr(z) and turbulence Iv(z) are height-dependent. At 6mH the simplified SG NA approach gives qp ≈ 0.394–0.435 kPa depending on return period; at 12.736mH the full EC1 chain gives qp ≈ 0.599 kPa. Do not hardcode 0.394 kPa as a constant.

EC1 Clause 4.3 computation chain:
```
kr = 0.19 × (z0 / 0.05)^0.07
cr(z) = kr × ln(ze / z0)             for zmin ≤ ze ≤ 200m
vm(z) = cr(z) × Co(z) × vb           mean wind velocity
Iv(z) = kl / (Co(z) × ln(ze / z0))   turbulence intensity  (kl=1, SG NA)
qp(ze) = [1 + 7×Iv(z)] × 0.5 × ρ × vm(z)²
```

Reference outputs for validation (do not hardcode):
| Scenario | ze | Return period | qp |
|---|---|---|---|
| RM project (embedded footing) | 6m | 50yr | 0.394 kPa |
| Faber Walk (exposed footing) | 6m | 5yr | 0.435 kPa |
| P105 Punggol | 12.74m | ~50yr | 0.599 kPa |

---

**Step 2 — Design pressure using EC1 Table 7.9 (free-standing walls and parapets):**

Pressure coefficients vary by zone (A/B/C/D) and l/h ratio (barrier length to height):

| Zone | l/h < 3 | l/h = 5 | l/h > 10 |
|------|---------|---------|---------|
| A | 2.3 | 2.9 | 3.4 |
| B | 1.4 | 1.8 | 2.1 |
| C | 1.2 | 1.4 | 1.7 |
| D | 1.2 | 1.2 | 1.2 |

(Values above are for barriers without return. With return: A=2.1, B=1.8, C=1.4, D=1.2)

---

**Step 3 — Apply shelter factor:**

Shelter factor is a site-specific multiplier applied to qp before computing design pressure. Default = 1.0 (no shelter reduction). Must remain a user input per project.

Confirmed values seen in practice:
- 1.0 — open site, no shelter (RM and Faber Walk projects)
- 0.5 — sheltered site (P105 Punggol, LTA tunnel environment)

PE uses Google Maps to measure distances to surrounding structures to determine the appropriate shelter factor. The system should prompt the user to confirm this value explicitly.

---

**Governing design pressure:**

```python
# CONFIRMED across 3 PE reports
# Step 1: compute qp dynamically from return_period, structure_height, terrain_category
# Step 2: look up cp from EC1 Table 7.9 based on user-confirmed zone and l/h ratio
# Step 3: apply shelter factor (user input, default 1.0)
# design_pressure = qp * cp * shelter_factor
```

The zone selection (A/B/C/D) and l/h ratio are engineering judgements that the system must present to the user for confirmation. Do not auto-select. The difference between Zone A and Zone D can be 3× — this is why engineering judgement governs zone choice, not the raw calculation (meeting note, 2 Apr 2026).

> **Note on effective length Lcr for torsional buckling:** Confirmed across reports that Lcr = subframe spacing (not post height, not a fixed constant). At 3m post spacing with 1.5m subframe: Lcr = 1500mm. At 6m post spacing: Lcr = 1500mm (same subframe). The calculation engine must derive Lcr from the subframe_spacing input, not hardcode it.

#### 2.5 Assumptions and Allowances

**Confirmed from PE calculation reports ✅:**
- Structural steel: S275, fy = 275 N/mm², E = 200 GPa (all three reports)
- Structural steel: S355 also listed in Faber Walk material spec — parts library must include both grades ⚠️ PROVISIONAL: confirm when S355 is used vs S275
- Concrete: C25/30 (Eurocode designation — characteristic cylinder/cube strengths 25/30 MPa) — confirmed in RM and Faber Walk reports
- Concrete C28/35 used in P105 (LTA project) — minimum concrete grade is project/client-specific, not a fixed constant ⚠️ PROVISIONAL: treat as a user-selectable input, default C25/30
- Steel self-weight: 78.5 kN/m³
- Concrete self-weight: 25 kN/m³
- Load combinations: **ULS = 1.35 DL + 1.5 LL + 1.05 WL**, **SLS = 1.0 DL + 1.0 LL + 1.0 WL**
- Deflection limit: **L/65** (cantilever span)
- Base friction coefficient: 0.3 (for sliding check, exposed footing type)
- Soil bearing capacity default: **75 kPa** when no site investigation available ✅ (kickoff meeting); P105 uses 120 kPa minimum — allowable soil bearing pressure is a user input, not a constant

**Concrete grade note — SME clarification needed ⚠️:**
Parameter files list concrete grade as "28 MPa" but the RM and Faber Walk PE reports use C25/30. C25/30 has a cube strength of 30 MPa. P105 uses C28/35. The "28 MPa" in parameter files may refer to C28/35 cube strength. Confirm with SME which is the correct default and how it is specified in each project context.

**Soil parameters ⚠️ PROVISIONAL — must be user-configurable, not hardcoded:**

Two PE reports show different soil assumptions. These are site-specific geotechnical inputs:

| Parameter | RM report (embedded) | P105 report (embedded) | Notes |
|---|---|---|---|
| Friction angle φk | 30° | 30° | Consistent — likely SG default |
| Soil density γs | 20 kN/m³ | 19 kN/m³ | Minor variation — keep configurable |
| Cohesion c'k | 0 kN/m² | 2 kN/m² | Varies by site — do not hardcode to zero |

Default values pending SME confirmation: φk = 30°, γs = 20 kN/m³, c'k = 0 kN/m². All must be user-editable per project.

**Still provisional ⚠️:**
- Shelter factor value — user input per project, default 1.0 (no shelter); 0.5 seen in LTA/enclosed site project (P105)
- Return period — user input per project, default 50 years; 5-year and 10-year periods confirmed in practice for shorter-duration projects
- Zone selection (A/B/C/D) for wind pressure — engineering judgement, must be user-confirmed per project
- Effective length Lcr for torsional buckling — taken from subframe_spacing input, not hardcoded

**Allowances** should be backed by mathematical implications and reference historical allowances approved in past projects.

#### 2.6 Pre-Approved Parts Library (Database)

The system must query a **database of pre-approved structural members** that the client actually uses. This prevents the AI from recommending non-existent or unapproved components.

**Member types include:**
- Steel posts / UB sections (various sizes and grades) — varies significantly per project
- Base plates (various sizes and thicknesses) — driven by calculation outputs
- Cast-in bolts / anchor bolts (types, diameters, embedment depths)
- Foundation types (varies per site — do not assume a single standard type)
- Noise barrier panels (types, dimensions, acoustic ratings) ⚠️ PROVISIONAL — 2000×500×33mm seen in both CR208 and Bayshore C2 but this is Hebei Jinbiao's own product; dimensions may vary by project or panel type; treat as a selectable parameter not a constant
- Subframe members — pipe size and spacing vary per project
- Rebar specifications
- Lifting hooks and lugs

> **Critical:** No member dimension or grade should be hardcoded in the system. Every member is a selectable input drawn from the parts library. The parts library itself is ❌ MISSING — scaffold the database structure now, populate with real data when received from client.

**Architecture:** Backend database exposed to the system. During the design loop, the engineering rules engine queries available members, checks whether the current configuration satisfies all calculations, and if not, suggests the next viable option from the library.

#### 2.7 Structural Acceptance Gate ✅ CONFIRMED (PE calculation report)

An aggregation view combining results from all calculations:
- Each structural element reports its utilization ratio
- **UR < 1.0 is the only hard requirement** — confirmed from PE report across all checks
- UR ≥ 1.0 → hard failure, user must resolve before proceeding
- No mandatory lower bound — do not enforce a minimum UR
- Clear indication of which specific check(s) failed and why
- Users can iterate on parameters and re-run until all checks pass
- The gate produces the data needed for Section 4 of the Design Report (utilization ratios summary)

**Checks confirmed from PE report (all must pass):**
- Moment (torsional buckling) — ULS
- Deflection — SLS
- Bolt tension
- Bolt combined (shear + tension)
- Bolt bearing
- Plate bending
- Secondary plate
- Weld (governing check — UR 0.92 in sample)
- Rod bond (bolt embedment)
- Lifting hook tension
- Lifting hook pullout
- Lifting hole shear (edge distance)
- Subframe bending
- Foundation sliding (SLS, DA1C1, DA1C2)
- Foundation overturning (SLS, DA1C1, DA1C2)
- Concrete bearing

#### 2.8 Cutting List and Material Optimization

After the design is verified, the system generates a cutting list that optimizes material usage:
- Calculates how to cut standard raw material lengths to minimize waste
- Reuses leftover segments across multiple cuts (e.g., balancing a 3m need from leftover after cutting a 6m piece from 9m stock)
- Provides recommendations based on experience and calculation
- Feeds into the Bill of Quantities

#### 2.9 Incremental Recalculation

The system must support **partial re-runs** without restarting from step one:
- User changes a single input (e.g., barrier length reduced from 100m to 80m, or a manhole discovered)
- System recalculates all affected downstream values
- Previous versions of a project are retained — users can revisit specific steps and trigger recalculation from that point
- Minimal disruption to unchanged parts of the design

#### 2.10 Confirmed Calculation Formulas ✅ (multiple PE calculation reports)

**Sources:**
- PE's Design Calculation Report, Type 1 6mH TNCB on embedded footing, PE Lawson Chung, March 2026 (RM project)
- PE's Design Calculation Report, Type 1 6mH TNCB on exposed footing, PE Lawson Chung, Jan 2026 (Faber Walk)
- PE's Design Calculation Report, Type 2A 12.736mH TNCB on embedded footing, PE Lim Han Chong, Nov/Dec 2023 (P105 Punggol)

The core formula chain is confirmed consistent across all three reports. Differences are systematic, driven by footing type and structural configuration, not by PE discretion. The calculation engine branches explicitly by footing type at the foundation module.

---

**Steel Design — Beam (✅ confirmed across all three reports)**
```
Design UDL:         w = design_pressure × post_spacing                    [kN/m]
Post moment ULS:    M_Ed = 1.5 × w × L² / 2                              [kNm]
Post shear ULS:     V_Ed = 1.5 × w × L                                   [kN]

Where L = post_length (above foundation level)
```

**Steel Design — Torsional Buckling Check (EC3) (✅ confirmed across all three reports)**
```
Moment capacity:    M_pl = W_pl × f_y                                     [kNm]
Mcr formula:        Mcr = C1 × (π²EIz/Lcr²) × sqrt(Iw/Iz + Lcr²GIt/π²EIz)
Slenderness:        λ'_LT = sqrt(M_pl / Mcr)
Imperfection:       α_LT = 0.34 (rolled sections h/b > 2, buckling curve b)
                    α_LT = 0.34 (rolled sections h/b ≤ 2, buckling curve b) ⚠️ PROVISIONAL: P105 uses curve b for UB406 (h/b=2.84); confirm curve selection rule
φ_LT:               0.5 × [1 + α_LT(λ'_LT - 0.4) + 0.75λ'_LT²]         (λ_LT,0=0.4, β=0.75)
Reduction factor:   χ_LT = 1 / (φ_LT + sqrt(φ_LT² - 0.75λ'_LT²))
Resistance:         Mb,Rd = χ_LT × W_pl × f_y
UR:                 M_Ed / Mb,Rd < 1.0

IMPORTANT: Lcr = subframe_spacing (not post_length, not a hardcoded value)
Confirmed: Lcr = 1500mm at 1.5m subframe spacing (both 3m and 6m post spacing projects)
```

**Steel Design — Deflection Check (✅ confirmed across all three reports)**
```
Actual deflection:  δ = w × L⁴ / (8 × E × I)                            [mm]
Allowable:          δ_allow = L / 65                                       [mm]
UR:                 δ / δ_allow < 1.0
```

**Steel Design — Open Web Beam / Truss Member (⚠️ PROVISIONAL — Type 2A / long-span only)**
```
Applies to: Type 2A and other configurations using SHS open web beams spanning between posts
Section:    SHS (square hollow section) — Iw ≈ 0, warping negligible
Moment:     M_Ed = (1.5 / 8) × w_beam × L_span²                         [kNm]  (simply supported)
Shear:      V_Ed = 1.5 × w_beam × L_span / 2                            [kN]
UR checks:  same EC3 bending/shear/torsional buckling chain as post design
            Note: for SHS λ'_LT is typically low (< 0.4) → χ_LT ≈ 1.0

Source: P105 report, SHS 50×50×4 spanning 6.5m. Treat as provisional pending
additional Type 2A projects; do not activate for Type 1 designs.
# PROVISIONAL: pending SME validation — see PRD Section 2.10
```

---

**Connection Design — Bolt Check (✅ confirmed, exposed and embedded footing)**
```
Lever arm:          z = bolt_spacing / 2                                   [m]
Tension from M:     F_t = M_Ed / z                                        [kN]
Tension per bolt:   F_t,bolt = F_t / n_tension_bolts
Shear per bolt:     F_v,bolt = V_Ed / n_shear_bolts
Tension UR:         F_t,bolt / F_t,Rd < 1.0
Combined UR:        F_v,bolt/F_v,Rd + (F_t,bolt/F_t,Rd) / 1.4 < 1.0
```

**Weld Design (EC3) (✅ confirmed, exposed and embedded footing)**
```
τ_II (shear):       V_Ed / (throat × weld_length)                        [N/mm²]
τ_⊥, σ_⊥ (tension): F_tension / (throat × weld_length)                  [N/mm²]
Combined check:     sqrt(σ_⊥² + 3(τ_⊥² + τ_II²)) ≤ f_u / (β_w × γ_M2)
```

**Anchor Bolt / Cast-in Bolt Embedment (EC2) (✅ confirmed)**
```
Bond stress:        f_bd = 2.25 × η1 × η2 × f_ctd                       (η1=1, η2=1 for straight bars)
Resistance:         F_bond = f_bd × π × φ × l_embed
UR:                 F_t,bolt / F_bond < 1.0
```

**Base Plate Bearing Check (EC3) (⚠️ PROVISIONAL — seen in P105, LTA-level detail)**
```
Applies to: projects requiring full base plate bearing verification (e.g. LTA submissions)
fcd = fck / γc
c = t × sqrt(fy / (3 × fcd × γM0))          cantilever dimension from column face
beff = 2c + tf                               effective bearing width
leff = 2c + b                               effective bearing length
Area = beff × leff
Compression resistance = fcd × Area
UR: compression_force / compression_resistance < 1.0
# PROVISIONAL: confirm whether this check is required for all projects or LTA-specific only
```

---

**Foundation Module — branches by footing_type input**

> The calculation engine must branch here. Exposed footing and embedded footing use different governing mechanics. The footing_type parameter (user input from Step 1) controls which branch executes.

**Branch A: Exposed Pad Footing (✅ confirmed — Faber Walk report)**

```
Sliding Check (SLS / DA1C1 / DA1C2):
  Resisting force:  F_R = μ × P_vertical            (μ = 0.3, base friction)
  FOS_SLS:          F_R / H_SLS > 1.5
  FOS_DA1C1:        F_R / H_DA1C1 > 1.35
  FOS_DA1C2:        F_R / H_DA1C2 > 1.0

Overturning Check (SLS / DA1C1 / DA1C2):
  Resisting moment: M_Rd = P_vertical × (B/2)
  FOS_SLS:          M_Rd / M_SLS > 1.5
  FOS_DA1C1:        M_Rd / M_DA1C1 > 1.35
  FOS_DA1C2:        M_Rd / M_DA1C2 > 1.0

Bearing Check (Meyerhof eccentric load):
  e = M / P_vertical
  if e > B/6: footing in tension, uplift check required
  b' = B - 2e                                       (reduced effective width)
  q_max = 4P / (3 × L × b')                        (for e > B/6)
  q_max = P/A × (1 + 6e/B)                          (for e ≤ B/6)
  UR: q_max / q_allow < 1.0
```

**Branch B: Embedded RC Footing (✅ confirmed — RM report; ⚠️ some parameters provisional)**

```
Passive Earth Resistance:
  Kp = (1 + sinφd) / (1 - sinφd)                   (Rankine passive)
  φd = φk / γφ                                      (DA1C2: γφ=1.25; DA1C1: γφ=1.0)
  pp = γs × D × Kp                                 [kN/m²]
  Pp = 0.5 × pp × D × W                            [kN]  (passive force)

Overturning Check:
  M_Rd = P_vertical × (B/2) + Pp × (D/3)
  FOS_SLS: M_Rd / M_SLS > 1.5
  FOS_DA1C1 / DA1C2: as above with respective load factors

Sliding Check:
  Resisting force: F_R = P_vertical × tanφd + Pp
  FOS_SLS: F_R / H_SLS > 1.5
  FOS_DA1C1 / DA1C2: as above

Bearing Check — Full Meyerhof (EC7 Annex D):
  # Required for embedded footing; more rigorous than exposed footing bearing check
  Nq = e^(π×tanφd) × tan²(45° + φd/2)
  Nc = (Nq - 1) × cotφd
  Nγ = 2(Nq - 1) × tanφd
  Shape factors: sq, sc, sy (functions of B'/L')
  Inclination factors: iq, ic, iy (functions of load inclination angle)
  qu = c'×Nc×bc×sc×ic + q'×Nq×bq×sq×iq + 0.5×γs×B'×Nγ×bγ×sγ×iγ
  UR: q_max / qu < 1.0

Soil parameters (all user-configurable, not hardcoded):
  φk = 30° (provisional default — confirm per site investigation)
  γs = 20 kN/m³ (provisional default — 19 kN/m³ seen in P105)
  c'k = 0 kN/m² (provisional default — 2 kN/m² seen in P105)
  # PROVISIONAL: pending SME validation — see PRD Section 2.5
```

---

**Lifting Hook (✅ confirmed)**
```
Factored load:      F_factored = (concrete_weight / n_hooks) × 1.35
Tensile strength:   T = A_s × f_yd = (π/4 × φ²) × (f_yk / 1.15)
Tension UR:         F_factored / T < 1.0
Pullout resistance: F_pullout = f_ctd × perimeter × embedment_per_leg × n_legs
Pullout UR:         F_factored / F_pullout < 1.0
```

**Lifting Hole (✅ confirmed)**
```
Shear area:         A_v = edge_distance × web_thickness
Shear strength:     V_Rd = A_v × (f_y / sqrt(3))
Factored load:      F = post_weight × 1.5
UR:                 F / V_Rd < 1.0
```

**Subframe Check (✅ confirmed)**
```
Factored moment:    M_Ed = (1.5/12) × w × L_subframe × L_subframe       [kNm]
Section modulus:    Z = π × d³ / 32  (circular GI pipe approximation)
Stress:             σ = M_Ed / Z
UR:                 σ / f_y < 1.0
```

> **Note for Claude Code:** The formula chain is confirmed correct for Type 1 and Type 2A at both 6mH and 12mH+ heights. The foundation module branches explicitly by footing_type. The wind module computes qp dynamically from project inputs — do not hardcode 0.394 kPa. All soil parameters, return period, shelter factor, and concrete grade are user-configurable inputs. Member selection (which UB section) is determined by iterating through the parts library until UR < 1.0 for all checks.



**Purpose:** Convert the verified design into two distinct output packages.

This layer is **deterministic** — by the time it executes, all engineering decisions are finalized in the ProjectContext. No AI reasoning occurs here; it is a rendering pipeline.

#### 3.1 Output Package A: Design Report (PE Submission Document)

An 8-section engineering report for PE endorsement:

| Section | Description | Contents |
|---------|-------------|----------|
| 1 | Cover Page | Project title, project code, design type, submission number |
| 2 | Table of Contents | Auto-generated |
| 3 | Design Summary | a. Codes of practice and reference standards (list) b. Material design parameters (list) c. Design load considerations (summary) |
| 4 | Structural Analysis and Design | Summary of structural checks and utilization ratio of each structural element |
| 5 | Wind Analysis | a. Derivation of wind loads b. Design wind pressure (unfactored and factored) |
| 6 | Design Information | Design information and parameters used |
| 7 | Steel Design | a. Column design — analysis, design, checking (shear, bending, buckling, deflection) b. Lifting hole check c. Connection design (base plate, welds) d. Anchor bolt design (quantity, diameter, embedment) e. Reaction forces and moments |
| 8 | Foundation Design | a. Footing dimensions b. Moment checks (sliding, overturning, bearing) c. Lifting lug design (or checking) d. Minimum steel area (rebar) e. Bar chair design (or checking) |

> **Note:** Introduction and summary require PE signature. The system generates the report body; the PE reviews, endorses, and signs.

**Format:** PDF generated from structured data. All values must be traceable to their calculation source.

#### 3.2 Output Package B: AutoCAD Drawing Set

A multi-sheet drawing package. The general hierarchy below is consistent across sample projects reviewed — but exact sheet numbering, scales, and title block format vary by client and submission type.

**Drawing hierarchy ✅ CONFIRMED (consistent across CR208 and Bayshore C2):**

| Sheet | Content |
|---|---|
| Sheet 1 | General Notes + Material Schedule |
| Sheet 2 | Layout / site plan with barrier positioning and post labels |
| Sheet 3 | Developed elevation |
| Sheet 4+ | Section views per post type |
| Sheet 5+ | Connection details per post type |

> Sheet numbering conventions (e.g. 0001/1xxx/2xxx/3xxx) vary by client submission requirements — do not hardcode. The system should generate sheet numbers based on a configurable template.

**Post labelling convention ⚠️ PROVISIONAL (observed across CR208 and Bayshore C2):**
Format observed: `NBC-[PROJECT IDENTIFIER]-[TYPE]-[Sequential number]`
This appears consistent in format but the identifier segment varies per project. Implement as a configurable template with user-editable prefix. Do not hardcode.

**Multiple post sections per alignment ✅ CONFIRMED (both CR208 and Bayshore C2):**
A single barrier alignment may use different post sizes for different segments. The ProjectContext must support per-segment member overrides. Each distinct post type requires its own section drawing and connection detail sheet.

**Foundation type varies per project ✅ CONFIRMED (both samples show non-standard foundations):**
- CR208: post attached to existing RC beam
- Bayshore C2: soldier pile foundation driven by main contractor
- Standard ground-bearing precast footing: ❌ not yet seen in any sample
The drawing system must handle different foundation types as configurable inputs, not a fixed template.

**Title block ⚠️ PROVISIONAL:**
- Fields needed: project name, drawing number, revision, date, scale, drawn by, checked by, approved by, main contractor, subcontractor (Hebei Jinbiao), revision history table
- Additional fields (QP endorsement block, LTA endorsement block) are client/submission-specific — make these optional and configurable
- Exact layout varies by submission type; do not hardcode to CR208's LTA format

**Drawing requirements:**
- Must conform to Union Noise's established drawing style — obtain style guide from client
- Lengths attached to all drawn elements
- Section cut references on elevation must cross-reference section sheet numbers
- High level of detail matching real project deliverables

#### 3.3 Output Package C: Bill of Quantities and Cutting List

- Bill of Quantities (BQ): complete material quantities for procurement
- Cutting list: optimized material cutting plan with waste minimization
- Bar schedule: reinforcement steel schedule for concrete footings

**Format:** Spreadsheet (Excel/CSV) or integrated into the design report.

#### 3.4 QA Validation Gate

Before export, the system validates:
- All required metadata fields are present (project name, client, drawn by, date, revision)
- All sheets and report sections are complete
- Engineering parameters match the verified ProjectContext (no stale data)
- All structural checks pass (utilization ≤ 100%)

#### 3.5 Output Handling

- Generated outputs are **available for download temporarily** but are not permanently stored
- The ProjectContext and all inputs ARE permanently stored and archived
- Users can regenerate outputs at any time by re-running from the archived project state

---

## 4. Technology Stack

All technology decisions are final for the first iteration. Do not reintroduce alternatives during development.

### Frontend
| Component | Technology | Notes |
|---|---|---|
| Framework | React + TypeScript | Production-grade from day one |
| Styling | Tailwind CSS | Utility classes, no UI component library |
| State management | **Zustand** | Chosen over React Context — avoids re-render issues across complex multi-step state |
| Site plan canvas | **Fabric.js** | Chosen over raw Canvas API — provides polyline drawing and object management for Step 2 |
| PDF viewer | PDF.js | Inline document viewing |
| API communication | React Query | Caching, loading states, retry logic |
| Routing | React Router v6 | Step guards, sequential navigation |
| Package manager | pnpm | Frontend dependencies |

### Backend
| Component | Technology | Notes |
|---|---|---|
| API framework | FastAPI (Python) | Async, Pydantic validation, OpenAPI docs |
| Background tasks | FastAPI BackgroundTasks → Celery + Redis | BackgroundTasks for prototype; Celery upgrade path documented |
| File handling | python-multipart | PDF uploads, output file serving |
| Package manager | uv | Backend Python dependencies |

### AI Layer
| Component | Technology | Notes |
|---|---|---|
| Document extraction | Claude API (direct calls) | Step 1 only for prototype — no LangGraph yet |
| LLM provider | Anthropic Claude | Primary model |
| Model routing | LiteLLM | Provider flexibility |
| Observability | LangSmith | Trace all AI decisions |
| Document pipeline | Docling + Vision models | PDF and site plan extraction |
| Workflow orchestration | **LangGraph (deferred)** | Not for prototype — introduce when Step 3 agentic reasoning is built |

### Calculation Engine
| Component | Technology | Notes |
|---|---|---|
| Core calculations | Python (NumPy / SciPy) | Deterministic only — no LLM in calculation path |
| Structure | Custom Python modules | One module per dimension (wind, steel, foundation) |
| Unit handling | Pint | Engineering unit validation |
| Dependency propagation | DAG-based recalculation | Upstream changes propagate downstream only |

### Output Generation
| Component | Technology | Notes |
|---|---|---|
| AutoCAD drawings | ezdxf (Python) | DXF output — no AutoCAD required |
| Design report (PDF) | **ReportLab** | Chosen over WeasyPrint — precise layout control for PE submission document |
| Bill of Quantities | openpyxl | Excel generation |
| Templates | Jinja2 | Configurable per client standards |

### Data Layer
| Component | Technology | Notes |
|---|---|---|
| Database | PostgreSQL | Projects, parts library, users, allowances |
| ORM | **SQLAlchemy 2.0 (async)** | Chosen over Tortoise ORM — more mature, async support sufficient |
| Migrations | Alembic | Schema versioning |
| File storage | Local filesystem → S3 | Prototype local; S3 upgrade path before production |
| Cache / broker | Redis | Required when upgrading to Celery |

### Development
| Component | Technology | Notes |
|---|---|---|
| Version control | Git / GitHub | Monorepo: frontend/ and backend/ |
| Containerisation | Docker + Docker Compose | Services: frontend, backend, PostgreSQL, Redis |
| Testing | pytest + Vitest | Unit tests for every calculation formula are critical |
| CI/CD | GitHub Actions | Wire up after prototype is stable |

---

## 5. ProjectContext Schema

The ProjectContext is the central data object that flows through all three layers. It must be rigorously defined, versioned, and fully serializable for archival and re-runs.

```
ProjectContext:
  # --- Project metadata ---
  project_info:
    project_name: str
    project_code: str
    client_name: str
    tender_reference: str
    design_type: str
    submission_number: str
    date: date
    revision: str
    drawn_by: str

  # --- Site data ---
  site_data:
    site_plan_source: file_reference
    calibration: {point_a, point_b, known_distance}
    barrier_alignment: list[coordinate_pair]
    segment_table: list[segment]
    total_barrier_length: float (m)
    site_constraints: dict
    additional_layers: list[file_reference]  # trees, levels, structures
    obstructions: list[obstruction]  # manholes, poles, trees

  # --- Design parameters (user inputs) ---
  design_parameters:
    basic_wind_speed: float (m/s)  # default 20 for SG
    return_period: int (years)
    structure_height: float (m)
    post_spacing: float (m)
    subframe_spacing: float (m)
    allowable_soil_bearing_pressure: float (kPa)  # default 75 if no site investigation
    concrete_grade: str
    steel_grade: str
    rebar_grade: str
    bolt_grade: str
    type_of_footing: str
    project_constraints: dict  # PE-specific or project-specific overrides

  # --- Code references ---
  applicable_codes:
    selected_clauses: list[code_clause_reference]
    wind_code: str  # e.g., "SS EN 1991-1-4 + SG NA"
    steel_code: str  # e.g., "SS EN 1993-1-1"
    concrete_code: str  # e.g., "SS EN 1992-1-1"
    geotechnical_code: str  # e.g., "SS EN 1997-1"
    basis_of_design: str  # e.g., "SS EN 1990"

  # --- Wind analysis outputs ---
  # ✅ CONFIRMED: formula and approach confirmed from PE calculation report (Lawson Chung, March 2026)
  wind_analysis:
    terrain_category: int              # ✅ default II (open terrain)
    orography_factor: float            # ✅ default 1.0 (flat terrain)
    reference_height: float (m)        # = structure height from ground
    peak_velocity_pressure: float (kPa) # ✅ qp, computed from EC1 eq 4.2
    lh_ratio: float                    # barrier length / height — user input
    zone: str                          # A/B/C/D — user confirms, governs design pressure
    pressure_coefficient: float        # from EC1 Table 7.9 based on zone and l/h
    shelter_factor: float              # user input, default 1.0
    design_pressure: float (kPa)       # ✅ = qp × cp × shelter_factor — governing value

  # --- Selected members ---
  # ⚠️ PROVISIONAL: full parts library not yet received from client
  # ✅ CONFIRMED: multiple post sections per alignment required (seen in both CR208 and Bayshore C2)
  # ⚠️ PROVISIONAL: no default steel grade — varies per project (CR208: S355, Bayshore C2: S275)
  # ⚠️ PROVISIONAL: no default panel dimensions — treat as selectable from parts library, not a constant
  selected_members:
    post_sections: list[{segment_range, member_reference}]  # per-segment, not project-level
    subframe_section: member_reference                       # pipe size varies per project
    subframe_spacing: float (m)                              # varies per project and barrier type
    base_plate: list[{post_type, member_reference}]          # varies per post type
    anchor_bolts: member_reference                           # type, diameter, quantity — varies per project
    foundation_type: str                                     # ❌ MISSING: standard type not yet seen
    footing: member_reference                                # ❌ MISSING: pending sample project
    panel_type: member_reference                             # selectable, not hardcoded — dimensions from parts library
    rebar: member_reference                                  # diameter, quantity
    lifting_hooks: member_reference                          # diameter, quantity

  # --- Calculation results ---
  # ✅ Full check list confirmed from PE calculation report
  calculation_results:
    wind_analysis:
      peak_velocity_pressure: float (kPa)
      design_pressure: float (kPa)
      zone: str
    steel_design:
      moment_uls: float (kNm)
      shear_uls: float (kN)
      selected_section: member_reference
      moment_ur: float              # torsional buckling check
      deflection_ur: float          # L/65 limit
      lifting_hole_ur: float
    connection_design:
      bolt_tension_ur: float
      bolt_combined_ur: float       # governing bolt check
      bolt_bearing_ur: float
      plate_bending_ur: float
      secondary_plate_ur: float
      weld_ur: float                # typically governing check
    embedment:
      bolt_embedment_ur: float
    lifting_hook:
      tension_ur: float
      pullout_ur: float
      anchorage_ur: float
    subframe:
      bending_ur: float
    foundation:
      sliding_sls_fos: float        # > 1.5
      sliding_da1c1_fos: float      # > 1.35
      sliding_da1c2_fos: float      # > 1.0
      overturning_sls_fos: float    # > 1.5
      overturning_da1c1_fos: float  # > 1.35
      overturning_da1c2_fos: float  # > 1.0
      bearing_ur: float

  # --- Material optimization ---
  material_outputs:
    cutting_list: list[cutting_instruction]
    bill_of_quantities: list[bq_item]
    bar_schedule: list[bar_schedule_item]

  # --- Verification ---
  verification:
    assumptions: dict
    allowances: dict  # with math backing and historical precedent references
    overall_status: enum [pass, fail, incomplete]
    failed_checks: list[{check_name, utilization_ratio, reason}]
    timestamp: datetime

  # --- Archival ---
  version_history: list[{version, timestamp, changed_fields, trigger}]
```

---

## 6. Project Archival and Management

### 6.1 Backend Database Requirements

- All projects are **packaged and archived** upon completion or at any save point
- Projects are **queryable** — users can search and filter past projects
- Projects are **editable and re-runnable** — users can reopen a past project, modify specific inputs, and trigger recalculation from the point of change
- The ProjectContext (all inputs and calculated state) is permanently stored
- Generated output files (drawings, reports) are available for **temporary download only** and are not permanently stored — they can be regenerated on demand

### 6.2 Allowances and Historical Precedent

- The system tracks allowances used in past projects that were approved
- When setting allowances for a new project, the system can suggest values based on similar past projects
- Each allowance must be backed by its mathematical implications (i.e., what happens to the design if this allowance changes)

---

## 7. Scope Boundaries

### In Scope (Phase 1): Temporary Noise Barrier Projects
- Standard straight-line barrier configurations
- Common design path with standard members
- All design parameters from the client's parameter table
- Full calculation dependency chain (wind → steel → foundation)
- Design report generation (8-section PE submission document)
- AutoCAD drawing set generation
- Bill of Quantities, cutting list, and bar schedule
- Project archival and re-run capability

### Explicitly Out of Scope (Phase 1)
- Permanent noise barrier projects (tailor-made to existing buildings — significantly more complex)
- Corner and turn conditions
- Gate and opening conditions
- Non-standard barrier configurations
- Unusual site geometries
- Obstruction handling and clash detection (manholes, trees, poles)
- Automatic shelter factor calculation from uploaded topology
- Advanced site investigation integration

### Phase 2 (Months 4–6)
- Edge cases: corners, turns, ends, gates
- Obstruction detection and layout adjustment suggestions
- Non-standard load cases and unusual site geometries
- Extended member library
- Shelter factor automation from site topology layers
- Permanent project support (evaluation)

---

## 8. Key Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Drawing fidelity gap | Client loses confidence if output looks toy-like vs. their real deliverables | Use sample projects as presentation references only — not engineering templates; request explicit drawing style guide from client |
| Formula validation delays | Cannot implement calculation modules without client sign-off | Shared formula validation document; track approval per parameter; leverage dedicated SME (4 hrs/week) |
| **Demo-sourced formulas are unvalidated** | **Building wrong calculation logic requiring significant rework** | **Treat ALL demo-derived formulas as provisional; isolate calculation logic behind configurable interfaces; mark with `# PROVISIONAL` in code; validate with SME before finalising** |
| Scope creep in Phase 1 | Team overcommits on edge cases, delays core delivery | Maintain explicit Phase 1/Phase 2 boundary; park requests in deferred list |
| Domain knowledge gap | Team lacks structural engineering expertise | Dedicated SME from client (~4 hrs/week); record all technical meetings |
| System looks complete before engineering depth is there | Convincing UI with shallow calculations destroys trust | Be honest about which checks are implemented vs. future scope; expose this in the UI |
| Incremental recalculation complexity | Partial re-runs introduce state consistency bugs | Rigorous ProjectContext versioning; clear dependency graph for propagation |
| Aggressive timeline | Working prototype expected after month 1 | Prioritize core flow end-to-end; defer polish and edge cases |
| Standard footing design unknown | Cannot build foundation module correctly | CR208 uses non-standard post-to-RC-beam foundation; request a ground-bearing sample project from client as priority |

---

## 9. Deferred Edge Cases (Living List)

Maintain this list from day one. Add to it as new edge cases are discovered during SME sessions.

- [ ] Corner/turn barrier configurations
- [ ] Gate and opening conditions
- [ ] Long span configurations (e.g. 15m span gate) — seen in Bayshore C2, explicitly out of Phase 1
- [ ] Soldier pile foundation — seen in Bayshore C2, out of Phase 1
- [ ] Post-to-existing-structure foundation (RC beam, slab) — seen in CR208, out of Phase 1
- [ ] End-of-barrier termination details
- [ ] Variable-height barriers along a single alignment
- [ ] Sloped terrain adjustments
- [ ] Multiple barrier types in a single project
- [ ] Non-standard footing conditions (e.g., rock, high water table)
- [ ] Seismic load considerations
- [ ] Acoustic performance calculations (STC/NRC ratings)
- [ ] Obstruction handling (manholes, poles, trees) and automatic layout adjustment
- [ ] Shelter factor automation from uploaded topology layers
- [ ] Permanent noise barrier projects
- [ ] Integration with external AutoCAD workflows beyond DXF export
- [ ] Advanced bar chair design variations
- [ ] Non-standard lifting lug configurations

---

## 10. Missing Documents Tracker

Track what has been requested from the client and what remains outstanding. Update as documents are received.

| Document | Why Needed | Status | Blocks |
|---|---|---|---|
| Design calculation report / Excel sheets | Formulas for steel design, foundation design | ✅ Received — PE Design Calculation Report (Lawson Chung, Type 1 6mH, Mar 2026) | Unblocked — formulas confirmed in Section 2.10 |
| Original RFP / tender document sample | Layer 1 ingestion pipeline for requirements extraction | ❌ Outstanding | Layer 1 ingestion |
| Full pre-approved parts library | Member selection logic, BQ accuracy | ❌ Outstanding | Parts library database |
| Additional calculation reports (other heights/types) | Confirm formulas scale correctly to 12m, different post spacings | ❌ Outstanding | Validation across project types |
| Eurocode references + SG NA | Confirm SG NA coefficient modifications | ⏳ Rowena to provide | Wind module SG NA parameters |
| Ground-bearing footing sample project (drawings) | Standard foundation drawing target — report confirmed, drawings still needed | ❌ Outstanding | Foundation section drawing generation |
| Remaining sample projects (~8 more) | Understand variation across project types | ❌ Outstanding | Validation, edge case discovery |
| Parameter list for design workspace | Confirm all 11 inputs and any additions | ❌ Due within 2 weeks of kickoff | Design workspace UI |
| Drawing style guide | Confirm Union Noise's internal drawing conventions | ❌ Outstanding | Drawing generation |
| CR208 drawing package | Sample project — presentation reference | ✅ Received | — |
| CR208 layout drawings (LA-1000, LA-1001) | Sample project — layout reference | ✅ Received | — |
| Bayshore C2 layout + long span drawing | Second sample project, edge case reference | ✅ Received | — |
| Design parameter files (18 projects) | Real input values across project types | ✅ Received | — |
| P105 Type 1A drawing package | Sample project — presentation reference | ✅ Received | — |
| Geotechnical report (Vol 7 GIBR) | Soil conditions reference | ✅ Received | Foundation module (conditional) |
| Kickoff meeting notes | Requirements and scope alignment | ✅ Received | — |

---

## 9. Engagement Model

| Cadence | Format | Purpose |
|---------|--------|---------|
| Weekly sync | In-person (initially) | SME validation, prototype review, requirements clarification |
| Monthly steering | Review meeting | Progress against timeline, scope decisions, stakeholder alignment |
| SME availability | ~4 hours/week | Validate designs, confirm calculation logic, review outputs |

### Key Deliverables from Client
- ~10 sample projects categorized by complexity (focus on most common types)
- Full list of pre-approved structural members (parts library)
- Engineering handbooks and code references used
- Golden template drawings showing expected output quality
- Old project drawings for style replication
- Parameter list for the design workspace (due within 2 weeks of kickoff)

---

## 11. Timeline

| Period | Milestone |
|--------|-----------|
| Weeks 1–2 | Requirements understanding, parameter list finalization, sample project review |
| Weeks 3–6 | Prototype development — core workflow operational |
| Month 2 | Working prototype with drawing generation and BQ output; first real project attempt |
| Month 3 | Phase 1 complete — system handles common temporary barrier design path end-to-end |
| Months 4–6 | Phase 2 — edge cases, advanced features, permanent project evaluation |

---

## 12. Success Metrics

| Metric | Phase 1 Target | Phase 2 Target |
|--------|---------------|----------------|
| Time from tender receipt to proposal package | 50% reduction vs. current process | 70% reduction |
| Engineering calculation coverage | All parameters from design parameters table for standard cases | Including edge cases and non-standard configurations |
| Drawing fidelity | Usable as tender submission with minor manual edits | Directly submittable with no manual edits |
| Design report completeness | All 8 sections generated with correct values | PE-ready with minimal review needed |
| Verification accuracy | All standard checks pass correctly | All checks including edge cases pass correctly |

---

## 13. First Iteration Build Guidance

This section is specifically for Claude Code. Read it before writing any code.

**Overview Page — Project Dashboard (FUNCTIONAL STUB)**

The Overview page is the application entry point (`/`). It establishes the user journey before the 6-step workflow begins.

- Route: `/` — default landing page
- "New Project" button — navigates to `/project/new`, initialises a fresh ProjectContext with a generated stub ID
- Project card grid — displays 2–3 hardcoded mock project cards for demo purposes
- Each project card shows: Project Name, Barrier Type, Location, Date, Status badge (e.g. "In Progress", "Complete")
- Clicking a project card navigates to `/project/:id` (stub — loads mock data for now)
- Clean engineering-tool aesthetic consistent with the rest of the app — no decorative elements

**Data layer requirement (critical for future upgrade):**
The project list must be fetched via a dedicated hook (`useProjects`) that today returns a hardcoded array. When PostgreSQL is added, only this hook changes — no component rewrites needed.

```typescript
// hooks/useProjects.ts — stub implementation
// Replace the return value with a React Query call to GET /api/projects when backend is ready
export function useProjects(): Project[] {
  return MOCK_PROJECTS  // hardcoded array of Project objects
}

interface Project {
  id: string
  project_name: string
  barrier_type: string
  location: string
  created_at: string
  status: 'draft' | 'in_progress' | 'complete'
}
```

> **Upgrade path to full persistence:** (1) Add `GET /api/projects` and `POST /api/projects` endpoints to FastAPI. (2) Replace `useProjects` stub with `useQuery(['projects'], fetchProjects)`. (3) On "New Project", POST to backend to create a project record, then navigate to `/project/:id` with the returned real ID. No component changes required.

**Claude API call routing — prototype decision:**
All Claude API calls in the prototype go **frontend → FastAPI backend → Claude API**. The API key lives server-side in a backend environment variable and is never exposed to the browser. This matches the production architecture and avoids having to rewire later. The FastAPI backend acts as a thin proxy for the extraction call in Step 1 — it receives the document content from the frontend, calls Claude, and returns the extracted parameters. This also means the "Use Mock Data" path bypasses the backend entirely and returns hardcoded values from the frontend, which is fine for demo purposes.

**Step 1 — Project Setup (FUNCTIONAL)**
- File upload (PDF, .docx, .txt) OR paste text area
- "Extract Parameters" button — calls Claude API directly to extract parameters from uploaded document or pasted text
- Right panel shows extracted fields with "Needs confirmation" state
- Fields: Project Name, Location, Barrier Height (m), Barrier Type (dropdown), Foundation Constraint, Scope Note
- "Use Mock Data" button for demo/testing
- "Confirm Extracted Brief" button — saves to ProjectContext, marks step complete

**Step 2 — Site Interpretation (FUNCTIONAL)**
- Site plan image upload (PNG/JPG/PDF)
- Scale calibration: user enters known distance, clicks two points on canvas, system computes px/m ratio
- Barrier digitisation: **multiple independent polylines** supported on a single canvas — barriers do not need to form one continuous alignment
  - Controls: Start Drawing / Stop Drawing / Undo Last Point / Delete Selected / Clear All
  - Each completed polyline (stopped) becomes a named alignment (Alignment 1, Alignment 2, etc.)
  - User can start a new polyline at any time after stopping the current one
- Segment table auto-generated from all drawn polylines using calibrated scale
  - Columns: Alignment (1, 2, 3...), Segment ID (A, B, C... resets per alignment), Length (m), Tag (dropdown: Type 1 / Type 2 / Type 3)
- "Confirm Alignment" button — saves to ProjectContext, marks step complete

**Steps 3–6 — Scaffolds only**
- Each step renders its title, subtitle, and a clear placeholder message
- "Continue" button advances to next step for demo navigation
- Step 6 shows a summary card of all ProjectContext values collected so far
- Step 3 scaffold must include the code selection panel as the first tab — render the checklist UI with pre-selected defaults (see Section 2.3) even though no calculation logic runs yet. This confirms the UI placement before the calculation engine is built.

### What NOT to Build in the First Iteration
- No calculation logic of any kind
- No steel design, foundation design, or wind formula implementation
- No drawing generation
- No PDF report generation
- No BQ/Excel generation
- No user authentication
- No project archival/database (local state only)
- No LangGraph orchestration

### ProjectContext (Zustand Store Shape)

```typescript
interface Polyline {
  id: number                          // Alignment number (1, 2, 3...)
  points: { x: number; y: number }[]  // Canvas coordinates
}

interface SegmentRow {
  alignment_id: number                // Which polyline this segment belongs to
  segment_id: string                  // A, B, C... (resets per alignment)
  length_m: number
  tag: string
}

interface ProjectContext {
  // Step 1
  project_info: {
    project_name: string
    location: string
    barrier_height: number | null
    barrier_type: string
    foundation_constraint: string
    scope_note: string
    step1_confirmed: boolean
  }
  // Step 2
  site_data: {
    site_plan_image: File | null
    calibration: { known_distance: number; px_per_m: number } | null
    polylines: Polyline[]             // Multiple independent alignments
    segment_table: SegmentRow[]       // Flattened rows across all alignments
    step2_confirmed: boolean
  }
}
```

> **Upgrade note:** The `polylines` array maps directly to database rows when PostgreSQL persistence is added. No store restructuring required — the shape is already normalised.

### Code Standards
- Every placeholder or unimplemented calculation must be marked: `// PROVISIONAL: pending SME validation — see PRD Section X.X`
- No hardcoded engineering values (member sizes, grades, spacings, pressures)
- TypeScript strict mode — no `any` types
- Components are small and single-responsibility
- Desktop only — no mobile responsive layout needed

### Folder Structure (suggested)
```
frontend/
  src/
    components/       # Shared UI components (ProjectCard, StatusBadge, etc.)
    pages/            # Top-level route pages (OverviewPage, ProjectPage)
    steps/            # One folder per step (Step1/, Step2/, etc.)
    store/            # Zustand store (projectContext.ts)
    hooks/            # Custom hooks (useProjects.ts, useProjectContext.ts)
    types/            # TypeScript interfaces (Project, ProjectContext, etc.)
    api/              # API call functions (extractParameters, fetchProjects)
  public/

backend/
  app/
    main.py
    routers/
    models/
    services/
    calculation/      # One module per dimension — scaffold only
  pyproject.toml
```
