# CHANGELOG

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
