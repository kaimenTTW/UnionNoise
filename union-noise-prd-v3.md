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

### User Management (confirmed from client meeting, April 2026)

- **No login or authentication required** — free access for all users within the organisation
- **Project attribution is required** — every project record must store:
  - `created_by` — display name or identifier of who created the project
  - `last_modified_by` — display name of who last edited the project
  - `created_at` and `updated_at` timestamps
- Attribution is shown on the Overview page (Projects Library rows and Recent Projects)
- For the prototype stub: `created_by` and `last_modified_by` are free-text fields entered by the user on project creation — no authentication system behind them
- Upgrade path: when user accounts are introduced, these fields are populated automatically from the logged-in session

### Engineering Judgement Override Principle

Certain values in the system are computed from inputs or fixed by code (e.g. shelter factor from Figure 7.20 lookup, basic wind velocity from SG NA). Despite being calculated or standardised, engineers may need to override these based on site-specific judgement or conservative practice.

**Rule:** Any calculated or code-fixed value that involves engineering judgement must support manual override. This applies system-wide. Current known override candidates:

| Field | Default / Calculated value | Override scenario |
|---|---|---|
| Shelter factor ψs | Derived from x/h lookup (Figure 7.20) | PE may use a more conservative value based on site experience |
| Basic wind velocity vb | 20 m/s (SG NA fixed) | Engineer may increase for additional conservatism |
| cp,net | 1.2 (porous panel fixed) | Engineer may use a different zone value for specific conditions |
| Return period | 50 years (default) | Shorter for temporary works |

**UI behaviour for overridable fields:**
- Field shows the calculated/default value pre-populated
- Field is editable — user can type a different value
- If the value differs from the calculated default, an **override badge** appears on the field (e.g. amber border + "Overridden" label)
- A **reason field** appears when an override is active — free text, required before confirming
- The original calculated value is shown as a tooltip or sub-label so the engineer can see what they are departing from

**ProjectContext:** Every overridable field stores both the calculated value and the override:
```typescript
interface OverridableValue {
  calculated: number       // system-computed or code-fixed value
  override: number | null  // null if not overridden
  override_reason: string  // required if override is set
  effective: number        // = override ?? calculated (used in all downstream calculations)
}
```

**PE report behaviour:** If any value was overridden, Section 6 (Design Information) of the PE report must note it explicitly:
```
Basic wind velocity: 25.0 m/s  [Override — SG NA default = 20.0 m/s. Reason: conservative estimate for exposed hilltop site]
```
This ensures the PE is aware of all departures from standard values before signing.

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

**Utilization target ✅ CONFIRMED (PE calculation report):** The governing rule is UR < 1.0 across all checks. There is no mandatory 0.9 lower bound — that was CR208-specific. Individual checks in the PE report range from 0.05 to 0.97. The system must flag UR ≥ 1.0 as a hard failure.

**Optimisation rule:** A section is considered optimised when at least one UR ≥ 0.95 across the three post checks (moment, deflection, shear). The rationale: if one check is at 95% capacity, the section is close to its limit — upsizing would waste material. Having all three simultaneously near 95% is physically unlikely because moment, deflection, and shear govern at different geometries. The engine should flag when a selected section is potentially over-conservative (all URs below 0.60) as a suggestion to re-examine inputs, but this is advisory only — the engineer decides.

**Deflection limit:** The standard allowable deflection is L/n where n is user-configurable. Default n = 65 (confirmed P105). The PE may specify a different limit (e.g. L/200 for sensitive structures). This must be a user input in Step 3 with 65 as the default — it must not be hardcoded.

#### 2.3 Code Clause References

**Decision (confirmed from client meeting, April 2026):** Code selection is **removed as a user-facing step**. All designs must comply with the same set of codes — presenting a checklist implies the engineer could deselect a mandatory code, which is not appropriate. The applicable codes are fixed constants embedded in the calculation engine and cited automatically in the PE report.

**Applicable codes (fixed for all projects — not user-selectable):**

