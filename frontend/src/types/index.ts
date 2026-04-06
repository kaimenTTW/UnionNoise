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
