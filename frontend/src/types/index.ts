// ─── Overridable engineering value ───────────────────────────────────────────
// Any calculated or code-fixed value that requires engineering judgement override.
// See PRD Section 2 — Engineering Judgement Override Principle.

export interface OverridableValue {
  calculated: number        // system-computed or code-fixed value
  override: number | null   // null if not overridden
  override_reason: string   // required if override is set, empty string otherwise
  effective: number         // = override ?? calculated — used in all downstream calculations
}

// ─── Domain types ────────────────────────────────────────────────────────────

export type BarrierType = 'Type 1' | 'Type 2' | 'Type 3'

export type SegmentTag = 'Standard' | 'Corner' | 'Gate' | 'End'

export type StepStatus = 'not-started' | 'in-progress' | 'complete'

// ─── Project list (Overview page) ────────────────────────────────────────────

export interface Project {
  id: string
  project_name: string
  barrier_type: BarrierType
  location: string
  created_at: string        // ISO date string e.g. "2026-03-15"
  updated_at: string        // ISO timestamp
  created_by: string        // Free-text display name
  status: 'draft' | 'complete'
}

// ─── Project meta ─────────────────────────────────────────────────────────────

export interface ProjectMeta {
  id: string
  created_by: string
  last_modified_by: string
  created_at: string        // ISO timestamp
  updated_at: string        // ISO timestamp
}

// ─── Design parameters ───────────────────────────────────────────────────────
// PROVISIONAL: defaults pending SME validation — see PRD Section 2.4 / 2.5

export type WindZone = 'A' | 'B' | 'C' | 'D'
export type FootingType = 'Exposed pad' | 'Embedded RC'
export type ConcreteGrade = 'C25/30' | 'C28/35' | 'C30/37'
export type SteelGrade = 'S275' | 'S355'
export type RebarGrade = 'B500B' | 'B500C'
export type BoltGrade = '8.8' | '10.9'

export interface DesignParameters {
  // ── Wind ──
  /** Basic wind velocity (m/s). SG NA fixed at 20 m/s; overridable for site-specific conservatism. */
  vb: OverridableValue              // calculated=20.0
  /** Return period in years. User input — default 50yr. */
  return_period: number             // default 50
  /** Structure height from ground (m). Drives qp calculation. Sourced from project_info.barrier_height. */
  structure_height: number | null
  /** Shelter factor ψs — calculated from Figure 7.20 lookup; overridable by engineer judgement. */
  shelter_factor: OverridableValue  // calculated=1.0 (no shelter), or 0.5 stub (shelter present)
  /** Is there a sheltering structure upwind? Drives ψs derivation. */
  shelter_present: boolean          // default false
  /** Spacing from barrier to upwind sheltering structure x [m]. Required when shelter_present=true. */
  shelter_x: number | null
  /** Solidity ratio φ of upwind structure (0.8/0.9/1.0). Required when shelter_present=true. */
  shelter_phi: number | null
  /** Wind zone A/B/C/D per EC1 Table 7.9 — engineering judgement, user-confirmed. */
  wind_zone: WindZone | null
  /** Barrier length / barrier height ratio — used to look up cp from EC1 Table 7.9. */
  lh_ratio: number | null

  // ── Structural geometry ──
  /** Post spacing (m). Drives tributary area and member design. */
  post_spacing: number | null
  /** Subframe spacing (m). Drives Lcr for torsional buckling check. */
  subframe_spacing: number | null
  /** Post length above foundation level (m). T1: 11m, T2: 12.7m. */
  post_length: number | null
  /** Deflection limit denominator n for δ_allow = L/n. Default 65 (P105 confirmed). */
  deflection_limit_n: number

  // ── Materials ──
  /** Concrete grade — default C25/30 per PE reports. */
  concrete_grade: ConcreteGrade     // default 'C25/30'
  /** Rebar grade */
  rebar_grade: RebarGrade           // default 'B500B'
  /** Bolt grade */
  bolt_grade: BoltGrade             // default '8.8'

  // ── Foundation ──
  /** Concrete characteristic cylinder strength fck [N/mm²]. C25/30→25, C28/35→28, C30/37→30. */
  fck: number                        // default 25
  /** Footing type — drives which branch of the foundation module executes. */
  footing_type: FootingType | null
  /** Allowable soil bearing pressure (kPa). Default 75 kPa if no site investigation. */
  allowable_soil_bearing: number    // default 75
  /** Footing dimension along barrier / perpendicular to wind (m). Maps to API footing_W. */
  footing_L_m: number | null
  /** Footing dimension in wind direction (m). Maps to API footing_B. */
  footing_B_m: number | null
  /** Embedment depth below ground (m). 0 for exposed pad. */
  footing_D_m: number | null
  /** Permanent vertical load: post self-weight + footing weight (kN). */
  vertical_load_G_kN: number | null
  /** Steel post self-weight only (kN). Used for lifting hole shear check (footing not yet cast). */
  post_weight_kN: number              // default 6