| EN Designation | Eurocode | Governs |
|---|---|---|
| EN 1990:2002 | Eurocode 0 — Basis of Structural Design | Basis of structural design |
| EN 1991-1-1 to 1-7 | Eurocode 1 — Actions on Structures | Actions on structures including wind |
| EN 1992-1-1:2004 to EN 1992-3:2006 | Eurocode 2 — Design of Concrete Structures | Design of concrete structures |
| EN 1993-1-1 to 1-12 (incl. EN 1993-1-8:2005) | Eurocode 3 — Design of Steel Structures | Design of steel structures |
| EN 1997-1:2004 | Eurocode 7 — Geotechnical Design | Foundation design (DA1C1, DA1C2) |
| NA to SS EN 1991-1-4:2009 | Singapore National Annex | SG-specific parameters |

**Implementation:** These are stored as constants in the calculation engine backend. They are cited verbatim in Section 3 of the PE submission report. No UI selection required. The Step 3 code selection panel previously specced is removed.

> **Impact on Step 3:** Step 3 now opens directly on the Design Parameters tab, not a code selection tab. The applicable_codes Zustand slice is replaced by a static constant in the backend — remove it from the frontend store.

#### 2.4 Wind Pressure Calculation ✅ CONFIRMED (P105 PE calculation reports, Lim Han Chong)

**Reference implementation:** P105 Punggol project (PE Lim Han Chong, PE 4382). All values below reproduce confirmed P105 outputs. See `code-reference.md` Section 3 for full clause citations.

**Sources:**
- PE Calc Report, Type 1 12mH above ground footing, PE Lim Han Chong, Mar 2023 (P105 T1) ← primary
- PE Calc Report, Type 1 12mH embedded footing, PE Lim Han Chong, Jun 2023 (P105 T2) ← primary
- PE Calc Report, Type 2A 12.736mH embedded footing, PE Lim Han Chong, Nov 2023 (P105 T2A)

---

**Step 1 — Peak velocity pressure qp (height-dependent, not a fixed constant):**

Uses EC1 Clause 4.3 chain with Singapore National Annex. **qp must be computed dynamically — it is not a fixed value.**

Fixed constants (SG NA):
- Basic wind velocity: vb0 = 20 m/s (NA 2.4)
- Air density: ρ = 1.194 kg/m³ (NA 2.18)
- Terrain category II: z0 = 0.05 m, zmin = 2 m (NA Table NA.1)
- Orography factor: Co(ze) = 1.0 (flat terrain default, EC1 Clause 4.3.4)
- Turbulence factor: kl = 1.0 (NA 2.16)

Project-specific inputs:
- **Structure height ze** — drives cr(z) and Iv(z). Do not hardcode qp.
- **Return period** — user-editable input, default 50 years. Shorter durations (5yr, 10yr) confirmed in practice for temporary works.

EC1 Clause 4.3 computation chain:
```
# Step 0 — Basic wind pressure (named intermediate — shown in PE report Section 5)
qb = 0.5 × ρ × vb²                              [N/m²]   EN 1991-1-4 Eq 4.10
# P105 validation: 0.5 × 1.194 × 20² = 238.80 N/m²
# Note: qb is height-independent — same for all projects in SG

# Step 1 — Peak velocity pressure (height-dependent)
kr = 0.19 × (z0 / 0.05)^0.07 = 0.19        (constant for SG terrain category II)
cr(z) = kr × ln(ze / z0)                     EC1 Clause 4.3.2
vm(z) = cr(z) × Co(z) × vb                  EC1 Clause 4.3.1
Iv(z) = kl / (Co(z) × ln(ze / z0))          EC1 Clause 4.4
qp(ze) = [1 + 7×Iv(z)] × 0.5 × ρ × vm(z)²  [N/m²]
# Note: qp > qb always — terrain roughness and turbulence amplify pressure with height
# P105: qb=238.80 N/m², qp=598.48 N/m² (ratio 2.5× at z=12.7m)
```

Both qb and qp must be returned as named outputs from wind.py and displayed in the Step 3 results panel and PE report Section 5.

Reference outputs for validation (do not hardcode):
| Scenario | ze | qp |
|---|---|---|
| P105 T1/T2 (12.7m) | 12.7m | 598.48 N/m² = 0.598 kPa |
| RM project (6mH, 50yr) | 6m | 0.394 kPa |

---

**Step 2 — Wind pressure coefficient cp,net:**

✅ CONFIRMED for P105: noise barrier panels are treated as **porous**.

```
cp,net = 1.2    (EN 1991-1-4 Table 7.9 — porous free-standing wall)
```

