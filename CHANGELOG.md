# CHANGELOG

## [0.10.3] — 2026-04-16

### Fixed
- `connection_library.json`: T1_M24_6bolt updated with all values confirmed from P105 T2 drawing D-P105-TNCB-3002: plate 350×600×25mm, 3col × 2row bolt layout, n_tension=3, embedment=650mm. `length_mm` renamed to `height_mm` across all configs for consistency.
- `connection.py`: FT_Rd now uses nominal shank area (π/4 × d²) per confirmed P105 T2 PE methodology. Resolves FT_Rd discrepancy (203 kN → 260.58 kN ✓).
- `connection.py`: Ds derived as `plate_height_mm / 2` — PE simplified base plate method confirmed from drawing. `Ds_mm` removed from all configs (derived, not stored).
- `calculate.py` + `Step3.tsx` + `types` + `store`: `fck` field added to request (default 25). P105 T2 uses fck=28 (C28/35) per material schedule. Passed to `compute_connection` and `compute_lifting`. UI field added to Foundation group.

### Validation — P105 T2 connection checks fully validated (D-P105-TNCB-3002)
- `Ft_per_bolt = 96.53 kN` ✓ (target: 96.53)
- `FT_Rd = 260.58 kN` ✓ (target: 260.58)
- `UR_bolt_tension = 0.370` ✓ (target: 0.370)
- `UR_embedment = 0.678` ✓ (target: 0.678, L_req=440.8 mm < 650 mm provided)
- All other checks pass: shear UR=0.025, combined UR=0.290, weld UR=0.791, base plate UR=0.009, g_clamp UR=0.552
- `all_checks_pass = True`

### Notes
- T1_M20_6bolt and T2_M20_4bolt remain unvalidated against PE report — pending equivalent drawing review
- Ds = plate_height/2 is PE simplified method. More rigorous approach (bolt row to row spacing) gives larger Ds and lower Ft — simplified method is conservative on the demand side
- FT_Rd nominal area is a documented PE methodology difference vs EC3-1-8 Table 3.4 (threaded area). Both approaches noted in return dict `FT_Rd_note`

---

## [0.11.0] — 2026-04-16

### Added
- `backend/app/calculation/subframe.py` — CHS 48.3×2.4mm GI pipe bending check. ULS moment formula M_Ed = (1.5/10) × w × L² (continuous beam /10, confirmed P105). Class 2 section, elastic Wel. UR_subframe = 0.480 at P105 T2 inputs (pass).
- `backend/app/calculation/lifting.py` — H20 rebar hook tension (EC3-1-8 Cl 3.6.1) + bond length (EC2 Cl 8.4.2) + post web shear at lifting hole. 2 hooks per footing (P105 confirmed). Default embedment 450 mm, hole diameter 35 mm, edge distance 50 mm.
- Both modules wired into `POST /api/calculate` — `subframe` and `lifting` fields added to `CalculateResponse`. `SubframeResult` and `LiftingResult` Pydantic models added to `calculate.py`.

### Notes
- Subframe /10 vs /12: /10 confirmed P105. Faber Walk uses /12 (fixed-end assumption). Pending PE confirmation for general use — /10 used here.
- Lifting hole `edge_distance_mm = 50` assumed standard. Confirm with Rowena actual drilled hole position in post web.
- Hook embedment default 450 mm matches P105 material schedule. Confirm per project.
- P105 T2 sample results: hook tension UR=0.199, hook bond UR=0.296, hole shear UR=0.443 — all pass.

---

## [0.10.2] — 2026-04-16

### Changed
- `connection_library.json`: added `_source_note` to all three configs — clarifies these are Rowena's standard reference drawings (April 2026), not confirmed to match any specific PE report plate layout. Ds_mm and embedment_mm require PE verification before submission.
- `connection.py`: module docstring updated — P105 bolt tension validation targets removed. Formula is correct per EC3-1-8 Cl 3.6.1; P105 plate config (Ds, n_tension) is unconfirmed so no comparison applies.
- `connection.py`: `validation_note` field added to `bolt_tension` return dict stating P105 target not used. `M_SLS_kNm` precision tightened to 2 d.p.
- `connection.py` `__main__`: P105 expected-value annotations removed from sample run output.

