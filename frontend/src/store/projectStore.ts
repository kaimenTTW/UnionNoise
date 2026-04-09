import { create } from 'zustand'
import type { BarrierType, CalibrationData, CalculationResults, DesignParameters, Polyline, ProjectInfo, ProjectMeta, SegmentRow, SiteData } from '../types'

interface ProjectStore {
  project_info: ProjectInfo
  site_data: SiteData
  meta: ProjectMeta
  design_parameters: DesignParameters
  calculation_results: CalculationResults | null
  step3_confirmed: boolean

  setProjectInfo: (partial: Partial<ProjectInfo>) => void
  setSiteData: (partial: Partial<SiteData>) => void
  setCalibration: (partial: Partial<CalibrationData>) => void

  // Polyline actions
  startNewPolyline: () => void
  addPolylinePoint: (polylineId: number, pt: { x: number; y: number }) => void
  undoLastPoint: (polylineId: number) => void
  deletePolyline: (polylineId: number) => void

  updateSegmentTag: (alignment_id: number, segment_id: string, tag: SegmentRow['tag']) => void
  setActiveAlignment: (id: number | null) => void
  setMeta: (partial: Partial<ProjectMeta>) => void
  initMeta: (createdBy: string) => void
  setDesignParameters: (partial: Partial<DesignParameters>) => void
  setCalculationResults: (results: CalculationResults) => void
  confirmStep1: () => void
  confirmStep2: () => void
  confirmStep3: () => void
  reset: () => void
}

const defaultProjectInfo: ProjectInfo = {
  project_name: '',
  location: '',
  barrier_height: null,
  barrier_type: null,
  foundation_constraint: '',
  scope_note: '',
  step1_confirmed: false,
}

// PROVISIONAL: defaults pending SME validation — see PRD Section 2.4 / 2.5
// Soil defaults updated to P105 confirmed values (φk=30°, γs=19 kN/m³, c'k=5 kN/m²)
const defaultDesignParameters: DesignParameters = {
  basic_wind_speed: 20,
  return_period: 50,
  structure_height: null,
  shelter_factor: 1.0,
  shelter_present: false,
  shelter_x: null,
  shelter_phi: null,
  wind_zone: null,
  lh_ratio: null,
  post_spacing: 3.0,
  subframe_spacing: 1.5,
  post_length: null,
  concrete_grade: 'C25/30',
  steel_grade: 'S275',
  rebar_grade: 'B500B',
  bolt_grade: '8.8',
  footing_type: null,
  allowable_soil_bearing: 75,
  footing_L_m: null,
  footing_B_m: null,
  footing_D_m: 0,
  vertical_load_G_kN: null,
  phi_k: 30,
  gamma_s: 19,
  cohesion_ck: 5,
}

const defaultMeta: ProjectMeta = {
  id: '',
  created_by: '',
  last_modified_by: '',
  created_at: '',
  updated_at: '',
}

const defaultSiteData: SiteData = {
  site_plan_image: null,
  site_plan_filename: null,
  calibration: {
    point_a: null,
    point_b: null,
    known_distance: null,
    px_per_m: null,
  },
  polylines: [],
  active_alignment_id: null,
  segment_table: [],
  step2_confirmed: false,
}

/** Convert zero-based index to spreadsheet-style label: 0→A, 25→Z, 26→AA … */
function indexToLabel(n: number): string {
  let label = ''
  let i = n
  do {
    label = String.fromCharCode(65 + (i % 26)) + label
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return label
}

function pixelDist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

/** Recompute segment table from all polylines and calibration.
 *  Segment IDs reset A, B, C… per alignment. Tags are preserved from existingTags. */
function buildSegmentTable(
  polylines: Polyline[],
  px_per_m: number | null,
  existingTags: Map<string, SegmentRow['tag']>,
): SegmentRow[] {
  const rows: SegmentRow[] = []
  for (const polyline of polylines) {
    const pts = polyline.points
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1].x - pts[i].x
      const dy = pts[i + 1].y - pts[i].y
      const px = Math.sqrt(dx * dx + dy * dy)
      const segment_id = indexToLabel(i)
      const key = `${polyline.id}-${segment_id}`
      const length_m = px_per_m != null && px_per_m > 0 ? parseFloat((px / px_per_m).toFixed(2)) : 0
      rows.push({
        alignment_id: polyline.id,
        segment_id,
        length_m,
        tag: existingTags.get(key) ?? 'Standard',
      })
    }
  }
  return rows
}