This is the confirmed treatment for TNCB panels in all P105 reports. The zone-based (A/B/C/D) approach from Table 7.9 applies to solid walls and is not used for porous panel barriers in the P105 methodology.

> ⚠️ NOTE: Faber Walk report (Lawson Chung) uses Zone D approach. This is a noted inter-PE difference — does not affect P105 prototype but will need resolution for general use. See `code-reference.md` Section 8.

---

**Step 3 — Shelter factor ψs (derived value — not a user-entered constant):**

ψs is derived from EN 1991-1-4 Section 7.4.2 and Figure 7.20. It must never be entered as a raw number by the user — it is always computed from physical site measurements.

**UI flow:**
- Boolean toggle: "Is there a sheltering structure upwind?" Yes / No
- If **No** → ψs = 1.0 (no reduction applied)
- If **Yes** → additional fields presented:
  - x — spacing from barrier to upwind sheltering structure (m), user enters
  - φ — solidity ratio of upwind structure, dropdown: 0.8 / 0.9 / 1.0
    (φ = 1.0 for solid building wall — most common case)
  - h — taken automatically from barrier height already entered
  - System computes: ratio = x / h
  - System looks up ψs from `backend/app/data/shelter_factor_table.json`
    (digitised EN 1991-1-4 Figure 7.20, interpolated from x/h and φ)
  - ψs field is **pre-populated with the calculated value but remains editable**
  - If the engineer changes the ψs value from the calculated result, the override pattern applies (see Section 2 — Engineering Judgement Override Principle): amber border, override badge, reason field required
  - Both the calculated value and the effective (override) value are stored in ProjectContext

**Restrictions (EN 1991-1-4 Section 7.4.2):**
- φ ≤ 0.8: treat upwind structure as plane lattice — shelter factor method does not apply
- Shelter factor does NOT apply in end zones (within distance h from free end of barrier)

**P105 reference value:** x/h ratio producing ψs = 0.5 at φ = 1.0 (LTA tunnel environment). Used as validation input — feed ψs = 0.5 directly for P105 reproduction run.

**Implementation dependency:** `shelter_factor_table.json` must be digitised from EN 1991-1-4 Figure 7.20 before this module can run on general projects. For P105 validation, ψs = 0.5 is hardcoded as a known input.

---

**Governing design pressure:**

```python
# CONFIRMED — P105 T1/T2 reports
# Step 1: compute qp dynamically from structure_height, return_period
# Step 2: cp,net = 1.2 (porous panel treatment)
# Step 3: ψs derived from x/h lookup (or 1.0 if no shelter)
# design_pressure = qp × cp,net × ψs
#
# P105 validation: 0.598 × 1.2 × 0.5 = 0.36 kPa ✓
```

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
- Deflection limit: **L/n where n is user-configurable, default n = 65** (confirmed P105). Must not be hardcoded — add as a Step 3 input field with 65 as the default value.
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

#### 2.6 Member Selection — No Fixed Inventory

The company does not maintain a fixed parts inventory. They order from various suppliers based on project needs and availability — confirmed April 2026. This means:

- A local parts library as the primary source of truth is the wrong approach
- The system must retrieve section properties from supplier sources at design time
- Continental Steel Singapore (continentalsteel.com.sg) is a confirmed primary source
- Other suppliers are used as needed — the system should not be locked to one source
- `parts_library.json` is retained as a **cache and offline fallback only** — not the primary source

**Member selection workflow — embedded in calculation chain:**

Section selection is **not a separate user action**. It runs automatically as part of the
`POST /api/calculate` chain, triggered by "Run Calculations" in Step 3.

```
Run Calculations triggered
  ↓
1. wind.py: compute design_pressure, M_Ed, V_Ed
  ↓
2. section_retrieval.select_section():
   a. httpx fetches Continental Steel Singapore HTML
   b. Gemini 2.0 Flash extracts UB section properties as JSON
   c. Verify extracted sections against parts_library.json (±2% tolerance)
   d. Sort by mass_kg_per_m ascending
   e. _check_section() on each → first passing (UR_moment, UR_deflection, UR_shear < 1.0)
   f. Return section + selection_source ("live" or "cache")
   — Falls back to parts_library.json on any retrieval/extraction failure
  ↓
3. Section fixed — all downstream uses this section's geometry
  ↓
4. foundation.py: DA1-C1, DA1-C2, SLS, EQU, drained + undrained
5. connection.py: bolt, weld, base plate, G clamp
6. subframe.py: CHS pipe bending check
7. lifting.py: hole shear + hook tension/bond
  ↓
8. All results returned in single response
   selection_source visible in steel derivation panel
```

