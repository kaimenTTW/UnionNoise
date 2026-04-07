// ─── Domain types ────────────────────────────────────────────────────────────

export type BarrierType = 'Type 1' | 'Type 2' | 'Type 3'

export type SegmentTag = 'Standard' | 'Corner' | 'Gate' | 'End'

export type StepStatus = 'not-started' | 'in-progress' | 'complete'

// ─── Code references ─────────────────────────────────────────────────────────

export interface CodeReference {
  /** Formal EN designation — stored in ProjectContext, cited verbatim in PE report Section 3 */
  en_designation: string    // e.g. "EN 1990:2002"
  /** Human-readable Eurocode label shown as subtitle */
  eurocode_label: string    // e.g. "Eurocode 0 — Basis of Structural Design"
  /** Brief description of what this code governs */
  governs: string
  selected: boolean
}

// ─── Project list (Overview page) ────────────────────────────────────────────

export interface Project {
  id: string
  project_name: string
  barrier_type: BarrierType
  location: string
  created_at: string        // ISO date string e.g. "2026-03-15"
  status: 'draft' | 'complete'
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
  /** Structure height from ground (m). Drives qp calculation. */
  structure_height: number | null
  /** Shelter factor — user-confirmed per site. Default 1.0 (no shelter). */
  shelter_factor: number            // default 1.0
  /** Wind zone A/B/C/D per EC1 Table 7.9 — engineering judgement, user-confirmed. */
  wind_zone: WindZone | null
  /** Barrier length / barrier height ratio — used to look up cp from EC1 Table 7.9. */
  lh_ratio: number | null

  // ── Structural geometry ──
  /** Post spacing (m). Drives tributary area and member design. */
  post_spacing: number | null
  /** Subframe spacing (m). Drives Lcr for torsional buckling check. */
  subframe_spacing: number | null

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

  // ── Soil (provisional — user-configurable, not hardcoded) ──
  // PROVISIONAL: pending SME validation — see PRD Section 2.5
  /** Soil friction angle φk (degrees). Default 30°. */
  phi_k: number                     // default 30
  /** Soil unit weight γs (kN/m³). Default 20. */
  gamma_s: number                   // default 20
  /** Soil cohesion c'k (kN/m²). Default 0. */
  cohesion_ck: number               // default 0
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