function getExistingTags(segment_table: SegmentRow[]): Map<string, SegmentRow['tag']> {
  return new Map(segment_table.map((r) => [`${r.alignment_id}-${r.segment_id}`, r.tag]))
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project_info: defaultProjectInfo,
  site_data: defaultSiteData,
  meta: defaultMeta,
  design_parameters: defaultDesignParameters,
  calculation_results: null,
  step3_confirmed: false,

  setProjectInfo: (partial) =>
    set((s) => ({ project_info: { ...s.project_info, ...partial } })),

  setSiteData: (partial) =>
    set((s) => ({ site_data: { ...s.site_data, ...partial } })),

  setCalibration: (partial) =>
    set((s) => {
      const calibration = { ...s.site_data.calibration, ...partial }
      const existingTags = getExistingTags(s.site_data.segment_table)
      const segment_table = buildSegmentTable(s.site_data.polylines, calibration.px_per_m, existingTags)
      return { site_data: { ...s.site_data, calibration, segment_table } }
    }),

  startNewPolyline: () =>
    set((s) => {
      const nextId = s.site_data.polylines.length + 1
      const polylines = [
        ...s.site_data.polylines.map((pl) => ({ ...pl, is_active: false })),
        { id: nextId, points: [], is_active: true },
      ]
      return { site_data: { ...s.site_data, polylines, active_alignment_id: nextId } }
    }),

  addPolylinePoint: (polylineId, pt) =>
    set((s) => {
      const polylines = s.site_data.polylines.map((pl) =>
        pl.id === polylineId ? { ...pl, points: [...pl.points, pt] } : pl,
      )
      const existingTags = getExistingTags(s.site_data.segment_table)
      const segment_table = buildSegmentTable(polylines, s.site_data.calibration.px_per_m, existingTags)
      return { site_data: { ...s.site_data, polylines, segment_table } }
    }),

  undoLastPoint: (polylineId) =>
    set((s) => {
      const polylines = s.site_data.polylines.map((pl) =>
        pl.id === polylineId ? { ...pl, points: pl.points.slice(0, -1) } : pl,
      )
      const existingTags = getExistingTags(s.site_data.segment_table)
      const segment_table = buildSegmentTable(polylines, s.site_data.calibration.px_per_m, existingTags)
      return { site_data: { ...s.site_data, polylines, segment_table } }
    }),

  deletePolyline: (polylineId) =>
    set((s) => {
      const remaining = s.site_data.polylines.filter((pl) => pl.id !== polylineId)
      const existingTags = getExistingTags(s.site_data.segment_table)
      const segment_table = buildSegmentTable(remaining, s.site_data.calibration.px_per_m, existingTags)
      const wasActive = s.site_data.active_alignment_id === polylineId
      const newActiveId = wasActive
        ? (remaining.length > 0 ? remaining[remaining.length - 1].id : null)
        : s.site_data.active_alignment_id
      const polylines = remaining.map((pl) => ({ ...pl, is_active: pl.id === newActiveId }))
      return { site_data: { ...s.site_data, polylines, segment_table, active_alignment_id: newActiveId } }
    }),

  updateSegmentTag: (alignment_id, segment_id, tag) =>
    set((s) => ({
      site_data: {
        ...s.site_data,
        segment_table: s.site_data.segment_table.map((r) =>
          r.alignment_id === alignment_id && r.segment_id === segment_id ? { ...r, tag } : r,
        ),
      },
    })),

  setActiveAlignment: (id) =>
    set((s) => ({
      site_data: {
        ...s.site_data,
        active_alignment_id: id,
        polylines: s.site_data.polylines.map((pl) => ({ ...pl, is_active: pl.id === id })),
      },
    })),

  setMeta: (partial) => set((s) => ({ meta: { ...s.meta, ...partial } })),

  initMeta: (createdBy) => {
    const now = new Date().toISOString()
    set({
      meta: {
        id: crypto.randomUUID(),
        created_by: createdBy,
        last_modified_by: createdBy,
        created_at: now,
        updated_at: now,
      },
    })
  },

  setDesignParameters: (partial) =>
    set((s) => ({ design_parameters: { ...s.design_parameters, ...partial } })),

  setCalculationResults: (results) => set({ calculation_results: results }),

  confirmStep1: () =>
    set((s) => ({
      project_info: { ...s.project_info, step1_confirmed: true },
    })),

  confirmStep2: () =>
    set((s) => ({
      site_data: { ...s.site_data, step2_confirmed: true },
    })),

  confirmStep3: () => set({ step3_confirmed: true }),

  reset: () =>
    set({ project_info: defaultProjectInfo, site_data: defaultSiteData, meta: defaultMeta, design_parameters: defaultDesignParameters, calculation_results: null, step3_confirmed: false }),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

/** Returns the step number that should be accessible (1-indexed). */
export function useUnlockedUpTo(): number {
  const { project_info, site_data } = useProjectStore()
  if (!project_info.step1_confirmed) return 1
  if (!site_data.step2_confirmed) return 2
  return 6
}

/** True when all required Step 1 fields are non-empty. */
export function useStep1Ready(): boolean {
  const pi = useProjectStore((s) => s.project_info)
  return (
    pi.project_name.trim() !== '' &&
    pi.location.trim() !== '' &&
    pi.barrier_height !== null &&
    pi.barrier_type !== null &&
    pi.foundation_constraint.trim() !== '' &&
    pi.scope_note.trim() !== ''
  )
}

// Mock data for demo/testing — no engineering values are hardcoded here
// PROVISIONAL: pending real project data for demo
export const MOCK_PROJECT_INFO: Omit<ProjectInfo, 'step1_confirmed'> & { barrier_type: BarrierType } = {
  project_name: 'CR208 Noise Barrier',
  location: 'Clementi Ave 3, Singapore',
  barrier_height: 6,
  barrier_type: 'Type 1',
  foundation_constraint: 'Embedded RC footing',
  scope_note: 'Temporary noise barrier for MRT construction works along Clementi Ave 3',
}
