import { create } from 'zustand'
import type { BarrierType, CalibrationData, CodeReference, DesignParameters, Polyline, ProjectInfo, SegmentRow, SiteData } from '../types'

interface ProjectStore {
  project_info: ProjectInfo
  site_data: SiteData
  applicable_codes: CodeReference[]
  design_parameters: DesignParameters
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
  toggleCode: (en_designation: string) => void
  setDesignParameters: (partial: Partial<DesignParameters>) => void
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
const defaultDesignParameters: DesignParameters = {
  basic_wind_speed: 20,
  return_period: 50,
  structure_height: null,
  shelter_factor: 1.0,
  wind_zone: null,
  lh_ratio: null,
  post_spacing: null,
  subframe_spacing: null,
  concrete_grade: 'C25/30',
  steel_grade: 'S275',
  rebar_grade: 'B500B',
  bolt_grade: '8.8',
  footing_type: null,
  allowable_soil_bearing: 75,
  phi_k: 30,
  gamma_s: 20,
  cohesion_ck: 0,
}

// Defaults per PRD v4 Section 2.3 — confirmed from PE calculation reports
const defaultApplicableCodes: CodeReference[] = [
  { en_designation: 'EN 1990:2002',                                         eurocode_label: 'Eurocode 0 — Basis of Structural Design',    governs: 'Basis of structural design',                        selected: true },
  { en_designation: 'EN 1991-1-1 to 1-7',                                  eurocode_label: 'Eurocode 1 — Actions on Structures',          governs: 'Actions on structures including wind',              selected: true },
  { en_designation: 'EN 1992-1-1:2004, EN 1992-1-2:2004, EN 1992-2:2005, EN 1992-3:2006', eurocode_label: 'Eurocode 2 — Design of Concrete Structures', governs: 'Design of concrete structures',                     selected: true },
  { en_designation: 'EN 1993-1-1 to 1-12 (incl. EN 1993-1-8:2005 joints)', eurocode_label: 'Eurocode 3 — Design of Steel Structures',     governs: 'Design of steel structures',                        selected: true },
  { en_designation: 'EN 1997-1:2004',                                       eurocode_label: 'Eurocode 7 — Geotechnical Design',            governs: 'Foundation design (DA1C1, DA1C2)',                   selected: true },
  { en_designation: 'NA to SS EN 1991-1-4:2009 (and related parts)',        eurocode_label: 'Singapore National Annex',                    governs: 'SG-specific parameters (terrain, wind, load combos)', selected: true },
  { en_designation: 'SS 602:2014',                                          eurocode_label: 'SS 602:2014',                                 governs: 'Noise control on construction sites',                selected: false },
]

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
  applicable_codes: defaultApplicableCodes,
  design_parameters: defaultDesignParameters,
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
      const polylines = [...s.site_data.polylines, { id: nextId, points: [] }]
      return { site_data: { ...s.site_data, polylines } }
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
      const polylines = s.site_data.polylines.filter((pl) => pl.id !== polylineId)
      const existingTags = getExistingTags(s.site_data.segment_table)
      const segment_table = buildSegmentTable(polylines, s.site_data.calibration.px_per_m, existingTags)
      return { site_data: { ...s.site_data, polylines, segment_table } }
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

  toggleCode: (en_designation) =>
    set((s) => ({
      applicable_codes: s.applicable_codes.map((c) =>
        c.en_designation === en_designation ? { ...c, selected: !c.selected } : c,
      ),
    })),

  setDesignParameters: (partial) =>
    set((s) => ({ design_parameters: { ...s.design_parameters, ...partial } })),

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
    set({ project_info: defaultProjectInfo, site_data: defaultSiteData, applicable_codes: defaultApplicableCodes, design_parameters: defaultDesignParameters, step3_confirmed: false }),
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
