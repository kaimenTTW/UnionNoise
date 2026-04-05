import { create } from 'zustand'
import type { BarrierType, CalibrationData, ProjectInfo, SegmentRow, SiteData } from '../types'

interface ProjectStore {
  project_info: ProjectInfo
  site_data: SiteData

  setProjectInfo: (partial: Partial<ProjectInfo>) => void
  setSiteData: (partial: Partial<SiteData>) => void
  setCalibration: (partial: Partial<CalibrationData>) => void
  setAlignmentPoints: (points: Array<{ x: number; y: number }>) => void
  updateSegmentTag: (id: string, tag: SegmentRow['tag']) => void
  confirmStep1: () => void
  confirmStep2: () => void
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

const defaultSiteData: SiteData = {
  site_plan_image: null,
  site_plan_filename: null,
  calibration: {
    point_a: null,
    point_b: null,
    known_distance: null,
    px_per_m: null,
  },
  alignment_points: [],
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

/** Recompute segment table from raw alignment points and calibration. */
function buildSegmentTable(
  points: Array<{ x: number; y: number }>,
  px_per_m: number | null,
  existingTags: Map<string, SegmentRow['tag']>,
): SegmentRow[] {
  if (points.length < 2) return []
  return points.slice(0, -1).map((p, i) => {
    const next = points[i + 1]
    const dx = next.x - p.x
    const dy = next.y - p.y
    const px = Math.sqrt(dx * dx + dy * dy)
    const id = indexToLabel(i)
    const length_m = px_per_m != null && px_per_m > 0 ? parseFloat((px / px_per_m).toFixed(2)) : 0
    return {
      id,
      length_m,
      tag: existingTags.get(id) ?? 'Standard',
    }
  })
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project_info: defaultProjectInfo,
  site_data: defaultSiteData,

  setProjectInfo: (partial) =>
    set((s) => ({ project_info: { ...s.project_info, ...partial } })),

  setSiteData: (partial) =>
    set((s) => ({ site_data: { ...s.site_data, ...partial } })),

  setCalibration: (partial) =>
    set((s) => {
      const calibration = { ...s.site_data.calibration, ...partial }
      // Recompute segment table if px_per_m changed
      const existingTags = new Map(
        s.site_data.segment_table.map((r) => [r.id, r.tag] as [string, SegmentRow['tag']]),
      )
      const segment_table = buildSegmentTable(
        s.site_data.alignment_points,
        calibration.px_per_m,
        existingTags,
      )
      return { site_data: { ...s.site_data, calibration, segment_table } }
    }),

  setAlignmentPoints: (points) =>
    set((s) => {
      const existingTags = new Map(
        s.site_data.segment_table.map((r) => [r.id, r.tag] as [string, SegmentRow['tag']]),
      )
      const segment_table = buildSegmentTable(
        points,
        s.site_data.calibration.px_per_m,
        existingTags,
      )
      return { site_data: { ...s.site_data, alignment_points: points, segment_table } }
    }),

  updateSegmentTag: (id, tag) =>
    set((s) => ({
      site_data: {
        ...s.site_data,
        segment_table: s.site_data.segment_table.map((r) =>
          r.id === id ? { ...r, tag } : r,
        ),
      },
    })),

  confirmStep1: () =>
    set((s) => ({
      project_info: { ...s.project_info, step1_confirmed: true },
    })),

  confirmStep2: () =>
    set((s) => ({
      site_data: { ...s.site_data, step2_confirmed: true },
    })),

  reset: () =>
    set({ project_info: defaultProjectInfo, site_data: defaultSiteData }),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

/** Returns the step number that should be accessible (1-indexed). */
export function useUnlockedUpTo(): number {
  const { project_info, site_data } = useProjectStore()
  if (!project_info.step1_confirmed) return 1
  if (!site_data.step2_confirmed) return 2
  return 6 // scaffolds 3–6 all accessible once step 2 is confirmed
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