### Notes — Current connection check results (M_Ed=130.32 kNm, V_Ed=20.52 kN, T1_M24_6bolt)
- `UR_bolt_tension = 0.712` — formula correct per EC3-1-8; Ds=300 mm from reference drawing
- `UR_bolt_shear = 0.025`, `UR_bolt_combined = 0.534`, `UR_weld = 0.791`, `UR_base_plate = 0.009`, `UR_gclamp = 0.552` — all pass
- `UR_bolt_embedment = 1.097` — marginal fail (L_required=713 mm, L_provided=650 mm). Pending PE clarification on embedment or config update.

---

## [0.10.1] — 2026-04-15

### Fixed
- `connection.py`: bolt tension check now uses SLS (unfactored) moment — `M_SLS = M_Ed / 1.5` — matching P105 methodology. `M_SLS_kNm` added to `bolt_tension` return dict.
- `connection.py` + `constants.py`: all bolt checks now use threaded (net) stress area per ISO 898-1 / EC3-1-8. `BOLT_STRESS_AREA` dict added to `constants.py` (M16=157, M20=245, M24=353, M30=561 mm²). Gross area used as fallback for unlisted sizes.

### Notes — P105 T2 post-fix validation
- `UR_bolt_tension = 0.712` (improved from 0.834). Remaining gap to PE target 0.37 is Ds: config=300 mm, P105 layout~450 mm — pending PE drawing confirmation.
- `UR_bolt_embedment = 1.097` (improved from 1.646). Still marginal fail — L_required=713 mm vs L_provided=650 mm. Pending PE clarification.
- All other checks pass.

---

## [0.10.0] — 2026-04-15

### Added
- `backend/app/calculation/connection.py` — full connection checks per EC3-1-8 + EC2:
  - Check 1: Bolt tension (EC3 Cl 3.6.1) — T_total = M_Ed/Ds, Ft per bolt, FT_Rd
  - Check 2: Bolt shear (EC3 Cl 3.6.1) — Fv per bolt, Fv_Rd (αv=0.6)
  - Check 3: Combined bolt (EC3 Table 3.4) — interaction check ≤ 1.0
  - Check 4: Bolt embedment/bond length (EC2 Cl 8.4.2) — fbd, L_required vs L_provided
  - Check 5: Weld (MoI method, P105 approach) — weld group second moment, resultant demand vs Fw,Rd
  - Check 6: Base plate bearing (EC3 Annex I / T-stub) — effective bearing area, compression resistance
  - Check 7: G clamp (STS test-based) — F_factored / failure_load; uses external pressure (qp × cp_net, pre-shelter)
- Connection config auto-selected from section designation; configs loaded from `connection_library.json`
- Connection wired into `POST /api/calculate` — runs after steel, result included in response as `connection` field (null if steel fails)
- External pressure for G clamp derived as `qp_kPa × cp_net` in `calculate.py`
- Section geometry (`h_mm`, `b_mm`, `tf_mm`, `tw_mm`, `r_mm`) added to steel module return dict and `SteelResult` Pydantic model

### Notes — P105 T2 Validation (M_Ed=130.32 kNm, V_Ed=20.52 kN, UB406×140×39, T1_M24_6bolt)
- `FT_Rd = 203.33 kN` — reduced from 260.58 kN after threaded area fix (As=353 mm² vs gross 452 mm²). PE target of 260.58 was computed with gross area.
- `Ft_per_bolt = 144.80 kN`, `UR_bolt_tension = 0.712` — improved from 0.834 (M_SLS fix). Remaining gap to PE target of 96.53 kN / UR=0.37 is due to Ds: config has Ds=300 mm; P105 bolt layout uses ~450 mm arm. Pending Ds confirmation from PE drawings.
- `UR_bolt_embedment = 1.097` — improved from 1.646 (threaded area fix). Still marginally fails: L_required=713 mm > L_provided=650 mm. Requires PE clarification on embedment adequacy or config update.
- `weld_length = 1045 mm` vs P105 target ~1360 mm — discrepancy noted in response `weld_length_note`. P105 likely includes stiffener plate welds.
- All other checks pass (bolt_shear UR=0.025, bolt_combined UR=0.534, base_plate UR=0.009, g_clamp UR=0.552)

---

## [0.9.4] — 2026-04-15

### Fixed
- `steel.py`: sort key changed from `Wpl_y_cm3` to `mass_kg_per_m` — selects lightest section by weight, matching PE methodology. Resolves T1/T2 section mismatch vs PE report.