  // ── Soil (provisional — user-configurable, not hardcoded) ──
  // PROVISIONAL: pending SME validation — see PRD Section 2.5
  /** Soil friction angle φk (degrees). P105 confirmed: 30°. */
  phi_k: number                     // default 30
  /** Soil unit weight γs (kN/m³). P105 confirmed: 19 kN/m³. */
  gamma_s: number                   // default 19
  /** Soil cohesion c'k (kN/m²). P105 confirmed: 5 kN/m². */
  cohesion_ck: number               // default 5
  /** Undrained shear strength cu (kPa). 0 = drained checks only. P105 T2 uses 30 kPa. */
  cu_kPa: number                    // default 0
  /** Net pressure coefficient cp,net. 1.2 = porous TNCB panels (default). 1.3 = solid panels. */
  cp_net: number                    // default 1.2
  /** Optional additional considerations for section search and PE report. */
  remarks: string                   // default ""
}

// ─── Steel section (from parts library or web search) ────────────────────────

export interface SteelSection {
  designation: string
  mass_kg_per_m: number
  h_mm: number
  b_mm: number
  tf_mm: number
  tw_mm: number
  r_mm: number
  Iy_cm4: number
  Iz_cm4: number
  Wpl_y_cm3: number
  Wel_y_cm3: number
  Iw_dm6: number
  It_cm4: number
  fy_N_per_mm2: number
}

// ─── Section selection result (from POST /api/select-section) ────────────────

export interface SectionChecks {
  UR_moment: number
  UR_deflection: number
  UR_shear: number
  pass: boolean
}

export interface SelectionResult {
  section: SteelSection
  checks: SectionChecks
  source: 'live' | 'cache' | 'pre_selected'
  fallback_reason?: string | null
  all_sections?: SteelSection[]
  // Demand values — needed to pass to optimize endpoint
  M_Ed_kNm: number
  V_Ed_kN: number
  w_kN_per_m: number
  L_mm: number
  Lcr_mm: number
}

// ─── Optimise result (from POST /api/optimize-section) ───────────────────────

export interface OptimiseResult {
  selected_section: SteelSection
  checks: SectionChecks
  optimisation_case: 'A' | 'B'
  iterations: number
  optimised: boolean
  message: string
}

// ─── Phase 1 result (returned from POST /api/wind-and-select) ────────────────
// Combines wind calculation and section search results. Stored in Zustand so
// the section card survives navigation between Step 3 tabs.

export interface Phase1Result {
  wind_result: WindCalcResult
  section_result: SelectionResult
}

// ─── Calculation results (returned from POST /api/calculate) ─────────────────

export interface WindCalcResult {
  ze_m: number
  cr: number
  vm_m_per_s: number
  Iv: number
  qp_N_per_m2: number
  qp_kPa: number
  // Added v0.8.0 — present in responses from backend v0.8.0+
  vb_m_per_s?: number
  cdir?: number
  cseason?: number
  return_period?: number
  Cprob?: number
  qb_N_per_m2?: number
  qb_kPa?: number
  cp_net: number
  shelter_factor: number
  design_pressure_kPa: number
}

export interface SteelCalcResult {
  designation?: string
  mass_kg_per_m?: number
  w_kN_per_m?: number
  M_Ed_kNm?: number
  V_Ed_kN?: number
  Mpl_kNm?: number
  Mcr_kNm?: number
  lambda_bar_LT?: number
  phi_LT?: number
  chi_LT?: number
  Mb_Rd_kNm?: number
  UR_moment?: number
  delta_mm?: number
  delta_allow_mm?: number
  UR_deflection?: number
  Av_mm2?: number
  Vc_kN?: number
  UR_shear?: number
  Lcr_mm?: number
  post_length_m?: number
  deflection_limit_n?: number
  selection_source?: string | null
  fallback_reason?: string | null
  pass: boolean
  error?: string
}

export interface FoundationComboResult {
  label: string
  phi_d_deg?: number          // design friction angle (added v0.8.0)
  H_factored_kN: number
  M_factored_kNm: number
  F_R_sliding_kN: number
  FOS_sliding: number
  pass_sliding: boolean
  fos_limit_sliding: number
  M_Rd_overturning_kNm: number
  FOS_overturning: number
  pass_overturning: boolean
  fos_limit_overturning: number
  bearing_drained: {
    UR_bearing?: number | null
    // Exposed pad fields
    e_m?: number
    b_prime_m?: number
    q_max_kPa?: number
    q_allow_kPa?: number
    // Embedded RC fields
    B_prime_m?: number
    qu_kPa?: number
    q_applied_kPa?: number
    phi_d_deg?: number
    Nq?: number
    Nc?: number
    Ny?: number
    sq?: number
    sc?: number
    sy?: number
  }
  bearing_undrained?: {
    sc?: number
    ic?: number
    bc?: number
    qu_kPa?: number
    q_applied_kPa?: number
    UR_bearing?: number | null
  } | null
  bearing_governs?: 'drained' | 'undrained' | null
  pass_bearing: boolean
  pass: boolean
}

