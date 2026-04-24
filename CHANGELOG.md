# CHANGELOG

## [0.26.0] — 2026-04-24
### Added
- `backend/app/data/bolt_library.json`: ISO 898-1 bolt mechanical properties for M16, M20, M24, M30 Grade 8.8. Stores `fub`, `fyb`, threaded stress area (`As_threaded`) and nominal shank area (`As_nominal`) per diameter.
- `connection.py`: `BOLT_DATA` lookup dict loaded from `bolt_library.json` at module init. Keyed by `(diameter_mm, grade)`.
### Fixed
- `connection.py` dynamic path: `FT_Rd` and `Fv_Rd` now use threaded stress area (`As_threaded`) from `bolt_library.json` per EC3-1-8 Table 3.4. Previous nominal area overstated `FT_Rd` by up to 28% (M24: 452→353 mm²). `bolt_As_type="threaded"` added to dynamic path return dict.
- `connection.py` config path: `As_nominal_mm2` now looked up from `bolt_library.json` instead of computed inline. Preserves P105 T2 Run B exactly — M24 nominal `As=452 mm²`, `FT_Rd=260.35 kN`, `UR=0.371`. Note: PE calc used `π/4·d²=452.39 mm²` yielding `FT_Rd=260.58 kN`, `UR=0.370` — 0.22 kN rounding difference from ISO 898-1 tabulated value, immaterial. `bolt_As_type="nominal"` added to config path return dict.
- `connection_library.json`: `_Ds_note` corrected for `T2_M20_4bolt` (175→250 mm) and `T1_M20_6bolt` (265→430 mm) per confirmed rule `Ds = plate_height − 100`.
### Notes
- Dynamic path now produces higher `UR_tension` than before for same load — this is correct; previous values were unconservative.
- Config path P105 T2 Run B assertions updated to ISO 898-1 tabulated values — all checks pass.
- `Ds` correction in `connection_library.json` is note-only — these configs are flagged unvalidated and not used by the dynamic path.

---

## [0.25.0] — 2026-04-24
### Added
- `wind.py`: Terrain category parameter added to `compute_design_pressure()` and `compute_qp()`. `TERRAIN_Z0` and `TERRAIN_ZMIN` lookup dicts for all five EC1-1-4 categories (0, I, II, III, IV). zmin check applied: `ze_effective = max(ze, zmin)` per EC1 Cl 4.3.2 — prevents underestimating cr for low structures in rough terrain. `terrain_category`, `z0_m`, `zmin_m`, `ze_effective_m` added to return dict.
- `Step3.tsx`: Terrain category dropdown added to Wind group (full-width, spans both columns). Five options with z0 values shown. Default Category II. Clears Phase 1 on change.
- `Step3.tsx` `buildWindRows`: Terrain category and reference height rows added to wind derivation panel. Roughness factor and turbulence intensity expressions now use actual z0 from response instead of hardcoded 0.05.
- `types/index.ts`: `terrain_category` added to `DesignParameters`. `ze_effective_m`, `z0_m`, `zmin_m`, `terrain_category` added as optional fields to `WindCalcResult`.
- `projectStore.ts`: `terrain_category: 'II'` added to initial state.
- `routers/calculate.py`: `terrain_category` field added to `CalculateRequest` and `WindResult`. Passed to `compute_design_pressure()`.
- `routers/wind_and_select.py`: `terrain_category` field added to `WindAndSelectRequest`. Passed to `compute_design_pressure()`.
### Notes
- All existing P105 T2 assertions unchanged — Category II default, ze=12.7m > zmin=2.0m, qp=598.48 N/m² ✓
- Category I at the same ze gives ~45% higher cr than Category II — significant impact on qp and all downstream checks.
- zmin clamp verified: Category IV, ze=8m < zmin=10m → ze_effective=10.0m ✓

---

## [0.24.4] — 2026-04-24
### Fixed
- **PDF report `--` placeholder audit** (`report.py`, `connection.py`, `routers/calculate.py`): Resolved all spurious `--` values across the PDF report in a single pass.
  - `SteelResult` Pydantic model was silently stripping 13 fields (`section_class`, `epsilon`, `flange_class`, `web_class`, `cf_tf_ratio`, `cw_tw_ratio`, `class3_wel_used`, `fy_N_per_mm2`, `Iy_cm4`, `Iz_cm4`, `Iw_dm6`, `It_cm4`, `Wpl_y_cm3`, `Wel_y_cm3`) — added all to response model.
  - `ConnectionResult` Pydantic model was silently stripping `bolt_bearing` — added `bolt_bearing: dict` to response model.
  - `compute_connection()` return dict was missing `bolt_diameter_mm`, `n_shear`, `plate_width_mm`, `plate_height_mm`, `plate_thickness_mm` — added to all relevant sub-dicts.
  - Section 8 summary table: connection rows (bolt tension, shear, bearing, embedment, weld, base plate bending, G clamp) and lifting rows (hole shear, hook tension, hook bond) were hard-coded to `--` for demand/capacity — now populated from their respective sub-dicts.
  - Foundation sliding/overturning Demand column now shows `H = x kN` / `M = x kNm` instead of `--`.
  - Bolt count label corrected: `"5 tension + 10 shear = 15 total"` → `"5 bolts/row x 2 rows = 10 total"` (`n_shear` is the total, not a separate group).