### Added
- `steel.py`: `deflection_limit_n` parameter (default 65) replaces hardcoded `L/65`. Passed from frontend through `calculate.py`. Returned in response dict.
- `wind.py`: `return_period` parameter + Cprob formula (EC1 Eq 4.2, K=0.2, n=0.5 SG NA confirmed). `return_period=50` → `Cprob=1.0` (no change to existing results). `return_period` and `Cprob` returned in response dict.
- `calculate.py`: `return_period` and `deflection_limit_n` added to `CalculateRequest`; `return_period`/`Cprob` added to `WindResult`; `deflection_limit_n` added to `SteelResult`.
- Step 3: `return_period` now sent in POST body (was captured in Zustand but not transmitted).
- Step 3: `deflection_limit_n` field added to Post group (default 65, range 20–500).
- Step 3: Footing weight helper hint below Self-weight G field — estimates concrete-only weight from B×L×D×25 kN/m³ when all three footing dimensions are filled; prompts engineer to add post self-weight.
- `DesignParameters`: `deflection_limit_n: number` added to interface and store default.
- `WindCalcResult`: `return_period?` and `Cprob?` optional fields added.
- `SteelCalcResult`: `deflection_limit_n?` optional field added.

### Notes
- P105 validation confirmed after sort key fix: T1 → `356×127×33` ✓, T2 → `406×140×39` ✓ (PE expected sections)
- `Cprob` at 50yr = 1.0 — no change to any existing project results
- `return_period=50` is the default; changing to 10yr or 5yr reduces `vb_effective` and thus `design_pressure_kPa`

---

## [0.9.3] — 2026-04-15

### Added
- `vb` override now wired end-to-end: frontend sends `dp.vb.effective` only when overridden (omitted otherwise so backend defaults to SG NA 20 m/s)
- `compute_qp()` and `compute_design_pressure()` accept optional `vb` parameter — overrides `SG_NA["vb0"]` throughout the full wind chain (vm, qp, qb all recomputed with override vb)
- `CalculateRequest` extended with optional `vb: float | None` field

---

## [0.9.2] — 2026-04-14

### Changed
- Mock project `created_by` names updated to Rowena, Ryan, Conrad (replacing placeholder names)
- "Date" column renamed to "Created" on both Overview and Projects Library pages
- "Last edited" column added to Overview recent projects table and Projects Library table, displaying `updated_at` formatted as `d MMM yyyy`
- Step 2 canvas: unselected alignment line colour changed from blue (`#3b82f6`) to grey (`#6b7280`); selected remains orange

---

## [0.9.1] — 2026-04-11

### Fixed
- Shelter factor ψs now interpolated from EN 1991-1-4 Figure 7.20 in real time — the `0.5` stub was replaced with live table lookup using `shelter_factor_table.json` data (already digitised). Result updates whenever x, φ, or structure height changes without needing to re-run calculations.
- Solidity ratio φ dropdown now only offers `0.8` (porous) and `1.0` (solid) — removed `0.9` which has no curve in Figure 7.20. Per table notes: φ < 0.8 not covered; use ψs = 1.0.
- `handleRunCalculations` now reads the live computed ψs directly instead of the potentially-stale store field, eliminating a subtle sync-lag bug when x/φ were changed immediately before pressing Run.

### Changed
- Shelter_present toggle now shows "Enter x and φ to calculate ψs" hint when inputs are incomplete (instead of the old "ψs = 0.5 stub" warning, which implied a permanent limitation rather than an incomplete-input state)
- OverridableField for ψs shows `x/h = {value}, φ = {value}` as the hint once both inputs are filled, so the engineer can cross-check the lookup ratio

---

## [0.9.0] — 2026-04-11

