// ─── Domain types ────────────────────────────────────────────────────────────

export type BarrierType = 'Type 1' | 'Type 2' | 'Type 3'

export type SegmentTag = 'Standard' | 'Corner' | 'Gate' | 'End'

export type StepStatus = 'not-started' | 'in-progress' | 'complete'

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

export interface SegmentRow {
  /** Sequential label: A, B, C … Z, AA, AB … */
  id: string
  length_m: number
  tag: SegmentTag
}

export interface SiteData {
  /** Object URL of the uploaded site-plan image */
  site_plan_image: string | null
  /** Original filename for display */
  site_plan_filename: string | null
  calibration: CalibrationData
  /** Ordered list of polyline vertices in canvas pixel space */
  alignment_points: Array<{ x: number; y: number }>
  /** Auto-generated from alignment_points + calibration */
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