**Transparency:** The derivation panel for the steel module shows selection provenance:
source (live Continental Steel / local cache), sections retrieved count, verification status,
and why the selected section was chosen (lightest passing all three checks).

**Engineer confirmation:** Step 4 (Design Review) is where the engineer reviews and
accepts the selected members before proceeding to output generation. Overrides are
possible at that step, not during selection.

**Endpoint:** `POST /api/select-section` exists as a standalone endpoint for testing
retrieval in isolation. It is not called from the frontend directly — it is called
internally by `POST /api/calculate` through the retrieval service.

**Future cache architecture (PostgreSQL):**
```
sections_cache table:
  designation       TEXT PRIMARY KEY
  mass_kg_per_m     FLOAT
  h_mm, b_mm, ...   FLOAT  (all section properties)
  last_retrieved_at TIMESTAMP
  source_url        TEXT

On successful retrieval: upsert into sections_cache
On fetch failure: query sections_cache before parts_library.json
```

Section geometry (Iy, Wpl etc.) is a physical constant — safe to cache permanently.
Availability and pricing are transient — always fetch fresh, never cache.

**Fixed standard components (not retrieved from supplier):**

From Rowena's confirmed drawings (April 2026):
- Subframe: CHS Ø48.3×2.4mm GI pipe — fixed spec, not ordered per project
- Noise barrier panels: 500×2000×33mm — fixed Hebei Jinbiao product
- Panel guides: proprietary double channel — fixed spec
- Non-shrink grout: Quickseal NSG 55 MPa, 50mm thickness — fixed spec
- Temperature bars and bar chair: require calculation per project

**Bolt layout geometry (fixed standard — confirmed from drawings):**
- Edge distance from bolt centre to plate edge: 50 mm
- Distance from bolt centre to beam flange face: 50 mm
- Ds (lever arm) is fully determined by these fixed dimensions plus the base plate height
- No user input required for bolt positions — they are derived

---

**Data file roles — current state and evolution path:**

The system uses two JSON data files whose purpose has evolved as the project understanding has developed. Both are documented here explicitly.

**`parts_library.json` — UB section properties cache**

Contains 107 universal beam sections with full section properties (Iy, Iz, Iw, It, Wpl, Wel, h, b, tf, tw, r, mass). These are industry-standard physical constants — not Union Noise's inventory. Any steel supplier stocks these sections and the properties never change between suppliers.

Current role: offline fallback cache — used when Gemini retrieval fails for any reason.
Primary source: Gemini 2.0 Flash extraction from Continental Steel Singapore (implemented v0.12.0).
The retrieval service always attempts live fetch first and falls back to this file on failure.
Section geometry (Iy, Wpl etc.) is a physical constant — safe to cache permanently.
Availability and pricing are transient — always fetch fresh, never cache pricing.

**`connection_library.json` — standard practice reference (prototype only)**

Contains three base plate and bolt configurations derived from Rowena's P105 drawings. These are not a catalogue — they represent past practice on specific projects.

Current role (prototype): lookup table for the Session 2 connection checks. Used to provide working validation numbers against P105 and avoid placeholder values during development.
Future role: to be refactored into a **standard practice constants file** storing fixed geometric rules (edge distance = 50mm, standard embedment = 400mm, weld size rules) rather than specific project configurations. Base plate dimensions, bolt count, and Ds will become calculation outputs derived from M_Ed, V_Ed, and the selected section geometry — not looked up from this file.
When to refactor: P105 T2 validation is complete (v0.10.4). Refactor in a future session
after the prototype is demonstrated to the client and PE. Do not refactor during active
prototype development — the current configs are still needed for consistent calculation output.

**In summary:**
- Neither file is a permanent inventory or catalogue
- `parts_library.json` stays as-is indefinitely as a fallback cache
- `connection_library.json` is a temporary prototype scaffold — refactor after client demo

#### 2.7 Structural Acceptance Gate ✅ CONFIRMED (PE calculation report)