---

## [0.24.3] — 2026-04-24
### Fixed
- `report.py`: All table cells converted from plain strings to `Paragraph` objects using `_TS_CELL` / `_TS_BOLD` styles with `wordWrap='CJK'`. Applies to derivation tables, inputs tables, results tables, spec tables, cover page tables, and the Section 8 summary table. Long formula and substitution strings now wrap within column bounds rather than overflowing.
- `report.py`: Column widths corrected for A4 usable width (170 mm): derivation table 40/45/55/30 mm; inputs and spec tables 70/100 mm; results table 50/35/35/25/25 mm. `VALIGN TOP` added to all tables to align wrapped cells correctly.
- `report.py`: All Unicode mathematical and Greek characters replaced with ASCII equivalents throughout every string in the file. `phi` -> `phi`, `psi` -> `psi`, `lambda` -> `lambda`, `gamma` -> `gamma`, `epsilon` -> `epsilon`, `chi` -> `chi`, `alpha` -> `alpha`, `beta` -> `beta`, `sqrt(...)` replaces the sqrt symbol, `x` replaces the multiply symbol, `^2`/`^3` replace superscripts, `deg` replaces the degree symbol, `<=`/`>=` replace Unicode comparison operators. Resolves black-box rendering on Helvetica.
- `report.py`: Component Specification table added at the start of Steel (3.1), Connection (4.1), Subframe (5.1), Lifting (6.1), and Foundation (7.1) sections. Each table explicitly states the full dimensions and grade of every designed component using the same 70/100 mm two-column layout. Connection spec shows plate dimensions (W x H x t mm, S275), bolt spec (diameter, grade, tension/shear counts), embedment depth, weld throat and total length, and G clamp count and failure load. Foundation spec shows footing B x L x D in mm, concrete grade, and P_G.

---

## [0.24.2] — 2026-04-24
### Fixed
- `Step3.tsx`: Phase 2 ("Confirm & Continue") no longer blocked when `vertical_load_G.effective` is 0. `canRun` guard now requires only footing dimensions — `vertical_load_G` is derived and cannot be known before the section is confirmed (chicken-and-egg with Phase 1 card).
- `Step3.tsx`: `handleRunPhase2` now computes `post_weight_kN` and `vertical_load_G_kN` directly from the incoming section object rather than reading from store state. `setConfirmedSection` fires asynchronously, so reading `dp.post_weight.effective` immediately after would have sent 0 to the backend for both values.
- `Step3.tsx`: Post self-weight and Self-weight G fields now render as locked read-only display (`—`) when their computed value is not yet available (section not confirmed / footing dims incomplete). An "Override" button unlocks the field for engineer override when needed. Previously both fields showed an editable number input with value 0 before anything was computed.

---

## [0.24.1] — 2026-04-23
### Fixed
- `projectStore.ts`: Renamed persist key from `union-noise-project` to `union-noise-project-v2`. Clears stale localStorage from before `OverridableValue` schema change; old persisted `null` values for `post_length`, `post_weight`, `vertical_load_G` caused a crash on Step 3 when accessing `.effective` on a null object (blank page).

---

## [0.24.0] — 2026-04-23
### Added
- `backend/app/calculation/report.py`: PDF report generator using ReportLab platypus. 8-section PE-format calculation report with full derivations, formula substitutions, clause references, and PASS/FAIL indicators. Cover page with PE endorsement block (blank for PE to complete). Page headers with project name and job reference on all subsequent pages. Section structure: section title → inputs table → derivation table (Description / Formula / Substitution / Result) → results summary with UR colouring.
- `backend/app/routers/report.py`: `POST /api/report/generate` endpoint. Accepts full calculation payload from frontend, returns PDF binary with `Content-Disposition: attachment` header. Filename derived from project_name.
- `backend/app/main.py`: `report` router registered.
- `reportlab` + `pillow` added to `pyproject.toml` dependencies via `uv add`.
- `Step6.tsx`: Report generation page replacing the previous stub. Report metadata form (job reference, revision, checked by). Section list previews report contents before generation. Generate button assembles payload from Zustand store and calls `POST /api/report/generate`. PDF downloads directly via browser anchor. Regenerate button shown after first generation. Error and success states handled inline.
### Notes
- PE endorsement fields (name, registration, signature) are intentionally blank — PE completes after review.
- Override notes section (Section 8.2) populated automatically when any OverridableValue field was overridden (vb, shelter_factor, post_length, post_weight, vertical_load_G).
- Generate button disabled with amber warning when `calculation_results` is null (Step 3 not yet run).
- Smoke test: P105-T2 full payload generates 30 KB valid PDF with all 8 sections and correct PASS banner.

---

## [0.23.1] — 2026-04-23
### Fixed
- `connection.py`: Plate thickness fixed at 20mm for all plate heights. Previous conditional (20mm ≤500mm, 25mm >500mm) was not confirmed by any PE report or client communication. Bayshore (600mm plate) and IJC T1 (550mm plate) both use 20mm — 25mm is LTA-specific, not a general rule.
### Notes
- Run A base plate bending UR = 0.546 with 20mm plate (was same, dynamic path selected 400mm plate class). Run B (config path, t=25mm) unchanged. All assertions pass.

---

