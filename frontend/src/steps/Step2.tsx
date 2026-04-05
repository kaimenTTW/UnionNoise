import { fabric } from 'fabric'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type { SegmentRow } from '../types'

const CANVAS_W = 720
const CANVAS_H = 520
const CAL_COLOR = '#f59e0b'
const LINE_COLOR = '#3b82f6'
const DOT_COLOR = '#22c55e'
const TAG_OPTIONS: SegmentRow['tag'][] = ['Standard', 'Corner', 'Gate', 'End']

function pixelDist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

export default function Step2() {
  useStepGuard(2)
  const navigate = useNavigate()

  const { site_data, setSiteData, setCalibration, setAlignmentPoints, updateSegmentTag, confirmStep2 } =
    useProjectStore()

  // File input ref — triggered programmatically so no browser compat issues
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fabric mounts into this div imperatively — React never owns children here
  const fabricContainerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const [fabricError, setFabricError] = useState<string | null>(null)

  const [mode, setMode] = useState<'idle' | 'calibrating' | 'drawing'>('idle')
  const [calClickCount, setCalClickCount] = useState(0)
  const [calPoints, setCalPoints] = useState<[{ x: number; y: number } | null, { x: number; y: number } | null]>([null, null])
  const [knownDistance, setKnownDistance] = useState('')
  const [calDotObjects, setCalDotObjects] = useState<fabric.Circle[]>([])
  const [calLineObject, setCalLineObject] = useState<fabric.Line | null>(null)

  const lineObjectsRef = useRef<fabric.Line[]>([])
  const dotObjectsRef = useRef<fabric.Circle[]>([])

  // Refs so the mouse handler always sees current values without re-registering
  const modeRef = useRef(mode)
  const calClickCountRef = useRef(calClickCount)
  const knownDistanceRef = useRef(knownDistance)
  const alignmentPointsRef = useRef(site_data.alignment_points)
  const calPointsRef = useRef(calPoints)

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { calClickCountRef.current = calClickCount }, [calClickCount])
  useEffect(() => { knownDistanceRef.current = knownDistance }, [knownDistance])
  useEffect(() => { alignmentPointsRef.current = site_data.alignment_points }, [site_data.alignment_points])
  useEffect(() => { calPointsRef.current = calPoints }, [calPoints])

  // ── Initialise Fabric ───────────────────────────────────────────────────────

  useEffect(() => {
    const container = fabricContainerRef.current
    if (!container) return

    let fc: fabric.Canvas | null = null
    try {
      const canvasEl = document.createElement('canvas')
      container.appendChild(canvasEl)
      fc = new fabric.Canvas(canvasEl, {
        width: CANVAS_W,
        height: CANVAS_H,
        selection: false,
        backgroundColor: 'rgba(0,0,0,0)',
      })
      fabricRef.current = fc
    } catch (e) {
      setFabricError(String(e))
    }

    return () => {
      try { fc?.dispose() } catch { /* ignore */ }
      fabricRef.current = null
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])

  // ── Mouse handler ────────────────────────────────────────────────────────────

  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return

    const onMouseDown = (opt: fabric.IEvent<MouseEvent>) => {
      const pointer = fc.getPointer(opt.e)
      const pt = { x: Math.round(pointer.x), y: Math.round(pointer.y) }

      if (modeRef.current === 'calibrating') {
        const count = calClickCountRef.current
        const prev = calPointsRef.current
        const next: typeof prev = count === 0 ? [pt, null] : [prev[0], pt]
        setCalPoints(next)
        setCalClickCount(count + 1)

        const dot = new fabric.Circle({ left: pt.x - 5, top: pt.y - 5, radius: 5, fill: CAL_COLOR, selectable: false, evented: false })
        fc.add(dot)
        setCalDotObjects((d) => [...d, dot])

        if (count + 1 === 2 && next[0] && next[1]) {
          const dist = parseFloat(knownDistanceRef.current)
          if (dist > 0) {
            const px_per_m = pixelDist(next[0], next[1]) / dist
            const line = new fabric.Line([next[0].x, next[0].y, next[1].x, next[1].y], { stroke: CAL_COLOR, strokeWidth: 1.5, strokeDashArray: [4, 4], selectable: false, evented: false })
            fc.add(line)
            setCalLineObject(line)
            setCalibration({ point_a: next[0], point_b: next[1], known_distance: dist, px_per_m })
          }
          setMode('idle')
        }
      } else if (modeRef.current === 'drawing') {
        setAlignmentPoints([...alignmentPointsRef.current, pt])
      }
    }

    fc.on('mouse:down', onMouseDown)
    return () => { fc.off('mouse:down', onMouseDown) }
  }, [setCalibration, setAlignmentPoints])

  // ── Cursor ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (fabricRef.current) fabricRef.current.defaultCursor = mode === 'idle' ? 'default' : 'crosshair'
  }, [mode])

  // ── Redraw polyline ──────────────────────────────────────────────────────────

  const redrawPolyline = useCallback((points: Array<{ x: number; y: number }>) => {
    const fc = fabricRef.current
    if (!fc) return
    lineObjectsRef.current.forEach((o) => fc.remove(o))
    dotObjectsRef.current.forEach((o) => fc.remove(o))
    lineObjectsRef.current = []
    dotObjectsRef.current = []
    for (let i = 0; i < points.length - 1; i++) {
      const ln = new fabric.Line([points[i].x, points[i].y, points[i + 1].x, points[i + 1].y], { stroke: LINE_COLOR, strokeWidth: 2, selectable: false, evented: false })
      fc.add(ln)
      lineObjectsRef.current.push(ln)
    }
    points.forEach((p) => {
      const d = new fabric.Circle({ left: p.x - 4, top: p.y - 4, radius: 4, fill: DOT_COLOR, selectable: false, evented: false })
      fc.add(d)
      dotObjectsRef.current.push(d)
    })
    fc.renderAll()
  }, [])

  useEffect(() => { redrawPolyline(site_data.alignment_points) }, [site_data.alignment_points, redrawPolyline])

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleStartCalibration = () => {
    const dist = parseFloat(knownDistance)
    if (!knownDistance || isNaN(dist) || dist <= 0) return
    const fc = fabricRef.current
    if (fc) {
      calDotObjects.forEach((o) => fc.remove(o))
      if (calLineObject) fc.remove(calLineObject)
      fc.renderAll()
    }
    setCalDotObjects([])
    setCalLineObject(null)
    setCalPoints([null, null])
    setCalClickCount(0)
    setMode('calibrating')
  }

  const handleUndoPoint = () => {
    if (site_data.alignment_points.length > 0)
      setAlignmentPoints(site_data.alignment_points.slice(0, -1))
  }

  const handleClearAll = () => {
    setAlignmentPoints([])
    const fc = fabricRef.current
    if (fc) {
      lineObjectsRef.current.forEach((o) => fc.remove(o))
      dotObjectsRef.current.forEach((o) => fc.remove(o))
      lineObjectsRef.current = []
      dotObjectsRef.current = []
      fc.renderAll()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSiteData({ site_plan_image: URL.createObjectURL(file), site_plan_filename: file.name })
    // Reset input value so the same file can be re-selected
    e.target.value = ''
  }

  const handleConfirm = () => { confirmStep2(); navigate('/step/3') }

  const canConfirm = site_data.calibration.px_per_m !== null && site_data.segment_table.length >= 1
  const { px_per_m } = site_data.calibration
  const totalLength = site_data.segment_table.reduce((s, r) => s + r.length_m, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 2</span>
          <h1 className="step-title">Site Interpretation</h1>
        </div>
        <p className="step-subtitle">Upload the site plan, calibrate the scale, then draw the barrier alignment.</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left */}
        <div className="flex w-[60%] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-5">

          {/* Upload button — triggers hidden input programmatically */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
            >
              {site_data.site_plan_image ? 'Change Site Plan' : 'Upload Site Plan'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,application/pdf"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {site_data.site_plan_filename && (
              <span className="truncate max-w-xs text-sm text-muted">{site_data.site_plan_filename}</span>
            )}
          </div>

          {/* Canvas area */}
          <div
            className="relative rounded-lg border border-border bg-zinc-900 overflow-hidden"
            style={{ width: CANVAS_W, height: CANVAS_H, flexShrink: 0 }}
          >
            {/* Image/PDF layer — rendered behind the Fabric drawing overlay */}
            {site_data.site_plan_image ? (
              site_data.site_plan_filename?.toLowerCase().endsWith('.pdf') ? (
                <object
                  data={site_data.site_plan_image}
                  type="application/pdf"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}
                />
              ) : (
                <img
                  src={site_data.site_plan_image}
                  alt="Site plan"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', zIndex: 0, pointerEvents: 'none' }}
                />
              )
            ) : (
              <div style={{ position: 'absolute', inset: 0, zIndex: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="text-muted text-sm">
                Upload a site plan to begin
              </div>
            )}

            {/* Fabric drawing layer — React never renders children here */}
            <div
              ref={fabricContainerRef}
              style={{ position: 'absolute', inset: 0, zIndex: 1 }}
            />

            {fabricError && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                className="bg-danger/20 text-danger text-xs p-4 text-center">
                Canvas error: {fabricError}
              </div>
            )}
          </div>

          {/* Calibration */}
          <div className="panel space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Scale Calibration</p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="field-label">Known distance (m)</label>
                <input type="number" min={0.1} step={0.1} className="field-input" value={knownDistance}
                  onChange={(e) => setKnownDistance(e.target.value)} placeholder="e.g. 10" />
              </div>
              <button
                type="button"
                onClick={handleStartCalibration}
                disabled={!knownDistance || parseFloat(knownDistance) <= 0 || mode === 'drawing'}
                className={['btn-secondary whitespace-nowrap', mode === 'calibrating' ? 'border-warning text-warning' : ''].join(' ')}
              >
                {mode === 'calibrating' ? (calClickCount === 0 ? 'Click point A…' : 'Click point B…') : 'Click Two Points'}
              </button>
            </div>
            {px_per_m !== null && (
              <div className="rounded border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                Scale: <strong>{px_per_m.toFixed(2)} px/m</strong>
                {site_data.calibration.known_distance != null && (
                  <span className="ml-2 text-xs text-success/70">({site_data.calibration.known_distance} m reference)</span>
                )}
              </div>
            )}
            {mode === 'calibrating' && (
              <p className="text-xs text-warning">Click two points on the plan with a known real-world distance between them.</p>
            )}
          </div>

          {/* Drawing controls */}
          <div className="panel space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Barrier Digitisation</p>
            <div className="flex flex-wrap gap-2">
              <button type="button"
                onClick={() => setMode(mode === 'drawing' ? 'idle' : 'drawing')}
                disabled={mode === 'calibrating'}
                className={['btn-secondary', mode === 'drawing' ? 'border-accent text-accent' : ''].join(' ')}>
                {mode === 'drawing' ? 'Stop Drawing' : 'Start Drawing'}
              </button>
              <button type="button" onClick={handleUndoPoint} disabled={site_data.alignment_points.length === 0} className="btn-secondary">Undo Last Point</button>
              <button type="button" onClick={handleClearAll} disabled={site_data.alignment_points.length === 0} className="btn-secondary">Clear All</button>
            </div>
            {mode === 'drawing' && <p className="text-xs text-accent">Click on the canvas to place alignment vertices.</p>}
            {site_data.alignment_points.length > 0 && (
              <p className="text-xs text-muted">{site_data.alignment_points.length} vertices · {site_data.segment_table.length} segments</p>
            )}
          </div>
        </div>

        {/* Right: segment table */}
        <div className="flex flex-1 flex-col overflow-hidden p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-white">Segment Table</p>
            {site_data.segment_table.length > 0 && (
              <p className="text-xs text-muted">Total: <span className="font-semibold text-white">{totalLength.toFixed(2)} m</span></p>
            )}
          </div>

          {site_data.segment_table.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
              {px_per_m === null ? 'Calibrate scale first, then draw segments' : 'Draw the barrier alignment to generate segments'}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-panel text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 text-left">ID</th>
                    <th className="px-4 py-2.5 text-right">Length (m)</th>
                    <th className="px-4 py-2.5 text-left">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {site_data.segment_table.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 font-mono font-semibold text-accent">{row.id}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.length_m.toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <select className="field-input py-1 text-xs" value={row.tag}
                          onChange={(e) => updateSegmentTag(row.id, e.target.value as SegmentRow['tag'])}>
                          {TAG_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted">
              {canConfirm ? 'Scale calibrated and alignment drawn. Ready to confirm.' : 'Complete scale calibration and draw at least one segment.'}
            </p>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm || site_data.step2_confirmed} className="btn-success">
              {site_data.step2_confirmed ? 'Confirmed ✓' : 'Confirm Alignment →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