An aggregation view combining results from all calculations:
- Each structural element reports its utilization ratio
- **UR < 1.0 is the only hard requirement** — confirmed from PE report across all checks
- UR ≥ 1.0 → hard failure, user must resolve before proceeding
- No mandatory lower bound — do not enforce a minimum UR
- Clear indication of which specific check(s) failed and why
- Users can iterate on parameters and re-run until all checks pass
- The gate produces the data needed for Section 4 of the Design Report (utilization ratios summary)

#### 2.7.1 Derivation Panel

Every calculation result group (wind, steel, foundation) must include a **collapsible derivation panel** showing the full step-by-step calculation with all intermediate values and their formula references. This provides assurance to the engineer and the PE that the system is computing correctly.

**Purpose:** Engineers need to see how results were derived, not just what they are. This mirrors the PE report format where every intermediate value is shown explicitly.

**UI pattern:** Collapsible section below each result group. Collapsed by default, expandable on click. Label: "Show derivation" / "Hide derivation".

**Content per group:**

Wind derivation example:
```
Basic wind velocity       vb = 20.0 m/s              (SG NA 2.4)
Directional factor        cdir = 1.0                  (confirmed)
Season factor             cseason = 1.0               (confirmed)
Basic wind pressure       qb = ½ρvb² = 238.80 N/m²   (EC1 Eq 4.10)
Roughness factor          cr = 0.19 × ln(12.7/0.05)  = 1.052   (EC1 Cl 4.3.2)
Mean velocity             vm = 1.052 × 1.0 × 20.0    = 21.04 m/s (EC1 Cl 4.3.1)
Turbulence intensity      Iv = 1.0 / ln(12.7/0.05)   = 0.181   (EC1 Cl 4.4)
Peak velocity pressure    qp = [1+7×0.181]×½×1.194×21.04² = 598.5 N/m²
Pressure coefficient      cp,net = 1.2               (Table 7.9, porous panel)
Shelter factor            ψs = 0.5                   (Fig 7.20, x/h=8.71, φ=1.0)
Design pressure           q = 598.5 × 1.2 × 0.5     = 359.1 N/m² ≈ 0.36 kPa
```

Steel derivation example:
```
Design UDL                w = 0.36 × 3.0             = 1.08 kN/m
Post moment ULS           M_Ed = 1.5×1.08×12.7²/2   = 130.31 kNm  (EC3)
Post shear ULS            V_Ed = 1.5×1.08×12.7       = 20.52 kN
Selected section          UB406×140×39               (lightest passing section)
Plastic moment capacity   Mpl = 724×10³×275/1×10⁶   = 199.1 kNm
Elastic critical moment   Mcr = ...                  = 180.92 kNm  (EC3 Cl 6.3.2)
LTB slenderness           λ̄LT = √(199.1/180.92)     = 1.049
Reduction factor          χLT = 0.67                 (EC3 Cl 6.3.2.3)
Buckling resistance       Mb,Rd = 0.67×199.1         = 133.4 kNm
Utilization ratio         UR = 130.31/133.4          = 0.977 < 1.0 ✓
```

**Implementation note:** No backend changes required. The calculation engine already returns all intermediate values in the API response dict. The derivation panel is a pure frontend component (`DerivationPanel`) that formats the existing response data into readable steps. Each step shows: label, formula expression, substituted values, result, and clause reference where applicable.

**Overridden values** in the derivation panel must be visually marked (amber colour or override badge) so the engineer can immediately see which inputs departed from calculated defaults.

**Checks confirmed from PE report (all must pass):**
- Moment (torsional buckling) — ULS
- Deflection — SLS
- Bolt tension
- Bolt combined (shear + tension)
- Bolt bearing
- Plate bending
- Secondary plate
- Weld (governing check)
- Rod bond (bolt embedment)
- Lifting hook tension
- Lifting hook pullout
- Lifting hole shear (edge distance)
- Subframe bending
- G clamp capacity (factored wind force per clamp vs tested failure load — P105 confirmed)
- Foundation sliding (SLS, DA1C1, DA1C2)
- Foundation overturning (SLS, DA1C1, DA1C2)
- Concrete bearing
- Base plate bearing (compression resistance)

