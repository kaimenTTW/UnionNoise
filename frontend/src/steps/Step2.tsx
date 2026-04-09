import { fabric } from 'fabric'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePdfRenderer } from '../hooks/usePdfRenderer'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type { SegmentRow } from '../types'

const CANVAS_W = 740
const CANVAS_H = 540
const CAL_COLOR = '#f59e0b'
const LINE_COLOR = '#3b82f6'
const LINE_COLOR_ACTIVE = '#f59e0b'
const DOT_COLOR = '#22c55e'
const DOT_COLOR_INACTIVE = '#6b7280'
const TAG_OPTIONS: SegmentRow['tag'][] = ['Standard', 'Corner', 'Gate', 'End']
const MIN_ZOOM = 0.3
const MAX_ZOOM = 10
const PROXIMITY_THRESHOLD = 10  // canvas px

function pixelDist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
}

/** Shortest distance from point (px, py) to line segment (x1,y1)–(x2,y2). */
function distPointToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.sqrt((px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2)
}

interface PolylineCanvasObjects {
  lines: fabric.Line[]
  dots: fabric.Circle[]
}

export default function Step2() {
  useStepGuard(2)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const {
    site_data,
    setSiteData,
    setCalibration,
    startNewPolyline,
    addPolylinePoint,
    undoLastPoint,
    deletePolyline,
    updateSegmentTag,
    setActiveAlignment,
    confirmStep2,
  } = useProjectStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const isPdf = selectedFile?.type === 'application/pdf'

  const pdf = usePdfRenderer(isPdf ? selectedFile : null, 2)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(site_data.site_plan_image)

  useEffect(() => {
    if (pdf.dataUrl) setImageDataUrl(pdf.dataUrl)
  }, [pdf.dataUrl])

  // Fabric canvas
  const fabricContainerRef = useRef<HTMLDivElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const bgImageRef = useRef<fabric.Image | null>(null)
  const [fabricReady, setFabricReady] = useState(false)
  const [fabricError, setFabricError] = useState<string | null>(null)

  const [mode, setMode] = useState<'idle' | 'calibrating' | 'drawing'>('idle')
  const [calClickCount, setCalClickCount] = useState(0)
  const [calPoints, setCalPoints] = useState<[{ x: number; y: number } | null, { x: number; y: number } | null]>([null, null])
  const [knownDistance, setKnownDistance] = useState('')
  const [calDotObjects, setCalDotObjects] = useState<fabric.Circle[]>([])
  const [calLineObject, setCalLineObject] = useState<fabric.Line | null>(null)

  // Per-polyline canvas objects
  const polylinesOnCanvasRef = useRef<Map<number, PolylineCanvasObjects>>(new Map())

  // Which polyline is actively being drawn (null when not drawing)
  const [activePolylineId, setActivePolylineId] = useState<number | null>(null)

  // Stable refs for mouse handler (avoids stale closures in Fabric event callbacks)
  const modeRef = useRef(mode)
  const calClickCountRef = useRef(calClickCount)
  const knownDistanceRef = useRef(knownDistance)
  const calPointsRef = useRef(calPoints)
  const activePolylineIdRef = useRef(activePolylineId)
  const polylinesRef = useRef(site_data.polylines)
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { calClickCountRef.current = calClickCount }, [calClickCount])
  useEffect(() => { knownDistanceRef.current = knownDistance }, [knownDistance])
  useEffect(() => { calPointsRef.current = calPoints }, [calPoints])
  useEffect(() => { activePolylineIdRef.current = activePolylineId }, [activePolylineId])
  useEffect(() => { polylinesRef.current = site_data.polylines }, [site_data.polylines])

  // ── Init Fabric ───────────────────────────────────────────────────────────

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
        backgroundColor: '#18181b',
      })
      fabricRef.current = fc
      setFabricReady(true)
    } catch (e) {
      setFabricError(String(e))
      return
    }

    // Zoom: mouse wheel
    fc.on('mouse:wheel', (opt) => {
      const delta = (opt.e as WheelEvent).deltaY
      let zoom = fc!.getZoom()
      zoom *= 0.999 ** delta
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
      fc!.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom)
      opt.e.preventDefault()
      opt.e.stopPropagation()
    })

    // Pan: alt + drag
    let isPanning = false
    let lastPos = { x: 0, y: 0 }

    fc.on('mouse:down', (opt) => {
      if (opt.e.altKey) {
        isPanning = true
        fc!.defaultCursor = 'grabbing'
        lastPos = { x: opt.e.clientX, y: opt.e.clientY }
        opt.e.preventDefault()
      }
    })

    fc.on('mouse:move', (opt) => {
      if (!isPanning) return
      const dx = opt.e.clientX - lastPos.x
      const dy = opt.e.clientY - lastPos.y
      const vpt = fc!.viewportTransform
      if (vpt) {
        vpt[4] += dx
        vpt[5] += dy
        fc!.requestRenderAll()
      }
      lastPos = { x: opt.e.clientX, y: opt.e.clientY }
      opt.e.preventDefault()
    })

    fc.on('mouse:up', () => {
      isPanning = false
      fc!.defaultCursor = modeRef.current === 'idle' ? 'default' : 'crosshair'
    })

    return () => {
      try { fc?.dispose() } catch { /* ignore */ }
      fabricRef.current = null
      setFabricReady(false)
      polylinesOnCanvasRef.current.clear()
      while (container.firstChild) container.removeChild(container.firstChild)
    }
  }, [])

  // ── Load image into Fabric as background ─────────────────────────────────

  useEffect(() => {
    const fc = fabricRef.current
    if (!fc || !imageDataUrl) return

    const imgEl = new Image()
    imgEl.onload = () => {
      const fc2 = fabricRef.current
      if (!fc2) return

      if (bgImageRef.current) {
        fc2.remove(bgImageRef.current)
        bgImageRef.current = null
      }

      const scale = Math.min(CANVAS_W / imgEl.naturalWidth, CANVAS_H / imgEl.naturalHeight)
      const left = (CANVAS_W - imgEl.naturalWidth * scale) / 2
      const top = (CANVAS_H - imgEl.naturalHeight * scale) / 2

      const fabricImg = new fabric.Image(imgEl, {
        left, top, scaleX: scale, scaleY: scale,
        selectable: false, evented: false,
        lockMovementX: true, lockMovementY: true,
      })
      fc2.add(fabricImg)
      fc2.sendToBack(fabricImg)
      bgImageRef.current = fabricImg
      fc2.requestRenderAll()
    }
    imgEl.src = imageDataUrl
  }, [imageDataUrl])

  // ── Reset zoom/pan ────────────────────────────────────────────────────────

  const resetView = () => {
    const fc = fabricRef.current
    if (!fc) return
    fc.setViewportTransform([1, 0, 0, 1, 0, 0])
    fc.requestRenderAll()
  }

  // ── Click handler: calibration + drawing + idle polyline selection ────────

  useEffect(() => {
    const fc = fabricRef.current
    if (!fc || !fabricReady) return

    const onMouseDown = (opt: fabric.IEvent<MouseEvent>) => {
      if (opt.e.altKey) return

      const pointer = fc.getPointer(opt.e)
      const pt = { x: Math.round(pointer.x), y: Math.round(pointer.y) }

      if (modeRef.current === 'calibrating') {
        const count = calClickCountRef.current
        const prev = calPointsRef.current
        const next: typeof prev = count === 0 ? [pt, null] : [prev[0], pt]
        setCalPoints(next)
        setCalClickCount(count + 1)

        const dot = new fabric.Circle({
          left: pt.x - 5, top: pt.y - 5, radius: 5,
          fill: CAL_COLOR, selectable: false, evented: false,
        })
        fc.add(dot)
        setCalDotObjects((d) => [...d, dot])

        if (count + 1 === 2 && next[0] && next[1]) {
          const dist = parseFloat(knownDistanceRef.current)
          if (dist > 0) {
            const px_per_m = pixelDist(next[0], next[1]) / dist
            const line = new fabric.Line(
              [next[0].x, next[0].y, next[1].x, next[1].y],
              { stroke: CAL_COLOR, strokeWidth: 1.5, strokeDashArray: [4, 4], selectable: false, evented: false },
            )
            fc.add(line)
            setCalLineObject(line)
            setCalibration({ point_a: next[0], point_b: next[1], known_distance: dist, px_per_m })
          }
          setMode('idle')
        }
      } else if (modeRef.current === 'drawing' && activePolylineIdRef.current !== null) {
        addPolylinePoint(activePolylineIdRef.current, pt)
      } else if (modeRef.current === 'idle') {
        // Proximity check — select nearest polyline within threshold
        let closestId: number | null = null
        let closestDist = PROXIMITY_THRESHOLD
        for (const polyline of polylinesRef.current) {
          const pts = polyline.points
          for (let i = 0; i < pts.length - 1; i++) {
            const d = distPointToSegment(
              pt.x, pt.y,
              pts[i].x, pts[i].y,
              pts[i + 1].x, pts[i + 1].y,
            )
            if (d < closestDist) {
              closestDist = d
              closestId = polyline.id
            }
          }
        }
        if (closestId !== null) {
          setActiveAlignment(closestId)
        }
      }
    }

    fc.on('mouse:down', onMouseDown)
    return () => { (fc as fabric.Canvas & { off: (event: string, handler: unknown) => void }).off('mouse:down', onMouseDown) }
  }, [fabricReady, setCalibration, addPolylinePoint, setActiveAlignment])

  // ── Cursor ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return
    fc.defaultCursor = mode === 'idle' ? 'default' : 'crosshair'
  }, [mode])

  // ── Redraw all polylines — active gets amber highlight ────────────────────

  const redrawAllPolylines = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return

    polylinesOnCanvasRef.current.forEach(({ lines, dots }) => {
      lines.forEach((o) => fc.remove(o))
      dots.forEach((o) => fc.remove(o))
    })
    polylinesOnCanvasRef.current.clear()

    for (const polyline of site_data.polylines) {
      const pts = polyline.points
      const strokeColor = polyline.is_active ? LINE_COLOR_ACTIVE : LINE_COLOR
      const strokeW = polyline.is_active ? 3 : 1.5
      const dotColor = polyline.is_active ? DOT_COLOR : DOT_COLOR_INACTIVE
      const lines: fabric.Line[] = []
      const dots: fabric.Circle[] = []

      for (let i = 0; i < pts.length - 1; i++) {
        const ln = new fabric.Line(
          [pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y],
          { stroke: strokeColor, strokeWidth: strokeW, selectable: false, evented: false },
        )
        fc.add(ln)
        lines.push(ln)
      }
      pts.forEach((p) => {
        const d = new fabric.Circle({
          left: p.x - 4, top: p.y - 4, radius: 4,
          fill: dotColor, selectable: false, evented: false,
        })
        fc.add(d)
        dots.push(d)
      })

      polylinesOnCanvasRef.current.set(polyline.id, { lines, dots })
    }

    fc.requestRenderAll()
  }, [site_data.polylines])

  useEffect(() => { redrawAllPolylines() }, [redrawAllPolylines])

  // ── File selection ────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setSiteData({ site_plan_filename: file.name })

    if (file.type !== 'application/pdf') {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const url = ev.target?.result as string
        setImageDataUrl(url)
        setSiteData({ site_plan_image: url, site_plan_filename: file.name })
      }
      reader.readAsDataURL(file)
    } else {
      setSiteData({ site_plan_image: null, site_plan_filename: file.name })
      setImageDataUrl(null)
    }
    e.target.value = ''
  }

  useEffect(() => {
    if (pdf.dataUrl) {
      setImageDataUrl(pdf.dataUrl)
      setSiteData({ site_plan_image: pdf.dataUrl })
    }
  }, [pdf.dataUrl, setSiteData])

  // ── Calibration ───────────────────────────────────────────────────────────

  const handleStartCalibration = () => {
    const dist = parseFloat(knownDistance)
    if (!knownDistance || isNaN(dist) || dist <= 0) return
    const fc = fabricRef.current
    if (fc) {
      calDotObjects.forEach((o) => fc.remove(o))
      if (calLineObject) fc.remove(calLineObject)
      fc.requestRenderAll()
    }
    setCalDotObjects([])
    setCalLineObject(null)
    setCalPoints([null, null])
    setCalClickCount(0)
    setMode('calibrating')
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  const handleStartDrawing = () => {
    startNewPolyline()  // store: creates polyline, sets it as active_alignment_id
    const nextId = site_data.polylines.length + 1
    setActivePolylineId(nextId)
    setMode('drawing')
  }

  const handleStopDrawing = () => {
    setMode('idle')
    setActivePolylineId(null)
    // active_alignment_id stays on the just-completed polyline
  }

  const handleUndoPoint = () => {
    if (activePolylineId !== null) {
      undoLastPoint(activePolylineId)
    }
  }

  const handleDeleteSelected = () => {
    const targetId = site_data.active_alignment_id
    if (targetId === null) return
    deletePolyline(targetId)
    if (activePolylineId === targetId) {
      setActivePolylineId(null)
      setMode('idle')
    }
  }

  const handleClearAll = () => {
    const ids = site_data.polylines.map((pl) => pl.id)
    ids.forEach((pid) => deletePolyline(pid))
    setActivePolylineId(null)
    setMode('idle')
  }

  const handleConfirm = () => { confirmStep2(); navigate(`/project/${id}/step/3`) }

  // ── Derived values ────────────────────────────────────────────────────────

  const { px_per_m } = site_data.calibration
  const totalSegments = site_data.segment_table.length
  const totalVertices = site_data.polylines.reduce((s, p) => s + p.points.length, 0)
  const canConfirm = px_per_m !== null && totalSegments >= 1
  const isLoading = pdf.loading

  const activeAlignmentId = site_data.active_alignment_id
  const activeSegments = site_data.segment_table.filter((r) => r.alignment_id === activeAlignmentId)
  const activeTotalLength = activeSegments.reduce((s, r) => s + r.length_m, 0)

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

        {/* ── Left column: canvas + controls ─────────────────────────────── */}
        <div className="flex w-[62%] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-5">

          {/* Upload row */}
          <div className="flex items-center gap-3">
            <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
              {site_data.site_plan_filename ? 'Change Site Plan' : 'Upload Site Plan'}
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
            {isLoading && <span className="text-xs text-warning">Rendering PDF…</span>}
            {pdf.error && <span className="text-xs text-danger">PDF error: {pdf.error}</span>}
          </div>

          <p className="text-xs text-muted -mt-2">
            Scroll to zoom · Alt + drag to pan ·{' '}
            <button type="button" className="underline hover:text-white" onClick={resetView}>Reset view</button>
          </p>

          {/* Canvas */}
          <div
            className="rounded-lg border border-border overflow-hidden"
            style={{ width: CANVAS_W, height: CANVAS_H, flexShrink: 0, position: 'relative' }}
          >
            <div ref={fabricContainerRef} style={{ width: CANVAS_W, height: CANVAS_H }} />

            {!imageDataUrl && !isLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
                className="text-muted text-sm">
                Upload a site plan to begin
              </div>
            )}
            {isLoading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
                className="text-muted text-sm gap-2 flex">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted/30 border-t-muted" />
                Rendering PDF…
              </div>
            )}
            {fabricError && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
              <button type="button" onClick={handleStartCalibration}
                disabled={!knownDistance || parseFloat(knownDistance) <= 0 || mode === 'drawing'}
                className={['btn-secondary whitespace-nowrap', mode === 'calibrating' ? 'border-warning text-warning' : ''].join(' ')}>
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
              {mode === 'drawing' ? (
                <button type="button" onClick={handleStopDrawing}
                  className="btn-secondary border-accent text-accent">
                  Stop Drawing
                </button>
              ) : (
                <button type="button" onClick={handleStartDrawing}
                  disabled={mode === 'calibrating'}
                  className="btn-secondary">
                  Start Drawing
                </button>
              )}
              <button type="button" onClick={handleUndoPoint}
                disabled={mode !== 'drawing' || activePolylineId === null}
                className="btn-secondary">
                Undo Last Point
              </button>
              <button type="button" onClick={handleDeleteSelected}
                disabled={activeAlignmentId === null || mode === 'calibrating'}
                className="btn-secondary">
                Delete Selected
              </button>
              <button type="button" onClick={handleClearAll}
                disabled={site_data.polylines.length === 0}
                className="btn-secondary">
                Clear All
              </button>
            </div>
            {mode === 'drawing' && activePolylineId !== null && (
              <p className="text-xs text-accent">
                Drawing Alignment {activePolylineId} — click on the canvas to place vertices.
              </p>
            )}
            {mode === 'idle' && site_data.polylines.length > 0 && (
              <p className="text-xs text-muted">
                {site_data.polylines.length} alignment{site_data.polylines.length !== 1 ? 's' : ''} · {totalVertices} vert · {totalSegments} seg
                <span className="ml-2 text-muted/50">· Click a polyline to select</span>
              </p>
            )}
          </div>
        </div>

        {/* ── Right: per-alignment tab panel ─────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden p-5">

          {/* Header */}
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-white">Segment Table</p>
            {activeAlignmentId !== null && activeSegments.length > 0 && (
              <p className="text-xs text-muted">
                Total: <span className="font-semibold text-white">{activeTotalLength.toFixed(2)} m</span>
              </p>
            )}
          </div>

          {site_data.polylines.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
              {px_per_m === null
                ? 'Calibrate scale first, then draw segments'
                : 'Draw the barrier alignment to generate segments'}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border">

              {/* Tab bar */}
              <div className="flex overflow-x-auto border-b border-border bg-panel/50 shrink-0">
                {site_data.polylines.map((pl) => {
                  const segCount = site_data.segment_table.filter((r) => r.alignment_id === pl.id).length
                  const isActive = pl.id === activeAlignmentId
                  return (
                    <button
                      key={pl.id}
                      onClick={() => setActiveAlignment(pl.id)}
                      className={[
                        'shrink-0 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                        isActive
                          ? 'border-accent text-white'
                          : 'border-transparent text-muted hover:text-white',
                      ].join(' ')}
                    >
                      Alignment {pl.id}
                      {segCount > 0 && (
                        <span className="ml-1.5 font-normal text-muted/60">({segCount})</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Table content */}
              {activeAlignmentId === null ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted">
                  Select an alignment tab or click a polyline on the canvas
                </div>
              ) : activeSegments.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted">
                  {px_per_m === null
                    ? 'Calibrate scale to see segment lengths'
                    : 'Add more points to this alignment to generate segments'}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-panel text-xs font-semibold uppercase tracking-wide text-muted">
                        <th className="px-3 py-2.5 text-left">ID</th>
                        <th className="px-3 py-2.5 text-right">Length (m)</th>
                        <th className="px-3 py-2.5 text-left">Tag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSegments.map((row) => (
                        <tr
                          key={`${row.alignment_id}-${row.segment_id}`}
                          className="border-b border-border/50 hover:bg-white/[0.02]"
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold text-accent">{row.segment_id}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{row.length_m.toFixed(2)}</td>
                          <td className="px-3 py-2.5">
                            <select
                              className="field-input py-1 text-xs"
                              value={row.tag}
                              onChange={(e) =>
                                updateSegmentTag(row.alignment_id, row.segment_id, e.target.value as SegmentRow['tag'])
                              }
                            >
                              {TAG_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Footer: confirm */}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted">
              {canConfirm
                ? 'Scale calibrated and alignment drawn. Ready to confirm.'
                : 'Complete scale calibration and draw at least one segment.'}
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm || site_data.step2_confirmed}
              className="btn-success"
            >
              {site_data.step2_confirmed ? 'Confirmed ✓' : 'Confirm Alignment →'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
