# CHANGELOG

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