### Added
- `OverridableValue` interface (`types/index.ts`) — stores `calculated`, `override`, `override_reason`, and `effective` (= override ?? calculated) per PRD §2 Engineering Judgement Override Principle
- `OverridableField` component (Step3.tsx) — number input pre-populated with `calculated`; amber border + "Overridden" badge when value differs from default; free-text reason field appears on override (required for PE report note)
- **vb override**: basic wind velocity field added to the Wind group in Step 3 form, pre-populated at 20.0 m/s (SG NA fixed). Override stored in `dp.vb`; wired to backend pending `vb` parameter addition to `/api/calculate`
- **shelter_factor override**: ψs now stored as `OverridableValue`. `calculated` is reset to 0.5/1.0 when shelter_present toggles; user can override for site-specific conservatism. `dp.shelter_factor.effective` sent to backend (replaces old hardcoded local variable)
- `DerivationPanel` component (Step3.tsx) — collapsible section below each result group; collapsed by default; "Show derivation / Hide derivation" toggle; formats API response into labelled rows: `label | formula | result | clause`
- Wind derivation: vb → cdir → cseason → qb → cr → vm → Iv → qp → cp,net → ψs → design pressure. Overridden inputs shown in amber with `[Override]` marker
- Steel derivation: w → M_Ed/V_Ed → selected section → Mpl → Mcr → λ̄LT → χLT → Mb,Rd → UR_moment → δ/δallow → UR_deflection → Vc,Rd → UR_shear
- Foundation derivation (DA1-C1): factored H/M → sliding resistance → sliding FOS → overturning M_Rd → overturning FOS → bearing capacity → bearing UR
- `WindCalcResult` extended with `vb_m_per_s?`, `cdir?`, `cseason?`, `qb_N_per_m2?`, `qb_kPa?` (optional — present in responses from backend v0.8.0+)
- `SteelCalcResult` extended with `w_kN_per_m?`, `Mpl_kNm?`, `Mcr_kNm?`, `lambda_bar_LT?`, `phi_LT?`, `chi_LT?`, `Av_mm2?`, `Vc_kN?`, `UR_shear?`, `post_length_m?`
- `FoundationComboResult` extended with `phi_d_deg?` (top-level) and additional bearing sub-fields: `e_m?`, `b_prime_m?`, `B_prime_m?`, `Nq?`, `Nc?`, `Ny?`, `sq?`, `sc?`, `sy?`

### Changed
- `DesignParameters.basic_wind_speed: number` → `vb: OverridableValue` (calculated=20.0)
- `DesignParameters.shelter_factor: number` → `shelter_factor: OverridableValue` (calculated=1.0 or 0.5 per shelter_present)
- `projectStore.ts`: `defaultDesignParameters` updated accordingly; added `defaultOverridable()` helper
- Shelter toggle in Step 3 now calls `handleShelterPresent()` which resets `shelter_factor.calculated` and clears any existing override

### Notes
- vb override is stored in Zustand but not yet sent to the backend (backend hardcodes 20 m/s from SG NA constants). A `TODO` comment marks the wire-up point. Backend change deferred.
- Derivation rows are built from the existing API response — no backend changes required
- Override reason is free-text with no validation gate — the PE report generation layer (Step 6, future) will surface it in Section 6 (Design Information)

---

## [0.8.0] — 2026-04-11

### Fixed
- `foundation.py`: overturning resisting moment now applies γG,stb = 0.9 to the stabilising permanent load per EC7 EQU — `M_Rd = P_G × γG,stb × (B/2)`. Previously γG,stb was missing (equivalent to 1.0), over-stating resistance. Confirmed against P105 practice.
- `foundation.py`: renamed all internal `footing_W_m` / `W_m` parameters to `footing_L_m` / `L_m` throughout (`_bearing_capacity_drained`, `_run_combination`, `compute_foundation`) to match EC7 Annex D notation (L = dimension perpendicular to wind). API request field `footing_W` unchanged; mapping in `calculate.py` updated to `footing_L_m`.
- `steel.py`: added EC3 Clause 6.2.6 shear capacity check — `Av = A − 2bt_f + (t_w + 2r)t_f`; `Vc,Rd = Av × (fy/√3) / γM0`. Section selection now requires UR_moment < 1.0 AND UR_deflection < 1.0 AND UR_shear < 1.0. Shear does not govern for P105 geometry (UR_shear ≈ 0.05).

### Added
- `wind.py`: `compute_design_pressure()` now returns `vb_m_per_s`, `cdir`, `cseason`, `qb_N_per_m2`, `qb_kPa` — basic wind pressure qb = ½ρvb² = 238.80 N/m² per SG NA. Required by the calculate router response model.
- `foundation.py`: `_run_combination()` return dict now includes `phi_d_deg` (design friction angle) and `b_prime_m` (effective footing width after eccentricity reduction). Required by the foundation results panel in Step 3.
- `calculate.py`: `WindResult`, `SteelResult` Pydantic response models updated with the new fields added to `wind.py` and `steel.py` above.