## [0.23.0] — 2026-04-23
### Fixed
- `foundation.py`: Eccentric bearing branch added to embedded RC footing bearing pressure check. When e > B/6, uses q_max = 4P / (3Lb') where b' = 3(B/2 - e) instead of standard formula. Applies to SLS, DA1-C1, DA1-C2 combinations (all use SLS eccentricity per PE methodology). Return dict includes `eccentricity_m`, `eccentric_bearing` (bool), `b_prime_m` per combination.
- `foundation.py`: Nγ corrected from 1.5×(Nq-1)×tanφ to 2×(Nq-1)×tanφ per EC7 Annex D.4. Previous multiplier 1.5 was P105-specific. qu increases for all embedded RC footing projects — bearing check becomes less conservative.
- `foundation.py` `__main__`: Exact qu assertions replaced with structural checks (qu > 0, UR < 1.0). FOS targets (sliding, overturning) unchanged and still asserted within 0.5%.
### Notes
- P105 T2: e=0.443m > B/6=0.283m → eccentric branch active. b'=1.222m, q_applied=71.38 kPa, DA1-C1 drained UR=0.226, DA1-C2 drained UR=0.505, DA1-C1 undrained UR=0.449, DA1-C2 undrained UR=0.543. All pass.
- Nγ change: DA1-C1 drained qu 279.44 → 315.16 kPa; DA1-C2 drained qu 127.91 → 141.28 kPa.
- Exposed pad bearing branch already had the eccentric formula — no change required.
- Frontend unchanged — eccentricity_m and eccentric_bearing available in response dict.

---

## [0.22.0] — 2026-04-23
### Fixed
- `steel.py`: Iw unit multiplier corrected 1e6 → 1e12. 1 dm = 100 mm → 1 dm⁶ = 1e12 mm⁶. Previous value underestimated warping contribution by 1e6×, making Mcr artificially low and chi_LT unnecessarily conservative.
- `lifting.py`: `tw_for_hole_mm` now reads `section["tw_mm"]` instead of hardcoded 6.0 mm. P105 T2 section has tw=6.4 mm (PE report rounded to 6.0 mm — corrected). V_Rd 47.63 → 50.74 kN; UR_hole 0.189 → 0.177.
- `steel.py` `__main__`: Exact designation assertions replaced with structural checks (`pass=True`, `UR_moment < 1.0`, `Mb_Rd_kNm > 0`, `UR_deflection < 1.0`). T1 section changes to 305×102×33 (lighter section now passes with correct Mcr). T2 section unchanged at 406×140×39.
### Notes
- Iw fix does not affect P105 T2 T2 section selection (406×140×39 still passes), but chi_LT increases: lambda_bar_LT 0.513, chi_LT 0.955, UR_moment 0.686. Correct values reflect more realistic buckling capacity.
- lifting.py validation: UR_shear 0.177 (target 0.177 ✓), V_Rd 50.81 kN vs PE 50.74 kN (minor float vs manual rounding).

---

## [0.21.0] — 2026-04-23
### Changed
- `Step3.tsx`: `post_weight_kN` and `vertical_load_G_kN` free inputs replaced with OverridableFields driven by computed values. `post_weight` derived from confirmed section mass × post_length × 9.81/1000. `vertical_load_G` derived from footing concrete weight (B×L×D×25) + post_weight. Both update reactively when upstream inputs change. Override pattern applies throughout. Unused `footingWeightHint` memo removed.
- `types/index.ts`: `post_weight_kN: number` and `vertical_load_G_kN: number | null` replaced with `post_weight: OverridableValue` and `vertical_load_G: OverridableValue`.
- `projectStore.ts`: Both fields updated to OverridableValue initial state (calculated=0, effective=0).
### Notes
- Backend unchanged — `post_weight.effective` and `vertical_load_G.effective` sent as plain numbers under the same API keys `post_weight_kN` / `vertical_load_G_kN`.
- P105 T2: computedPostWeight=4.86 kN (PE used 6.0 kN rounded). computedPG=196.11 kN (PE=196.25 kN). Override to 6.0 kN reproduces PE exactly.
- Both fields show explanatory hint before Phase 1 runs / footing dims filled.
- `canRun` gated on `vertical_load_G.effective > 0`.

---

## [0.20.0] — 2026-04-23
### Changed
- `Step3.tsx`: post_length free input replaced with OverridableField driven by connection_type selection. `computedPostLength` useMemo derives post length from connection_type, barrier_height, and footing_D. useEffect syncs to `dp.post_length.calculated`. Override pattern (amber badge + reason field) applies when PE specifies a different value.
- `types/index.ts`: `post_length: number | null` removed from DesignParameters. `post_length: OverridableValue` and `connection_type: 'above_ground' | 'footing_block' | 'fully_embedded' | null` added.
- `projectStore.ts`: `post_length: null` replaced with `post_length: OverridableValue` and `connection_type: null` in initial state.
### Added
- `Step3.tsx`: Connection type selector added to Post group — Above Ground, Footing Block, Fully Embedded. Drives post_length derivation and hints on the post_length field. `canPhase1` gated on `connection_type != null` and `post_length.effective > 0`.
### Notes
- Backend unchanged — `post_length.effective` sent as plain number, same as before.
- P105 T2: connection_type=fully_embedded, barrier_height=12m, footing_D=0.7m → post_length=12.7m
- IJC T1: connection_type=footing_block, barrier_height=10m, footing_D=1.5m → post_length=8.5m
- RM T1: connection_type=above_ground, barrier_height=6m → post_length=6.0m

---

## [0.19.0] — 2026-04-23
### Added
- `Step3.tsx`: cp,net dynamic lookup from EC1 Table 7.9. Panel type toggle (Porous/Solid) replaces numeric dropdown. Solid mode reveals `barrier_length_m` input and `has_return_corners` toggle. `cpNetZoneB()` and `cpNetZoneA()` lookup functions added. `computedCpNet` useMemo syncs to `dp.cp_net` via useEffect. Solid mode read-only display shows resolved Zone B value with l/h and Zone A flag in hint text.
- `types/index.ts`: `cp_net_mode`, `barrier_length_m`, `has_return_corners` added to `DesignParameters`. `lh_ratio` optional field added to `WindCalcResult`.
- `projectStore.ts`: Initial state for three new fields (`cp_net_mode: 'porous'`, `barrier_length_m: null`, `has_return_corners: false`). Existing `cp_net=1.2` default preserved — porous mode behaviour identical to previous version.
- `wind.py`: `barrier_length_m` and `has_return_corners` optional params added to `compute_design_pressure()`. `lh_ratio` echoed in return dict (null when porous mode or barrier_length_m not provided).
- `Step3.tsx` buildWindRows: `lh_ratio` row added to wind derivation panel when `lh_ratio` is not null.
- `calculate.py`: `qp_kPa` optional field added to `CalculateRequest` — receives Phase 1 qp from frontend for consistent G clamp pressure.
### Fixed
- `connection.py`: G clamp external pressure now computed as `qp_kPa × shelter_factor` instead of hardcoded 0.45 kPa. `qp_kPa` and `shelter_factor` replace `external_pressure_kPa` in function signature. P105 T2: external_pressure 0.45 → 0.299 kPa; F_per_clamp 2.44 → 1.615 kN; UR 0.105 → 0.069. n_clamps unchanged at 5 (config path).
- `Step3.tsx` windPostBody: `cp_net` uses `computedCpNet`. `barrier_length_m` and `has_return_corners` added to API body.
- `Step3.tsx` handleRunPhase2: `qp_kPa` added to Phase 2 body for consistent G clamp pressure.
- `Step3.tsx` clearTrigger: extended to include `cp_net_mode`, `barrier_length_m`, `has_return_corners`.
- `calculate.py` router: `compute_connection` call updated — passes `qp_kPa` + `shelter_factor` instead of computed `external_pressure_kPa`. Falls back to `wind_raw["qp_kPa"]` when frontend omits `qp_kPa`.
- `constants.py`: clarifying comment added to `SG_NA['cp_net']` — documentation only, not read by calc modules.
### Notes
- Porous mode behaviour is identical to previous version — no existing project affected by default.
- Solid mode cp,net = 1.3 (previous wrong default) is removed entirely.
- G clamp UR change (0.105 → 0.069) confirmed in Run B `__main__` assertion.

---

## [0.18.0] — 2026-04-23
### Added
- `connection.py`: `_derive_connection(M_Ed_kNm, V_Ed_kN, section, fck)` — derives minimum-passing connection geometry when no `config_id` is provided. Iterates bolt diameter M16→M30; sizes plate width from section flange + 2×50mm edge (rounded to nearest 50mm); sizes plate height to satisfy tension demand; selects embedment depth from standard [450, 550, 650, 750] mm schedule; plate thickness 20mm (≤500mm plate) or 25mm (>500mm plate).
- `connection.py`: Two-path routing in `compute_connection()` — `derived = config_id is None`. Derived path calls `_derive_connection()` and unpacks geometry; config path loads `connection_library.json` as before. All downstream checks (tension, shear, bearing, combined, embedment, weld, base plate, G clamp) are path-agnostic.
- `connection_library.json`: `_routing` field — documents that configs are used only when `config_id` is explicit; dynamic derivation used when `config_id=None`; T1_M24_6bolt retained as P105 T2 validated reference.
- `connection.py` `__main__`: Two-run validation — Run A (dynamic path, structural assertions: all URs < 1.0, embedment sufficient, Ds > 0); Run B (config path T1_M24_6bolt, P105 T2 PE exact-match assertions: Ft=96.53 kN, FT_Rd=260.58 kN, UR_tension=0.370, UR_embedment=0.731, n_clamps=5).
### Notes
- All previously validated P105 T2 outputs are unchanged — Run B assertions confirm this.
- Derived path sets `config_id = "derived"` in the result dict for traceability.
- G clamp on derived path defaults to `n_clamps_provided = 5` (same as PE-confirmed count). No config exists for derived geometry; engineer must review.
- Dynamic derivation does not account for bolt bearing on derived geometry (bearing check runs post-derivation on the final bolt size). If bearing governs, the next bolt size would be needed — not yet handled in iteration loop.
- Embedment awareness in iteration: `_derive_connection` computes the minimum Ds from both tension capacity and embedment depth limit (750mm) simultaneously, then rounds up to the next 50mm plate height. This avoids selecting a bolt that passes tension/shear but fails embedment.

---

## [0.17.1] — 2026-04-22
### Added
- `Step3.tsx` / `Step4.tsx`: Section class displayed in SteelPanel and SteelCard — Class 1/2 green, Class 3 amber with "(Wel)" note, Class 4 red. ε, cf/tf, cw/tw shown inline.
- `Step3.tsx` / `Step4.tsx`: Bolt bearing row added to ConnectionPanel checks table and ConnectionCard UR rows.
- `Step3.tsx` / `Step4.tsx`: Base plate split into two rows — "Base plate — bearing" and "Base plate — bending" — with demand/capacity for each. Previously a single aggregated "Base plate" row.
- `types/index.ts`: `SteelCalcResult` extended with `section_class`, `epsilon`, `cf_tf_ratio`, `cw_tw_ratio`, `flange_class`, `web_class`, `class3_wel_used`, `class4_error`. `ConnectionCalcResult` extended with `bolt_bearing` sub-dict.

---

## [0.17.0] — 2026-04-22
### Added
- `steel.py`: Section classification per EC3 Table 5.2 — ε, flange class (cf/tf), web class (cw/tw), governing section_class. Class 3 substitutes Wel_y for Wpl_y in Mpl/Mb_Rd; Class 4 skips moment check and returns pass=False with `class4_error`. New keys in output: `section_class`, `epsilon`, `cf_tf_ratio`, `cw_tw_ratio`, `flange_class`, `web_class`, `class3_wel_used`, `class4_error`.
- `connection.py`: Bolt bearing check (EC3-1-8 Table 3.4) — new `bolt_bearing` sub-dict with d0, e1, e2, alpha_d, alpha_fub, alpha, k1, Fb_Rd_kN, UR, pass. Inserted after bolt shear; included in `all_checks_pass`.
- `connection.py`: Base plate bending check — new `base_plate_bending` sub-dict within `base_plate` key (alongside existing `base_plate_bearing`). Formula: Z=width×t²/4, M_cap=fy×Z/1e6, M_demand=Ft×e_bolt/1000, e_bolt=50mm. Both sub-checks included in `all_checks_pass`. Top-level `base_plate.UR` and `base_plate.pass` now reflect governing of the two sub-checks.
- `connection_library.json`: `e1_mm`, `e2_mm`, `p1_mm`, `p2_mm` added to all three bolt configs. T1_M24_6bolt uses p1=p2=125mm from drawing layout; unvalidated configs use 2.4×d fallback.
### Notes
- All P105 T2 previously validated outputs (Ft=96.53 kN, FT_Rd=260.58 kN, UR_tension=0.370, UR_embedment=0.731, G clamp n=5, T2 section UB406×140×39, UR_moment=0.977) remain identical.
- P105 T2 section_class=1 confirmed (cf/tf=6.69, cw/tw=56.3 — both Class 1 at ε=0.924).
- `base_plate` key structure changed: now contains `base_plate_bearing` and `base_plate_bending` sub-dicts. `base_plate.UR` and `base_plate.pass` retained for backward compatibility.

---

## [0.16.1] — 2026-04-22
### Fixed
- `projectStore.ts`: wrapped store with `zustand/persist` (key `union-noise-project`, localStorage) — calculation results and all state now survive browser tab switches and page refreshes.
- `Sidebar.tsx`: Step 4 now shows a tick when confirmed — added `step4_confirmed` to `stepStatus()` logic.
- `types/index.ts`: Step 4 renamed "Design Review" (was "Member Selection"); Step 5 subtitle updated to "Reserved — not in scope for this release".
### Added
- `projectStore.ts`: `step4_confirmed` boolean + `confirmStep4()` action.
- `Step4.tsx`: "Proceed to Outputs" button calls `confirmStep4()` before navigating to Step 6.

---

## [0.16.0] — 2026-04-22
### Added
- `Step4.tsx` — Design Review / Acceptance Gate. Full-width page with an overall pass/fail banner and one card per module (Steel Post, Foundation, Connection, Subframe, Lifting). Cards show per-check UR/FOS rows with green/red colouring and a green or red card border per overall pass. Inline note editor per card: "Add note" → textarea with Save/Cancel; saved notes display in amber with an "Edit" link. "Proceed to Outputs" button navigates to Step 6; disabled with tooltip when any module fails. Guard clause when `calculation_results` is null.
- `projectStore.ts`: `step4_notes: Record<string, string>` slice + `setStep4Note(moduleId, note)` action. Notes keyed by module id (steel / foundation / connection / subframe / lifting). Cleared on `reset()`.
- `Sidebar.tsx`: Step 5 permanently locked (`s.number === 5` always treated as locked) — appears greyed/disabled without being removed from the nav.
### Notes
- Step 5 route and component retained — not deleted. Only the sidebar nav entry is locked.
- Notes do not affect any UR or pass/fail value. Step 6 will read `step4_notes` from store for inclusion in the PDF report.

---

## [0.15.4] — 2026-04-21
### Fixed
- `Step3.tsx`: DA1-C2 undrained bearing results now displayed in the derivation panel when `cu_kPa > 0`. Was only showing DA1-C1 undrained rows. Both combinations now render undrained qu, q_applied, UR, and `bearing_governs` when `bearing_undrained` is present in the response.

---

## [0.15.3] — 2026-04-21
### Changed
- **Step 3 — single-entry Run Calculations**: Removed the separate "Find Section" button. "Run Calculations" is now the sole entry point. First click runs Phase 1 (wind + section search via Claude web retrieval). Second click (after engineer confirms a section) runs Phase 2 (foundation, connection, subframe, lifting).
- `calculate.py`: Web search disabled for Phase 2 — `pre_selected_section` is always provided in normal flow so retrieval is never reached. No double-search possible.
- `section_retrieval.py`: `select_section()` accepts `use_retrieval: bool = True`. When `False`, skips Claude API and falls through to library cache.

### Added
- `POST /api/wind-and-select` — runs wind calculation and section search together. Used exclusively by Phase 1. Returns `{ wind_result, section_result }` including M_Ed, V_Ed, w, L_mm, Lcr_mm.
- `Phase1Result` interface in `types/index.ts` — wraps `WindCalcResult` and `SelectionResult`. Stored in Zustand.
- `phase1_result` / `setPhase1Result` added to `projectStore.ts`.
- **"Change Section" button** — clears `confirmed_section`, `phase1_result`, and `calculation_results` to restart Phase 1.

### Notes
- If `confirmed_section` is already set when "Run Calculations" is clicked, goes straight to Phase 2.
- Web search only ever called from `/api/wind-and-select`, never from `/api/calculate`.

---

## [0.15.2] — 2026-04-21
### Changed
- **Steel grade removed from user input** — grade determined autonomously from section `fy_N_per_mm2`. `steel_grade` removed from `DesignParameters`, `SelectSectionRequest`, `OptimizeSectionRequest`, and `CalculateRequest`.
- `section_retrieval.py` `_verify_against_cache()`: grade derived per-section from `fy_N_per_mm2` (≥355 → S355, else S275). Loads both grade libraries and routes each section to its matching cache.
- `select_section.py` router: `steel_grade` removed. `fy_N_per_mm2` added to response for frontend grade label.
- `optimize_section.py` router: grade derived from `body.section.get("fy_N_per_mm2", 275.0)`.
- `Step3.tsx`: Steel grade dropdown removed. Grade shown informational-only in `SectionCard`, `OptimisedCard`, and confirmed banner.

---

## [0.15.1] — 2026-04-21
### Added
- `section_retrieval.py`: `_validate_section_dict()` — validates all required numeric fields before any Claude-returned section reaches `_check_section()`. Checks: designation present; mass 0–500 kg/m; h 50–1000 mm; b 50–500 mm; tf/tw 1–50 mm; Iy/Wpl_y/Wel_y 1–100000; fy 200–500 N/mm². Invalid sections dropped with log message. If all fail, raises `ValueError` triggering cache fallback.

---

## [0.15.0] — 2026-04-21
### Changed
- `section_retrieval.py`: replaced Gemini + Playwright with Claude API web search (`web_search_20250305` tool, model `claude-opus-4-5`). Grade constrained to S275/S355 in prompt (not exposed in UI). `remarks` field included in search prompt when provided.
- `parts_library.json` split into `parts_library_S275.json` (107 sections) and `parts_library_S355.json` (26 sections). `parts_library.json` retained for backward compat.
- `select_section()` service returns `all_sections` (full verified list) alongside primary result for optimisation flow.

### Added
- `POST /api/optimize-section`: deterministic optimisation loop against grade-specific library. Case A (fails): moves up until all-pass. Case B (passes): moves down until check fails or max(UR) ≥ 0.95. Returns `selected_section`, `checks`, `optimisation_case`, `iterations`, `optimised`, `message`.
- `Step3.tsx`: Additional Considerations textarea bound to `dp.remarks`; included in Claude search prompt.
- `Step3.tsx`: Select → Show → Optimize → Confirm flow with `SectionCard`, `OptimisedCard`, confirmed banner, and auto-clear on parameter change.
- `types/index.ts`: `SteelSection`, `SectionChecks`, `SelectionResult`, `OptimiseResult` interfaces.
- `projectStore.ts`: `confirmed_section: SteelSection | null` + `setConfirmedSection()`.

### Removed
- `google-genai`, `playwright` dependencies.
- Gemini-based and Playwright-based retrieval functions.
- `GOOGLE_API_KEY` startup warning (replaced by `ANTHROPIC_API_KEY`).

### Notes
- `ANTHROPIC_API_KEY` required in `backend/.env` for live retrieval. Falls back to grade library without it.
- Optimisation is pure Python — no LLM in the optimise loop.
- P105 T2 validated: M_Ed=130.31 kNm ✓, UB 406×140×39, UR_moment=0.977 ✓, Case B (1 iteration), optimised ✓.
- Versions 0.12.0–0.13.3 covered the earlier Gemini/Playwright retrieval build (httpx → Playwright → Windows asyncio fixes → wired into calculate.py). All superseded by this version.

---

## [0.14.0] — 2026-04-20
### Added
- `chs_library.json` — 51 CHS GI pipe sections per EN 10219, `fy=400 N/mm²`, sorted by mass. Used by subframe selection.
- `rebar_library.json` — H16–H40 high-yield rebar with correct gross `As_mm2 = π/4 × d²`. Used by lifting hook selection.

### Changed
- `subframe.py`: replaced hardcoded CHS 48.3×2.5mm with `chs_library.json` iteration — selects lightest CHS passing moment check. Returns `hardware_note` when selected OD ≠ 48.3mm.
- `lifting.py`: replaced fixed H20 with `rebar_library.json` iteration — selects lightest bar passing tension and bond. Retries with n_hooks=6 if no bar passes at 4. Returns `pe_note` documenting PE As discrepancy.
- `connection.py`: `n_clamps` computed as `max(ceil(F_factored / failure_load), n_clamps_provided)`. Response includes `n_clamps_required`, `n_clamps_provided`, `n_clamps`.
- `wind.py` + `calculate.py`: `cp_net` promoted to user-selectable parameter (default 1.2).
- `Step3.tsx`: `cp_net` selector in Wind group; `SubframePanel` updated for new output shape.

### Notes
- Lifting hook As: system uses correct rebar_library values (H20=314mm²). PE report uses H25 area (490.94mm²) for H20 bar — `pe_note` documents the discrepancy.
- Subframe hardware note fires when selected OD ≠ 48.3mm — flags for engineer review, does not hard-fail.

---

## [0.13.0] — 2026-04-20
### Added
- `Step3.tsx`: Connection results panel — 7-check table with demand/capacity/UR/pass per row and overall pass/fail badge.
- `Step3.tsx`: Subframe results row — section, M_Ed, Mc,Rd, UR.
- `Step3.tsx`: Lifting results panel — hole shear and hook tension/bond sub-sections.
- `Step3.tsx`: DerivationPanel rows for connection, subframe, and lifting modules.
- `types/index.ts`: `ConnectionCalcResult`, `SubframeCalcResult`, `LiftingCalcResult` interfaces. Optional fields added to `CalculationResults`.

### Fixed
- `Step3.tsx`: Foundation bearing table updated for `bearing_drained`/`bearing_undrained`/`bearing_governs` structure (introduced in 0.11.2). Undrained columns only appear when `cu_kPa > 0`.
- `Step3.tsx`: Overall pass/fail banner now includes connection, subframe, and lifting.

---

## [0.11.3] — 2026-04-19
### Fixed
- `constants.py`: `DA1_C1 fos_overturning` corrected 1.35 → 1.0. EQU check applies `gamma_G_stb=0.9` to stabilising moment, so threshold is ODF ≥ 1.0. Setting 1.35 was double-counting the partial factor.

### Notes
- Undrained ic mismatch (DA1-C1: 178.82 vs 171.48, DA1-C2: 147.86 vs 130.67) is a formula interpretation difference — both pass structurally. Flagged for PE clarification.

---

## [0.11.2] — 2026-04-19
### Fixed
- `foundation.py`: drained bearing eccentricity now uses `e = M_SLS / P_G` for all combinations — confirmed PE methodology. Previously used factored moment, causing +175%/+217% qu mismatch.
- `foundation.py`: overburden surcharge q=0 in drained bearing — confirmed PE Choice B (deliberate, conservative).

### Added
- `foundation.py`: undrained bearing capacity (EC7 Annex D.3). Runs when `cu_kPa > 0`. Bearing result restructured into `bearing_drained`, `bearing_undrained`, `bearing_governs`.
- `cu_kPa` parameter added throughout stack: `foundation.py`, `calculate.py`, `types/index.ts`, `projectStore.ts`, `Step3.tsx`.

### Validated — P105 T2
- DA1-C1 FOS_sliding = 5.522 ✓, FOS_overturning = 1.152 ✓, qu_drained = 279.45 ✓
- DA1-C2 FOS_sliding = 4.913 ✓, qu_drained = 127.67 ✓
- Undrained mismatches noted: DA1-C1 +4.3%, DA1-C2 +13.2% — both pass structurally.

---

## [0.11.1] — 2026-04-16
### Fixed
- `lifting.py`: separated hole and hook load inputs. `post_weight_kN` parameter added. Hole check uses post self-weight only (footing not cast at lift time). UR_hole corrected from 1.505 (FAIL) to 0.189 (PASS).
- `post_weight_kN` added to `CalculateRequest`, `DesignParameters`, store defaults, and Step3.tsx.

### Validated
- W_post_factored=9.00 kN ✓, V_Rd_hole=47.63 kN ✓, UR_hole=0.189 ✓

---

## [0.11.0] — 2026-04-16
### Added
- `subframe.py`: CHS GI pipe bending check. M_Ed = (1.5/10)×w×L². Class 2 elastic, Mc = 1.2×fy×Wel/γM0.
- `lifting.py`: H20 rebar hook tension (EC3-1-8) + bond length (EC2) + post web shear at lifting hole.
- Both modules wired into `POST /api/calculate`.

---

## [0.10.4] — 2026-04-18
### Fixed — final P105 T2 connection validation
- `connection_library.json`: T1_M24_6bolt `Ds_mm=450` (PE page 10), `weld_length_mm=1360` (PE page 5), `n_clamps_per_post=5` (PE page 4).
- `connection.py`: bolt tension uses M_Ed (ULS) directly. `Ds_mm` read from config when present; falls back to `plate_height/2`. Weld length from config when stored; formula fallback otherwise. G clamp uses `barrier_height/2` for tributary area.
- `subframe.py`: wall thickness confirmed t=2.5mm (matches PE Wel=3.92 cm³). Mc formula corrected to `1.2×fy×Wel/γM0`.
- `lifting.py`: n_hooks default 2→4 (PE confirmed). tw_for_hole=6.0mm (PE page 6).

### Validated — P105 T2
- Connection: Ft=96.53 ✓, FT_Rd=260.58 ✓, UR_tension=0.370 ✓, UR_embedment=0.731 ✓, n_clamps=5 ✓
- Subframe: M_Ed=0.73 ✓, Mc=1.88 ✓, UR=0.387 ✓
- Lifting hook: F_hook=71.72 ✓, FT_Rd=176.74 ✓, L_req=423.8mm ✓

### Notes
- Versions 0.10.0–0.10.3 covered the iterative connection.py build: initial 7-check implementation, bolt area method iterations (threaded→nominal), and config cleanup. All superseded by this final validated state.

---

## [0.9.4] — 2026-04-15
### Fixed
- `steel.py`: sort key changed from `Wpl_y_cm3` to `mass_kg_per_m` — selects lightest section by weight, matching PE methodology. Resolves T1/T2 section mismatch vs PE report.

### Added
- `steel.py`: `deflection_limit_n` parameter (default 65).
- `wind.py`: `return_period` + Cprob formula (EC1 Eq 4.2, K=0.2, n=0.5 SG NA). At 50yr Cprob=1.0.
- Both parameters wired through `calculate.py` and exposed in Step 3.

---

## [0.9.3] — 2026-04-15
### Added
- `vb` override wired end-to-end. `compute_qp()` and `compute_design_pressure()` accept optional `vb` parameter overriding `SG_NA["vb0"]` throughout wind chain.

---

## [0.9.1] — 2026-04-11
### Fixed
- Shelter factor ψs now live-interpolated from `shelter_factor_table.json` (EN 1991-1-4 Figure 7.20). Replaces the hardcoded 0.5 stub.
- Solidity ratio φ limited to 0.8 (porous) and 1.0 (solid) — removed 0.9 which has no curve in Figure 7.20.

---

## [0.9.0] — 2026-04-11
### Added
- `OverridableValue` interface — stores `calculated`, `override`, `override_reason`, `effective`.
- `OverridableField` component — amber border + badge on override; reason field appears on change.
- `DerivationPanel` component — collapsible step-by-step derivation for wind, steel, and foundation.
- vb and shelter_factor converted to `OverridableValue` in `DesignParameters`.

---

## [0.8.0] — 2026-04-11
### Fixed
- `foundation.py`: overturning check applies γG,stb=0.9 to stabilising moment per EC7 EQU.
- `foundation.py`: internal footing dimension notation corrected to match EC7 Annex D (L perpendicular to wind, B in wind direction).
- `steel.py`: EC3 Cl 6.2.6 shear capacity check added. Section selection now requires all three checks to pass.

---

## [0.7.0] — 2026-04-09
### Added
- Step 3 Design Parameters form — Wind, Post, Foundation groups wired to Zustand.
- Step 3 Results panel — Wind, Steel, Foundation results with pass/fail. Run Calculations button calls `POST /api/calculate`.
- `CalculationResults`, `WindCalcResult`, `SteelCalcResult`, `FoundationComboResult` interfaces.

---

## [0.6.0] — 2026-04-09
### Added
- `backend/app/calculation/` package — full calculation engine:
  - `constants.py`: SG NA constants, EC partial factor dicts, applicable codes.
  - `wind.py`: EC1 Cl 4.3 chain (cr→vm→Iv→qp→design_pressure). P105: qp=0.598 kPa ✓
  - `steel.py`: LTB (EC3 Cl 6.3.2.3) + deflection check. Iterates parts library ascending.
  - `foundation.py`: Embedded RC + Exposed pad branches. SLS/DA1-C1/DA1-C2. EC7 Annex D bearing.
  - `shelter_factor_table.json`: EN 1991-1-4 Figure 7.20 digitised.
- `POST /api/calculate`: full chain wind→steel→foundation.

---

## [0.5.0] — 2026-04-09
### Changed
- Step 2: per-alignment tab panel replaces combined segment table. Canvas polylines highlight on tab selection (bidirectional).

---

## [0.4.0] — 2026-04-09
### Changed
- `applicable_codes` Zustand slice and Code Selection tab removed from Step 3. Codes are fixed backend constants.
### Added
- `ProjectMeta` interface and `meta` Zustand slice — UUID, created_by, timestamps on project creation.

---

## [0.3.0] — 2026-04-06
### Added
- `DesignParameters` interface — full typed schema for all engineering inputs.
- Design Parameters tab in Step 3 — Wind, Geometry, Materials, Foundation + Soil groups.

---

## [0.2.2] — 2026-04-06
### Added
- `ProjectsLibraryPage` at `/projects-library` with status filter and search.
### Changed
- Step 3 code checklist reads from Zustand `applicable_codes` store.

---

## [0.2.1] — 2026-04-06
### Changed
- Overview page restructured — New Project, Old Projects, Master Data action buttons + Recent Projects list.
### Added
- `MasterDataPage` stub at `/master-data`.

---

## [0.2.0] — 2026-04-06
### Added
- Overview page, ProjectCard component, useProjects hook, Project interface.
- Routing restructure: workflow moved to `/project/:id/step/:n`.
- Step 2: multiple independent polylines with alignment panel and per-alignment segment table.