> **G clamp check note:** Uses failure load from Singapore Test Services test report (STS Report 10784-0714-02391-8-MEME, Aug 2014). Failure load = 23.29 kN for Fixed Beam Clamp 48.6. This is a proprietary Hebei Jinbiao component check — the test report value must be stored in the parts library, not hardcoded.

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
Allowable:          δ_allow = L / n                                        [mm]
                    n = user input, default 65 (confirmed P105)
                    n must NOT be hardcoded — it is a Step 3 input field
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
  φk = 30° (confirmed in P105)
  γs = 19 kN/m³ (confirmed in P105)
  c'k = 5 kN/m² (confirmed in P105 — note: earlier reports show c'k=0, site-specific)
  Nγ = 1.5 × (Nq-1) × tanφ  (P105 T1/T2 confirmed — see code-reference.md Section 8 for alternative)
  # PROVISIONAL: soil parameters are site-specific — user must confirm per project
```

---

**G Clamp Check (✅ confirmed — P105 T1/T2)**
```
Total wind force:   F_wind = design_pressure_external × barrier_height × post_spacing
                    Note: uses external wind pressure (0.45 kPa in P105), not
                    design_pressure after shelter factor reduction
Factored load:      F_factored = F_wind × 1.5
Load per clamp:     F_clamp = F_factored / n_clamps_per_post
Check:              F_clamp < failure_load_from_test_report
                    failure_load = 23.29 kN (STS test report, Fixed Beam Clamp 48.6)
                    stored in parts library — not hardcoded
# PROVISIONAL: confirm whether shelter factor applies to external pressure for clamp check
```

**Lifting Hook (✅ confirmed — P105)**
```
Factored weight:    W_factored = W_footing × 1.5
Load per hook:      F_hook = W_factored / n_hooks
Rebar hook (H20 high yield bar, fub = 500 N/mm²):
  Tension:          FT,Rd = k2 × fub × As / γM2    k2=0.9, γM2=1.25
  Shear:            Fr = αv × As × fub / γM2
Anchorage length:   L_required = F_hook / (fbd × π × D)
                    fbd = 2.25 × η1 × η2 × fctd    (EC2 Clause 3.1.6)
```

**Lifting Hole (✅ confirmed)**
```
Shear area:         A_v = edge_distance × web_thickness
Shear strength:     V_Rd = A_v × (f_y / sqrt(3))
Factored load:      F = post_weight × 1.5
UR:                 F / V_Rd < 1.0
```

**Subframe Check (✅ confirmed — P105)**
```
Section:            CHS 48.3×2.2 GI pipe, fy = 400 N/mm² (galvanised steel)
Section class:      Class 2 — use elastic modulus Wel, not plastic Wpl

Factored moment:    M_Ed = (1.5/10) × w × L_subframe²              [kNm]
                    (continuous beam assumption — confirmed P105 T1/T2)
                    # NOTE: /12 seen in Faber Walk report (fixed-end assumption)
                    # P105 uses /10 — use this for prototype
                    # PROVISIONAL: confirm end condition with PE for general use

Wind UDL on subframe: w = design_pressure × subframe_spacing        [kN/m]
Section modulus:    Z = Wel (from section table) or π×d³/32 (approx)
Stress:             σ = M_Ed / Z
UR:                 σ / f_y < 1.0
```

> **Note for Claude Code:** P105 is the reference implementation. Validation targets: feed P105 T1 inputs → reproduce M_Ed=97.76 kNm, UB356×127×33, Mb,Rd=112.90 kNm. Feed P105 T2 inputs → reproduce M_Ed=130.31 kNm, UB406×140×39, Mb,Rd=133.33 kNm. All P105 constants are confirmed — no placeholders needed for these modules. For shelter factor, feed ψs=0.5 directly for validation run; full x/h lookup required for general use. See `code-reference.md` for full clause citations and section properties.



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

  # --- Code references (fixed constants — not user-selectable) ---
  # See Section 2.3. Codes are embedded in the calculation engine and
  # cited automatically in the PE report. No user input required.
  applicable_codes:
    wind_code: str       # "EN 1991-1-4 + NA to SS EN 1991-1-4:2009"  (constant)
    steel_code: str      # "EN 1993-1-1, EN 1993-1-8"                  (constant)
    concrete_code: str   # "EN 1992-1-1"                               (constant)
    geotechnical_code: str  # "EN 1997-1"                              (constant)
    basis_of_design: str    # "EN 1990:2002"                           (constant)

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

**Route:** `/` — default landing page

**Three primary actions (rendered as prominent buttons):**

1. **New Project** — navigates to `/project/new`, initialises a fresh ProjectContext with a generated stub ID

2. **Old Projects** — expands or navigates to a row-list view of past projects
   - Each row shows: Project Name, Barrier Type, Location, Date, Status badge
   - Clicking a row loads that project into the 6-step workflow with all fields pre-filled from the saved state
   - Projects are editable — the user can modify any step and re-confirm
   - Edit behaviour (overwrite vs new revision) is a **deferred decision** — for the stub, editing overwrites the existing project record. Flag with `// TODO: revision vs overwrite decision pending — see PRD Section 13`
   - Upgrade path: clicking a row calls `GET /api/projects/:id`, hydrates ProjectContext, navigates to `/project/:id`