### Notes
- P105 wind validation confirmed: qb=238.80 N/m², qp=598.48 N/m², design_pressure=0.359 kPa (target 0.36 kPa) ✓
- P105 steel section validation: with shear check added, T1 selects `305 × 127 × 37` (UR_shear=0.048) and T2 selects `356 × 127 × 39` (UR_shear=0.050). PE report cites `356 × 127 × 33` (T1) and `406 × 140 × 39` (T2). Discrepancy pre-dates this fix — caused by sort order: `305 × 127 × 37` has Wpl_y=539 cm³ < `356 × 127 × 33` Wpl_y=543 cm³ and passes all three checks, so it is selected first. Pending PE clarification on whether shear UR or a different criterion governs section choice in those reports.
- Foundation numeric validation requires actual P105 footing geometry (B, L, D, G) from PE report — not available in this session; estimated values used for smoke-testing. γG,stb formula is structurally confirmed correct per P105.

---

## [0.7.0] — 2026-04-09

### Added
- Step 3 Design Parameters form — 11 inputs across three groups (Wind, Post, Foundation); structure height sourced read-only from `project_info.barrier_height`; shelter toggle shows x/φ fields and warns ψs=0.5 stub is used
- Step 3 Results panel — Wind (ze, qp, design pressure, ψs), Steel (designation, M_Ed/Mb,Rd, UR_moment/deflection with pass/fail), Foundation (SLS/DA1-C1/DA1-C2 table: sliding FOS, overturning FOS, bearing UR), overall pass/fail banner
- `Run Calculations` button in Step 3 — POSTs form inputs to `/api/calculate`, stores response in Zustand, shows inline error on failure; button disabled until all required fields are filled
- `calculation_results: CalculationResults | null` slice in Zustand store (`projectStore.ts`) with `setCalculationResults` action; persists across navigation within session; cleared on `reset()`
- `CalculationResults`, `WindCalcResult`, `SteelCalcResult`, `FoundationComboResult` interfaces in `types/index.ts`
- Updated `DesignParameters` interface and store defaults: added shelter_present/shelter_x/shelter_phi, post_length, footing_L_m/footing_B_m/footing_D_m, vertical_load_G_kN; soil defaults updated to P105 confirmed values (γs=19 kN/m³, c'k=5 kN/m²)

### Notes
- Shelter factor UI collects x and φ but passes ψs=0.5 stub to backend — full Figure 7.20 lookup deferred until `shelter_factor_table.json` is digitised
- Results panel is read-only display; iterate by editing form fields and re-running
- footing_L_m (along barrier, perpendicular to wind) maps to API field `footing_W`; footing_B_m (in wind direction) maps to `footing_B`

---

## [0.6.0] — 2026-04-09

### Added
- `backend/app/calculation/` package — new engineering calculation engine
- `backend/app/calculation/constants.py` — `APPLICABLE_CODES` (7 codes, cited verbatim in PE reports), `SG_NA` (Singapore NA constants: vb0=20m/s, ρ=1.194kg/m³, kl=1.0, kr=0.19, z0=0.05m, zmin=2m, cp_net=1.2), DA1-C1/C2/SLS partial factor dicts
- `backend/app/calculation/wind.py` — `compute_qp(ze)` (EC1 Clause 4.3 chain: cr→vm→Iv→qp) and `compute_design_pressure(ze, ψs)` (qp × cp_net × ψs). P105 validation: ze=12.7m, ψs=0.5 → qp=0.598kPa, design_pressure=0.36kPa ✓
- `backend/app/calculation/steel.py` — `compute_steel_design(design_pressure, post_spacing, subframe_spacing, post_length)`: iterates parts library ascending by Wpl_y, returns first section with UR_moment < 1.0 AND UR_deflection < 1.0. Implements EC3 Clause 6.3.2.3 LTB (αLT=0.34, λLT0=0.4, β=0.75, Lcr=subframe_spacing) and δ=wL⁴/(8EI) deflection (limit L/65)
- `backend/app/calculation/foundation.py` — `compute_foundation(...)`: branches by footing_type. Branch A (Exposed pad): μ=0.3 sliding, Meyerhof eccentric bearing. Branch B (Embedded RC): tanφd friction, passive earth (evaluated to 0 per P105), EC7 Annex D.4 drained bearing capacity with Nγ=1.5(Nq-1)tanφ (P105 formula). All three combinations: SLS, DA1-C1, DA1-C2
- `backend/app/routers/calculate.py` — `POST /api/calculate`: full chain wind→steel→foundation. Pydantic request/response models. SLS forces derived from steel results (M_Ed/1.5, V_Ed/1.5)
- `backend/app/data/shelter_factor_table.json` — stub placeholder for EN 1991-1-4 Figure 7.20 digitisation (not yet implemented; feed ψs directly for P105 runs)

### Changed
- `backend/app/main.py` — registered `calculate` router alongside `extract` router

### Notes
- Steel section selection iterates all 107 UB sections sorted ascending by Wpl_y; lightest passing section is returned
- Foundation bearing uses the P105 Nγ formula: 1.5(Nq-1)tanφ — see code-reference.md Section 8 item 3 for alternative
- Passive earth resistance set to 0 (not relied upon) per P105 T1/T2 confirmed practice; implement when PE confirms it applies
- Shelter factor lookup (Figure 7.20) deferred — shelter_factor_table.json is a stub; feed ψs=0.5 directly for P105 validation

---

## [0.5.0] — 2026-04-09

### Changed
- Step 2: replaced combined segment table with per-alignment tab panel — one tab per alignment, each showing only that alignment's segments (ID, Length, Tag)
- Step 2: canvas polylines now highlight when the corresponding tab is selected (amber, strokeWidth 3; inactive polylines render in blue at strokeWidth 1.5 with grey dots)
- Step 2: clicking a polyline on the canvas activates its tab (bidirectional — 10 px proximity threshold in canvas coordinates)
- Step 2: "Delete" per-alignment-row replaced with "Delete Selected" control button acting on the active alignment
- Zustand store: `startNewPolyline` now sets `is_active: true` on the new polyline and `active_alignment_id` to its id; clears `is_active` on all others
- Zustand store: `deletePolyline` now updates `active_alignment_id` to the last remaining polyline (or null) when the deleted polyline was active

### Added
- `is_active: boolean` to `Polyline` interface (`frontend/src/types/index.ts`)
- `active_alignment_id: number | null` to `SiteData` interface and store default (`frontend/src/types/index.ts`, `frontend/src/store/projectStore.ts`)
- `setActiveAlignment(id)` action in Zustand store — sets `active_alignment_id` and syncs `is_active` across all polylines

### Notes
- Segment IDs (A, B, C…) reset per alignment — unchanged
- Only one alignment active/highlighted at a time
- `activePolylineId` (local component state) tracks the polyline currently being drawn; `active_alignment_id` (store) tracks the selected tab/highlight — they are separate concepts

---

## [0.4.0] — 2026-04-09

### Changed
- Removed `applicable_codes` slice from Zustand store (`frontend/src/store/projectStore.ts`)
- Removed `CodeReference` interface from `frontend/src/types/index.ts`
- Removed Code Selection tab from Step 3; Step 3 now opens directly on Design Parameters

### Added
- `ProjectMeta` interface (`frontend/src/types/index.ts`) — `id`, `created_by`, `last_modified_by`, `created_at`, `updated_at`
- `meta` slice to ProjectContext (`frontend/src/store/projectStore.ts`) — `initMeta(createdBy)` generates UUID + timestamps on project creation; `setMeta` for partial updates
- `created_by` and `updated_at` fields on `Project` interface (`frontend/src/types/index.ts`)
- Creator name prompt modal on Overview page New Project button — sets `meta.created_by` and `meta.last_modified_by`, generates stub UUID for `meta.id`, sets timestamps, then navigates to `/project/new`
- Attribution columns (Created by, Date) visible on Projects Library and Recent Projects rows
- Mock data in `useProjects()` updated with `created_by` and `updated_at` fields

### Notes
- `meta.created_by` is free-text — no authentication behind it
- Upgrade path: when user accounts are added, populate `created_by`/`last_modified_by` automatically from the logged-in session

---

## [0.3.1] — 2026-04-09

### Built (unlogged)
- `code-reference.md` — engineering code reference (Eurocodes, SG NA, wind formulas, validation targets)
- `unused.md` — archived earlier PRD draft; retained for reference
- `backend/app/data/` — new data directory added under backend (contents TBD)
- `union-noise-prd-v3.md` deleted; `union-noise-prd-v4.md` updated with user attribution spec, removal of `applicable_codes`, and `ProjectContext` meta schema

### Notes
- PRD v4 introduces two store-breaking changes: `applicable_codes` removed, `meta` slice added

---

## [0.3.0] — 2026-04-06

### Added
- **DesignParameters interface** (`frontend/src/types/index.ts`) — full typed schema for all engineering inputs: wind (basic_wind_speed, return_period, structure_height, shelter_factor, wind_zone, lh_ratio), structural geometry (post_spacing, subframe_spacing), materials (concrete_grade, steel_grade, rebar_grade, bolt_grade), foundation (footing_type, allowable_soil_bearing), and soil parameters (phi_k, gamma_s, cohesion_ck). Supporting enums: WindZone, FootingType, ConcreteGrade, SteelGrade, RebarGrade, BoltGrade.
- **design_parameters slice** (`frontend/src/store/projectStore.ts`) — initialised with PRD-confirmed defaults (basic_wind_speed=20, return_period=50, shelter_factor=1.0, concrete_grade=C25/30, steel_grade=S275, rebar_grade=B500B, bolt_grade=8.8, allowable_soil_bearing=75, phi_k=30, gamma_s=20, cohesion_ck=0). `setDesignParameters(partial)` action for partial updates. Included in `reset()`.
- **Design Parameters tab** (`frontend/src/steps/Step3.tsx`) — fully functional input panel replacing the placeholder. Four sections: Wind Analysis, Structural Geometry, Materials, Foundation + Soil Parameters. All fields bound to Zustand store. Provisional fields labelled. Reads and writes persist across navigation.

### Notes
- Wind zone (A/B/C/D) and l/h ratio are user-confirmed per PRD §2.4 — engineering judgement, not auto-calculated.
- Soil parameters (phi_k, gamma_s, cohesion_ck) are marked provisional per PRD §2.5 — pending SME validation.
- Calculation engine not yet wired — parameters are captured in ProjectContext only.

---

## [0.2.2] — 2026-04-06

### Added
- **CodeReference interface** (`frontend/src/types/index.ts`) — `{ en_designation, eurocode_label, governs, selected }`.
- **applicable_codes slice** (`frontend/src/store/projectStore.ts`) — persisted in Zustand with `toggleCode(en_designation)` action. Initialised with all 6 Eurocodes (EC0–EC3, EC7, SG NA) pre-selected; SS 602:2014 deselected by default. Included in `reset()`.
- **ProjectsLibraryPage** (`frontend/src/pages/ProjectsLibraryPage.tsx`) — dedicated `/projects-library` route. Full project table with status dropdown filter and free-text search on name/location. Clicking a row navigates to `/project/:id` (revision vs overwrite decision deferred — flagged with TODO per PRD Section 13).
- `/projects-library` route in `App.tsx`.

### Changed
- **Step3.tsx** — removed local `useState<Record<string, boolean>>` for code selection; reads `applicable_codes` and calls `toggleCode` from the Zustand store. EN designation is now the primary label (bold monospace); Eurocode name and governs text are subtitle lines below it.
- **OverviewPage** (`frontend/src/pages/OverviewPage.tsx`) — "Projects Library" button now navigates to `/projects-library` instead of toggling an inline list. Removed `showOldProjects` state and inline expansion block.
- **MasterDataPage** (`frontend/src/pages/MasterDataPage.tsx`) — replaced placeholder stub with a read-only sample members table (8 rows: UB 152×89×16, UB 203×102×23, UB 254×102×28, UB 406×140×46, SHS 50×50×4, SHS 75×75×5, M16 and M20 cast-in bolts). Upload button added to header (disabled stub — no functionality yet).

### Notes
- SS 602:2014 is optional and deselected by default; all other codes are pre-selected required defaults.
- EN 1997-1:2004 (Eurocode 7 — Geotechnical Design) remains a pre-selected default.
- Master Data upload button is a stub — wires to `POST /api/master-data` when backend is ready (PRD Section 2.6).
- Projects Library filter operates on client-side mock data; replace `useProjects()` body with React Query call when persistence is added.

---

## [0.2.1] — 2026-04-06

### Changed
- **Overview page** (`frontend/src/pages/OverviewPage.tsx`) — replaced card grid with three prominent action buttons (New Project, Old Projects, Master Data) and a Recent Projects row-list below.
  - **New Project** — existing behaviour, navigates to `/project/new`.
  - **Old Projects** — toggles an inline row-list of all projects (Name, Barrier Type, Location, Date, Status). Clicking a row navigates to `/project/:id`. Edit behaviour (overwrite vs new revision) is deferred — flagged with `// TODO: revision vs overwrite decision pending — see PRD Section 13`.
  - **Master Data** — navigates to `/master-data`.
  - **Recent Projects** — always-visible list below the buttons, max 5 rows, sorted by most recent `created_at`. Sourced from the same `useProjects()` call — no data duplication.
- **App.tsx** (`frontend/src/App.tsx`) — added `/master-data` route.

### Added
- **MasterDataPage** (`frontend/src/pages/MasterDataPage.tsx`) — stub page at `/master-data` with upload area and "Upload member library (CSV/Excel) — coming soon" message. Upgrade path: `POST /api/master-data` when backend parts library is ready (PRD Section 2.6).

### Notes
- `useProjects`, `Project` interface, and `ProjectCard` component are unchanged.
- `ProjectCard` is no longer used by OverviewPage (replaced by inline `ProjectRow`); it remains available for other consumers.

---

## [0.2.0] — 2026-04-06

### Added
- **Overview page** (`frontend/src/pages/OverviewPage.tsx`) — new application entry point at `/`. Displays a grid of project cards with "New Project" button that navigates to `/project/new`.
- **ProjectCard component** (`frontend/src/components/ProjectCard.tsx`) — renders project name, location, barrier type, date, and status badge. Navigates to `/project/:id` on click.
- **useProjects hook** (`frontend/src/hooks/useProjects.ts`) — stub data layer returning `MOCK_PROJECTS`. Replace with `React Query → GET /api/projects` when backend persistence is added; callers need no changes.
- **Project interface** (`frontend/src/types/index.ts`) — `{ id, project_name, barrier_type, location, created_at, status }`.

### Changed
- **Routing restructure** (`frontend/src/App.tsx`) — 6-step workflow moved from `/step/:n` to `/project/:id/step/:n`. Overview is a standalone route at `/`; project workflow uses the Layout (sidebar). Fallback `*` → `/`.
- **Sidebar** (`frontend/src/components/Sidebar.tsx`) — reads `:id` from route params; step navigation links use `/project/${id}/step/${n}`; added "← Projects" back-link at top.
- **useStepGuard** (`frontend/src/hooks/useStepGuard.ts`) — reads `:id` from route params; redirect uses `/project/${id}/step/${unlockedUpTo}`.
- **Step 1–5 navigate calls** (`frontend/src/steps/Step1.tsx` – `Step5.tsx`) — all `navigate('/step/n')` updated to `navigate(\`/project/${id}/step/n\`)` using `useParams`.
- **Step 2 canvas** (`frontend/src/steps/Step2.tsx`) — single polyline replaced with multiple independent polylines:
  - "Start Drawing" creates a new named alignment (Alignment 1, 2, 3…) and begins drawing.
  - "Stop Drawing" completes the current polyline without discarding it.
  - Each alignment shown in an Alignments panel with a Delete button.
  - Segment table gains an Alignment column; segment IDs reset A, B, C… per alignment.
  - Canvas re-renders all polylines from the store on every change.
- **Zustand store** (`frontend/src/store/projectStore.ts`) — `alignment_points: {x,y}[]` replaced with `polylines: Polyline[]`. New actions: `startNewPolyline`, `addPolylinePoint`, `undoLastPoint`, `deletePolyline`. `updateSegmentTag` now takes `(alignment_id, segment_id, tag)`. `buildSegmentTable` iterates all polylines and resets segment labels per alignment. `SegmentRow` shape updated: `alignment_id + segment_id` instead of `id`.
- **Types** (`frontend/src/types/index.ts`) — `Polyline` interface added; `SegmentRow` updated (`alignment_id`, `segment_id`); `SiteData.alignment_points` replaced with `SiteData.polylines`.
- **Step 3 code checklist** (`frontend/src/steps/Step3.tsx`) — updated display labels to match PRD v3 Section 2.3 format (full Eurocode names); EN designations shown as secondary text in monospace; added **Eurocode 7 — Geotechnical Design (EN 1997-1:2004)** as a pre-selected default (was missing from v0.1.0).
- **Step 6 summary** (`frontend/src/steps/Step6.tsx`) — segment table key changed from `row.id` to `${row.alignment_id}-${row.segment_id}`; vertex count derived from `polylines` array; new "Alignments" summary row added.

### Notes
- `useProjects` returns hardcoded `MOCK_PROJECTS` — replace with `useQuery({ queryFn: () => api.get('/api/projects') })` when backend persistence is ready. Hook interface is stable.
- Polyline store shape is pre-normalised for direct PostgreSQL mapping (each `Polyline` row maps to a `polylines` table, each `SegmentRow` to a `segments` table keyed on `alignment_id + segment_id`).
- `handleStartDrawing` in Step 2 computes the next polyline id as `site_data.polylines.length + 1` at call time (before the Zustand update lands). This is correct because `startNewPolyline` appends synchronously and the id is deterministic.

### Deferred
- Clicking a mock project card navigates to `/project/:id` which resolves to the 6-step workflow — no project-specific state is loaded. Full project loading/persistence requires the PostgreSQL backend (planned for a future iteration).