export interface ConnectionCalcResult {
  config_id?: string
  bolt_tension?: {
    M_Ed_kNm?: number
    Ds_mm?: number
    T_total_kN?: number
    n_tension?: number
    Ft_per_bolt_kN?: number
    fub_N_per_mm2?: number
    As_mm2?: number
    FT_Rd_kN?: number
    UR?: number
    pass?: boolean
  }
  bolt_shear?: {
    Fv_per_bolt_kN?: number
    Fv_Rd_kN?: number
    UR?: number
    pass?: boolean
  }
  bolt_combined?: { UR?: number; pass?: boolean }
  bolt_embedment?: {
    fbd_N_per_mm2?: number
    L_required_mm?: number
    L_provided_mm?: number
    UR?: number
    pass?: boolean
  }
  weld?: {
    weld_length_mm?: number
    FR_N_per_mm?: number
    Fw_Rd_N_per_mm?: number
    UR?: number
    pass?: boolean
  }
  base_plate?: {
    compression_resistance_kN?: number
    UR?: number
    pass?: boolean
  }
  g_clamp?: {
    F_per_clamp_kN?: number
    failure_load_kN?: number
    n_clamps?: number
    UR?: number
    pass?: boolean
  }
  all_checks_pass?: boolean
}

export interface SubframeCalcResult {
  designation?: string
  od_mm?: number
  t_mm?: number
  mass_kg_per_m?: number
  w_kN_per_m?: number
  M_Ed_kNm?: number
  Mc_Rd_kNm?: number
  UR_subframe?: number
  hardware_note?: string | null
  pass?: boolean
  error?: string
}

export interface LiftingCalcResult {
  hook?: {
    n_hooks?: number
    W_factored_kN?: number
    F_hook_kN?: number
    FT_Rd_kN?: number
    UR_tension?: number
    fbd_N_per_mm2?: number
    L_required_mm?: number
    L_provided_mm?: number
    UR_bond?: number
    pass_tension?: boolean
    pass_bond?: boolean
  }
  hole?: {
    post_weight_kN?: number
    W_post_factored_kN?: number
    Av_mm2?: number
    V_Rd_kN?: number          // backend key: V_Rd_kN
    UR_shear?: number          // backend key: UR_shear
    pass_shear?: boolean
  }
  all_checks_pass?: boolean
}

export interface CalculationResults {
  wind: WindCalcResult
  steel: SteelCalcResult
  foundation: {
    footing_type: string
    SLS: FoundationComboResult
    DA1_C1: FoundationComboResult
    DA1_C2: FoundationComboResult
    pass: boolean
  }
  connection?: ConnectionCalcResult | null
  subframe?: SubframeCalcResult | null
  lifting?: LiftingCalcResult | null
}

// ─── ProjectContext slices ────────────────────────────────────────────────────

export interface ProjectInfo {
  project_name: string
  location: string
  barrier_height: number | null
  barrier_type: BarrierType | null
  foundation_constraint: string
  scope_note: string
  step1_confirmed: boolean
}

export interface CalibrationData {
  point_a: { x: number; y: number } | null
  point_b: { x: number; y: number } | null
  known_distance: number | null
  /** Computed: pixels per metre. Null until calibration is complete. */
  px_per_m: number | null
}

/** A single drawn polyline (one alignment). id is 1-based. */
export interface Polyline {
  id: number                          // Alignment number: 1, 2, 3…
  points: { x: number; y: number }[]  // Canvas coordinates
  is_active: boolean                  // Whether this alignment is selected/highlighted on canvas
}

export interface SegmentRow {
  alignment_id: number    // Which polyline this segment belongs to
  segment_id: string      // A, B, C… resets per alignment
  length_m: number
  tag: SegmentTag
}

export interface SiteData {
  /** Object URL of the uploaded site-plan image */
  site_plan_image: string | null
  /** Original filename for display */
  site_plan_filename: string | null
  calibration: CalibrationData
  /** Multiple independent alignments drawn on the canvas */
  polylines: Polyline[]
  /** Which alignment tab/polyline is currently selected */
  active_alignment_id: number | null
  /** Auto-generated from polylines + calibration — flattened across all alignments */
  segment_table: SegmentRow[]
  step2_confirmed: boolean
}

// ─── API response shape ───────────────────────────────────────────────────────

export interface ExtractedParameters {
  project_name: string
  location: string
  barrier_height: number | null
  barrier_type: BarrierType | null
  foundation_constraint: string
  scope_note: string
}

// ─── Step metadata ────────────────────────────────────────────────────────────

export interface StepMeta {
  number: number
  title: string
  subtitle: string
}

export const STEPS: StepMeta[] = [
  { number: 1, title: 'Project Setup', subtitle: 'Extract design parameters from brief' },
  { number: 2, title: 'Site Interpretation', subtitle: 'Calibrate plan and digitise alignment' },
  { number: 3, title: 'Design Workspace', subtitle: 'Select codes and run calculations' },
  { number: 4, title: 'Design Review', subtitle: 'Review utilisation ratios and accept the design' },
  { number: 5, title: 'Verification', subtitle: 'Reserved — not in scope for this release' },
  { number: 6, title: 'Output Generation', subtitle: 'Generate drawings and design report' },
]