3. **Master Data** — navigates to `/master-data`
   - Upload interface for the parts/member library (CSV or Excel)
   - Stub only — shows an upload area with a placeholder message: "Upload member library (CSV/Excel) — coming soon"
   - Connects to Section 2.6 (Pre-Approved Parts Library) when implemented
   - Upgrade path: upload posts to `POST /api/master-data`, backend parses and stores in PostgreSQL parts library table

**Recent Projects section** — displayed below the three action buttons
- Shows the same row list as Old Projects but limited to the 5 most recently modified
- Stub: same hardcoded MOCK_PROJECTS data, filtered/sorted by date

**Data layer requirement (critical for future upgrade):**
The project list must be fetched via a dedicated hook (`useProjects`) that today returns a hardcoded array. When PostgreSQL is added, only this hook changes — no component rewrites needed.

```typescript
// hooks/useProjects.ts — stub implementation
// Replace return value with React Query call to GET /api/projects when backend is ready
export function useProjects(): Project[] {
  return MOCK_PROJECTS
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

> **Upgrade path to full persistence:**
> - New Project: POST `/api/projects` → get real ID → navigate to `/project/:id`
> - Old Projects list: replace `useProjects` stub with `useQuery(['projects'], fetchProjects)`
> - Load project: GET `/api/projects/:id` → hydrate ProjectContext → navigate to step last visited
> - Master Data upload: POST `/api/master-data` with file → parse → store in parts library table
> No component rewrites required for any of the above — only hook and API layer changes.

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

**Canvas — barrier digitisation:**
- Multiple independent polylines supported — barriers do not need to form one continuous alignment
- Controls: Start Drawing / Stop Drawing / Undo Last Point / Delete Selected / Clear All
- Each completed polyline becomes a named alignment (Alignment 1, Alignment 2, etc.)
- User can start a new polyline at any time after stopping the current one
- **Canvas highlighting:** when the user selects an alignment from the alignment tab panel, the corresponding polyline on the canvas highlights (distinct colour or weight). Clicking a polyline on the canvas selects the corresponding tab. Selection is bidirectional.

**Alignment tab panel (right side or below canvas):**
- One tab per alignment (Alignment 1, Alignment 2, etc.)
- Each tab shows the segment table for that alignment only
  - Columns: Segment ID (A, B, C...), Length (m), Tag (dropdown: Type 1 / Type 2 / Type 3)
- Adding a new alignment automatically adds a new tab
- Active tab corresponds to the highlighted polyline on canvas

**Segment table is per-alignment (not a single combined table)** — confirmed from client feedback that a single combined table across all alignments is confusing.

- "Confirm Alignment" button — saves all polylines and all segment tables to ProjectContext, marks step complete

**Step 3 — Design Parameters + Calculations (FUNCTIONAL)**

Full design parameters form across four groups: Wind, Post, Foundation, Soil Parameters.
All fields bound to Zustand store with OverridableValue pattern for vb and ψs.

Calculation chain runs on "Run Calculations" button:
```
wind → section selection (Gemini/cache) → steel checks →
foundation (drained + undrained) → connection → subframe → lifting
```

Section selection is embedded in the chain — it is NOT a separate user action.
After wind computes M_Ed, the backend calls the section retrieval service:
  1. Gemini 2.0 Flash queries Continental Steel Singapore for UB sections
  2. Lightest section passing all three checks (moment, deflection, shear) is selected
  3. Falls back to parts_library.json if live retrieval fails
  4. selection_source returned in response ("live" or "cache")

All results displayed in collapsible panels with DerivationPanel for each module:
  - Wind: qp, design pressure, shelter factor chain
  - Steel: section designation, LTB chain, all URs, selection source
  - Foundation: SLS/DA1-C1/DA1-C2 table, drained + undrained bearing
  - Connection: 7-check table (bolt tension, shear, combined, embedment, weld, base plate, G clamp)
  - Subframe: section, M_Ed, Mc,Rd, UR
  - Lifting: hole shear + hook tension/bond sub-sections
  - Overall pass/fail banner across all modules

Step 3 opens directly on Design Parameters tab — no code selection tab.
Applicable codes are fixed constants in the backend (see Section 2.3).

**Step 4 — Design Review / Acceptance Gate (TO BUILD)**

Engineer reviews all selected members and utilisation ratios before proceeding to outputs.
This is a deliberate checkpoint — the engineer confirms the design is acceptable.

Content:
  - Member summary table: all selected sections with UR per check
  - Source attribution per member (live retrieval / cache / PE confirmed)
  - Pass/fail status per module
  - Override panel: engineer can flag any member for manual review
  - "Proceed to Outputs" button — only enabled when all checks pass
  - "Back to Step 3" — returns to parameters for adjustment

This step exists because the engineer should knowingly approve all member selections
before a PE-endorsable report is generated. It mirrors the PE's own review process.

**Step 5 — Drawing Generation (BLOCKED)**

DXF drawing generation using ezdxf.
BLOCKED — pending drawing samples from Rowena.
Standard drawing format: plan view, elevation, section details, bolt setting template.

**Step 6 — Output Generation (TO BUILD)**

Two outputs:
  1. PDF Calculation Report — ReportLab, 8-section PE format matching P105 T2 structure.
     Sections: project info, wind analysis, steel design, connection, subframe, lifting,
     foundation, summary utilisation ratios. All override reasons shown explicitly.
     Download button → triggers POST /api/report/generate.

  2. Bill of Quantities (BQ) — Excel via openpyxl.
     BLOCKED — pending BQ format samples from Rowena.

### What NOT to Build in the First Iteration
- No LangGraph orchestration (direct API calls used throughout)
- No user authentication (free-text name only)
- No project database persistence (session state only — PostgreSQL deferred)
- No long span configurations (Phase 2)
- No soldier pile foundation (Phase 2)
- No permanent project evaluation (Phase 2)

### ProjectContext (Zustand Store Shape)

```typescript
// Overridable field — stores both calculated default and any engineer override
// See Section 2 — Engineering Judgement Override Principle
interface OverridableValue {
  calculated: number        // system-computed or code-fixed value
  override: number | null   // null if not overridden
  override_reason: string   // required if override is set, empty string otherwise
  effective: number         // = override ?? calculated — used in all downstream calculations
}

