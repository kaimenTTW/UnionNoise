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
  /** Basic wind velocity (m/s). Fixed SG NA constant: 20 m/s. */
  basic_wind_speed: number          // default 20
  /** Return period in years. User input — default 50yr. */
  return_period: number             // default 50
  /** Structure height from ground (m). Drives qp calculation. Sourced from project_info.barrier_height. */
  structure_height: number | null
  /** Shelter factor — user-confirmed per site. Default 1.0 (no shelter). */
  shelter_factor: number            // default 1.0
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

  // ── Materials ──
  /** Concrete grade — default C25/30 per PE reports. */
  concrete_grade: ConcreteGrade     // default 'C25/30'
  /** Steel grade — default S275 per PE reports. */
  steel_grade: SteelGrade           // default 'S275'
  /** Rebar grade */
  rebar_grade: RebarGrade           // default 'B500B'
  /** Bolt grade */
  bolt_grade: BoltGrade             // default '8.8'

  // ── Foundation ──
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

  // ── Soil (provisional — user-configurable, not hardcoded) ──
  // PROVISIONAL: pending SME validation — see PRD Section 2.5
  /** Soil friction angle φk (degrees). P105 confirmed: 30°. */
  phi_k: number                     // default 30
  /** Soil unit weight γs (kN/m³). P105 confirmed: 19 kN/m³. */
  gamma_s: number                   // default 19
  /** Soil cohesion c'k (kN/m²). P105 confirmed: 5 kN/m². */
  cohesion_ck: number               // default 5
}

// ─── Calculation results (returned from POST /api/calculate) ─────────────────

export interface WindCalcResult {
  ze_m: number
  cr: number
  vm_m_per_s: number
  Iv: number
  qp_N_per_m2: number
  qp_kPa: number
  cp_net: number
  shelter_factor: number
  design_pressure_kPa: number
}

export interface SteelCalcResult {
  designation?: string
  mass_kg_per_m?: number
  M_Ed_kNm?: number
  Mb_Rd_kNm?: number
  UR_moment?: number
  UR_deflection?: number
  delta_mm?: number
  delta_allow_mm?: number
  V_Ed_kN?: number
  Lcr_mm?: number
  pass: boolean
  error?: string
}

export interface FoundationComboResult {
  label: string
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
  bearing: {
    UR_bearing?: number | null
    qu_kPa?: number
    q_max_kPa?: number
    q_allow_kPa?: number
    q_applied_kPa?: number
  }
  pass_bearing: boolean
  pass: boolean
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
  { number: 4, title: 'Member Selection', subtitle: 'Choose structural members from library' },
  { number: 5, title: 'Verification', subtitle: 'Review utilisation ratios and acceptance' },
  { number: 6, title: 'Output Generation', subtitle: 'Generate drawings and design report' },
]