interface Polyline {
  id: number
  points: { x: number; y: number }[]
  is_active: boolean
}

interface SegmentRow {
  alignment_id: number
  segment_id: string
  length_m: number
  tag: string
}

interface ProjectContext {
  // Project metadata
  meta: {
    id: string
    created_by: string
    last_modified_by: string
    created_at: string
    updated_at: string
  }
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
    polylines: Polyline[]
    active_alignment_id: number | null
    segment_table: SegmentRow[]
    step2_confirmed: boolean
  }
  // Step 3 — design parameters (overridable fields use OverridableValue)
  design_parameters: {
    vb: OverridableValue              // Basic wind velocity — calculated=20.0, overridable
    return_period: number             // years — user selects, default 50
    shelter_present: boolean
    shelter_x_m: number | null
    shelter_phi: number | null
    shelter_factor: OverridableValue  // ψs — calculated from Figure 7.20, overridable
    post_spacing_m: number
    subframe_spacing_m: number
    post_length_m: number
    footing_type: string
    footing_B_m: number
    footing_L_m: number
    footing_D_m: number
    phi_k_deg: number
    gamma_s: number
    c_prime: number
  }
  // Step 3 — calculation results
  calculation_results: {
    wind: object | null
    steel: object | null
    foundation: object | null
    all_checks_pass: boolean
  }
}
```

> **Note on applicable_codes:** Removed — codes are fixed backend constants, see Section 2.3.

> **Upgrade note:** `polylines` and `design_parameters` map directly to database columns when PostgreSQL is added.

> **Upgrade note:** The `meta` fields map directly to database columns when PostgreSQL persistence is added. The `polylines` array maps to a polylines table. No store restructuring required.

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