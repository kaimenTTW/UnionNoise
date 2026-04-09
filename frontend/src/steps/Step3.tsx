import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type {
  CalculationResults,
  DesignParameters,
  FootingType,
} from '../types'

// ─── Layout helpers ───────────────────────────────────────────────────────────

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</p>
      <div className="grid grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

function Field({
  label,
  hint,
  provisional,
  span,
  children,
}: {
  label: string
  hint?: string
  provisional?: boolean
  span?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1${span ? ' col-span-2' : ''}`}>
      <div className="flex items-baseline gap-2">
        <label className="field-label mb-0">{label}</label>
        {provisional && <span className="text-xs text-warning/70 italic">provisional</span>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted/60">{hint}</p>}
    </div>
  )
}

// ─── Results display helpers ──────────────────────────────────────────────────

function PassBadge({ pass }: { pass: boolean }) {
  return (
    <span className={`text-xs font-semibold ${pass ? 'text-green-400' : 'text-red-400'}`}>
      {pass ? '✓' : '✗'}
    </span>
  )
}

function FosCell({ value, limit, pass }: { value: number; limit: number; pass: boolean }) {
  return (
    <span className={pass ? 'text-green-400' : 'text-red-400'}>
      {value.toFixed(2)} <span className="text-muted text-xs">(min {limit})</span>
    </span>
  )
}

function UrCell({ value, pass }: { value: number; pass: boolean }) {
  return (
    <span className={pass ? 'text-green-400' : 'text-red-400'}>
      {value.toFixed(3)} <PassBadge pass={pass} />
    </span>
  )
}

// ─── Results panels ───────────────────────────────────────────────────────────

function WindPanel({ wind }: { wind: CalculationResults['wind'] }) {
  return (
    <div className="panel space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">Wind Results</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-muted text-xs">ze</p>
          <p className="font-mono">{wind.ze_m} m</p>
        </div>
        <div>
          <p className="text-muted text-xs">qp</p>
          <p className="font-mono">{wind.qp_kPa.toFixed(3)} kPa</p>
        </div>
        <div>
          <p className="text-muted text-xs">Design pressure</p>
          <p className="font-mono font-semibold text-accent">{wind.design_pressure_kPa.toFixed(3)} kPa</p>
        </div>
        <div>
          <p className="text-muted text-xs">cr</p>
          <p className="font-mono">{wind.cr.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-muted text-xs">vm</p>
          <p className="font-mono">{wind.vm_m_per_s.toFixed(2)} m/s</p>
        </div>
        <div>
          <p className="text-muted text-xs">Iv</p>
          <p className="font-mono">{wind.Iv.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-muted text-xs">cp,net</p>
          <p className="font-mono">{wind.cp_net}</p>
        </div>
        <div>
          <p className="text-muted text-xs">ψs</p>
          <p className="font-mono">{wind.shelter_factor}</p>
        </div>
      </div>
    </div>
  )
}

function SteelPanel({ steel }: { steel: CalculationResults['steel'] }) {
  if (!steel.pass && steel.error) {
    return (
      <div className="panel border-red-500/40 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Steel Results</p>
        <p className="text-red-400 text-sm">{steel.error}</p>
      </div>
    )
  }
  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Steel Results</p>
        <PassBadge pass={steel.pass} />
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <p className="text-muted text-xs">Selected section</p>
          <p className="font-mono font-semibold text-white text-base">UB {steel.designation}</p>
        </div>
        <div>
          <p className="text-muted text-xs">M_Ed</p>
          <p className="font-mono">{steel.M_Ed_kNm?.toFixed(2)} kNm</p>
        </div>
        <div>
          <p className="text-muted text-xs">Mb,Rd</p>
          <p className="font-mono">{steel.Mb_Rd_kNm?.toFixed(2)} kNm</p>
        </div>
        <div>
          <p className="text-muted text-xs">Moment UR</p>
          <p className="font-mono">
            {steel.UR_moment !== undefined && (
              <UrCell value={steel.UR_moment} pass={steel.UR_moment < 1.0} />
            )}
          </p>
        </div>
        <div>
          <p className="text-muted text-xs">Deflection UR</p>
          <p className="font-mono">
            {steel.UR_deflection !== undefined && (
              <UrCell value={steel.UR_deflection} pass={steel.UR_deflection < 1.0} />
            )}
          </p>
        </div>
        <div>
          <p className="text-muted text-xs">δ actual</p>
          <p className="font-mono">{steel.delta_mm?.toFixed(1)} mm</p>
        </div>
        <div>
          <p className="text-muted text-xs">δ allow (L/65)</p>
          <p className="font-mono">{steel.delta_allow_mm?.toFixed(1)} mm</p>
        </div>
      </div>
    </div>
  )
}

function FoundationPanel({ foundation }: { foundation: CalculationResults['foundation'] }) {
  const combos = [
    { key: 'SLS', data: foundation.SLS },
    { key: 'DA1-C1', data: foundation.DA1_C1 },
    { key: 'DA1-C2', data: foundation.DA1_C2 },
  ] as const

  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Foundation Results</p>
        <PassBadge pass={foundation.pass} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="text-left py-1 pr-4 font-medium">Combo</th>
              <th className="text-left py-1 pr-4 font-medium">Sliding FOS</th>
              <th className="text-left py-1 pr-4 font-medium">Overturning FOS</th>
              <th className="text-left py-1 font-medium">Bearing UR</th>
              <th className="text-left py-1 pl-2 font-medium">Pass</th>
            </tr>
          </thead>
          <tbody>
            {combos.map(({ key, data }) => (
              <tr key={key} className="border-b border-border/50">
                <td className="py-1.5 pr-4 font-mono font-semibold">{key}</td>
                <td className="py-1.5 pr-4 font-mono">
                  <FosCell
                    value={data.FOS_sliding}
                    limit={data.fos_limit_sliding}
                    pass={data.pass_sliding}
                  />
                </td>
                <td className="py-1.5 pr-4 font-mono">
                  <FosCell
                    value={data.FOS_overturning}
                    limit={data.fos_limit_overturning}
                    pass={data.pass_overturning}
                  />
                </td>
                <td className="py-1.5 font-mono">
                  {data.bearing.UR_bearing != null ? (
                    <UrCell value={data.bearing.UR_bearing} pass={data.pass_bearing} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="py-1.5 pl-2">
                  <PassBadge pass={data.pass} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OverallBanner({ results }: { results: CalculationResults }) {
  const steelPass = results.steel.pass
  const foundationPass = results.foundation.pass
  const allPass = steelPass && foundationPass

  const failCount = [steelPass, foundationPass].filter((p) => !p).length

  return (
    <div
      className={`rounded-lg border px-5 py-3 flex items-center gap-3 ${
        allPass
          ? 'border-green-500/50 bg-green-500/10 text-green-400'
          : 'border-red-500/50 bg-red-500/10 text-red-400'
      }`}
    >
      <span className="text-lg font-bold">{allPass ? '✓' : '✗'}</span>
      <span className="font-semibold text-sm">
        {allPass ? 'All checks pass' : `${failCount} check${failCount > 1 ? 's' : ''} failed`}
      </span>
    </div>
  )
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────

export default function Step3() {
  useStepGuard(3)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const {
    project_info,
    design_parameters: dp,
    calculation_results,
    setDesignParameters,
    setCalculationResults,
    confirmStep3,
    step3_confirmed,
  } = useProjectStore()

  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const set = (partial: Partial<DesignParameters>) => setDesignParameters(partial)
  const numericValue = (v: number | null | undefined) => (v == null ? '' : String(v))
  const parseNum = (s: string): number | null => {
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  // Structure height: sourced from project_info.barrier_height (read-only display)
  // Falls back to dp.structure_height if barrier_height not yet set
  const structureHeight = project_info.barrier_height ?? dp.structure_height

  // Shelter factor: stub — ψs=0.5 when shelter present, 1.0 otherwise
  // PROVISIONAL: full x/h lookup deferred until shelter_factor_table.json is digitised
  const shelterFactor = dp.shelter_present ? 0.5 : 1.0

  const canRun =
    structureHeight != null &&
    dp.post_spacing != null &&
    dp.subframe_spacing != null &&
    dp.post_length != null &&
    dp.footing_type != null &&
    dp.footing_B_m != null &&
    dp.footing_L_m != null &&
    dp.footing_D_m != null &&
    dp.vertical_load_G_kN != null

  async function handleRunCalculations() {
    if (!canRun) return
    setLoading(true)
    setApiError(null)
    try {
      const body = {
        structure_height: structureHeight,
        shelter_factor: shelterFactor,
        post_spacing: dp.post_spacing,
        subframe_spacing: dp.subframe_spacing,
        post_length: dp.post_length,
        footing_type: dp.footing_type,
        phi_k: dp.phi_k,
        gamma_s: dp.gamma_s,
        cohesion_ck: dp.cohesion_ck,
        allowable_soil_bearing: dp.allowable_soil_bearing,
        footing_B: dp.footing_B_m,
        footing_W: dp.footing_L_m,   // L (along barrier) → API footing_W
        footing_D: dp.footing_D_m,
        vertical_load_G_kN: dp.vertical_load_G_kN,
      }
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `HTTP ${res.status}`)
      }
      const data: CalculationResults = await res.json()
      setCalculationResults(data)
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Calculation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 3</span>
          <h1 className="step-title">Design Workspace</h1>
        </div>
        <p className="step-subtitle">Configure design parameters and run calculations.</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-5">

          {/* ── Wind ── */}
          <FieldGroup title="Wind">
            <Field label="Structure height ze (m)" hint="From project setup — drives qp(z)">
              <input
                type="number"
                className="field-input bg-panel/50 cursor-not-allowed opacity-60"
                value={numericValue(structureHeight)}
                readOnly
                tabIndex={-1}
              />
            </Field>

            <Field label="Return period (years)" provisional>
              <select
                className="field-input"
                value={dp.return_period}
                onChange={(e) => set({ return_period: parseInt(e.target.value) })}
              >
                <option value={50}>50 years (standard)</option>
                <option value={10}>10 years</option>
                <option value={5}>5 years</option>
              </select>
            </Field>

            <Field label="Shelter present upwind?" hint="EC1 Section 7.4.2 — ψs from Figure 7.20" span>
              <div className="flex gap-3">
                {(['No', 'Yes'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => set({ shelter_present: opt === 'Yes' })}
                    className={`px-4 py-1.5 rounded text-sm font-medium border transition-colors ${
                      (opt === 'Yes') === dp.shelter_present
                        ? 'border-accent bg-accent/20 text-accent'
                        : 'border-border text-muted hover:border-muted'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
                {dp.shelter_present && (
                  <span className="ml-2 self-center text-xs text-warning/80 italic">
                    ψs = 0.5 stub — Figure 7.20 digitisation pending
                  </span>
                )}
              </div>
            </Field>

            {dp.shelter_present && (
              <>
                <Field label="Spacing x (m)" hint="Distance from barrier to upwind structure">
                  <input
                    type="number" min={0} step={0.5}
                    className="field-input"
                    placeholder="e.g. 6.0"
                    value={numericValue(dp.shelter_x)}
                    onChange={(e) => set({ shelter_x: parseNum(e.target.value) })}
                  />
                </Field>

                <Field label="Solidity ratio φ" hint="1.0 = solid wall (most common)">
                  <select
                    className="field-input"
                    value={dp.shelter_phi ?? ''}
                    onChange={(e) => set({ shelter_phi: e.target.value ? parseFloat(e.target.value) : null })}
                  >
                    <option value="">— Select —</option>
                    <option value={0.8}>0.8</option>
                    <option value={0.9}>0.9</option>
                    <option value={1.0}>1.0 (solid)</option>
                  </select>
                </Field>
              </>
            )}
          </FieldGroup>

          {/* ── Post ── */}
          <FieldGroup title="Post">
            <Field label="Post spacing (m)" hint="Tributary width per post">
              <input
                type="number" min={0} step={0.5}
                className="field-input"
                placeholder="3.0"
                value={numericValue(dp.post_spacing)}
                onChange={(e) => set({ post_spacing: parseNum(e.target.value) })}
              />
            </Field>

            <Field label="Subframe spacing (m)" hint="Lcr for torsional buckling (= this value)">
              <input
                type="number" min={0} step={0.25}
                className="field-input"
                placeholder="1.5"
                value={numericValue(dp.subframe_spacing)}
                onChange={(e) => set({ subframe_spacing: parseNum(e.target.value) })}
              />
            </Field>

            <Field label="Post length above foundation (m)" hint="T1 above-ground: ~11 m. T2 embedded: ~12.7 m">
              <input
                type="number" min={0} step={0.1}
                className="field-input"
                placeholder="e.g. 11.0"
                value={numericValue(dp.post_length)}
                onChange={(e) => set({ post_length: parseNum(e.target.value) })}
              />
            </Field>
          </FieldGroup>

          {/* ── Foundation ── */}
          <FieldGroup title="Foundation">
            <Field label="Footing type" hint="Drives which calculation branch runs">
              <select
                className="field-input"
                value={dp.footing_type ?? ''}
                onChange={(e) => set({ footing_type: (e.target.value as FootingType) || null })}
              >
                <option value="">— Select type —</option>
                <option value="Exposed pad">Above Ground (Exposed pad)</option>
                <option value="Embedded RC">Embedded RC footing</option>
              </select>
            </Field>

            {dp.footing_type === 'Exposed pad' && (
              <Field label="Allowable soil bearing (kPa)" hint="Default 75 kPa if no site investigation">
                <input
                  type="number" min={0} step={5}
                  className="field-input"
                  value={dp.allowable_soil_bearing}
                  onChange={(e) => set({ allowable_soil_bearing: parseFloat(e.target.value) || 75 })}
                />
              </Field>
            )}

            <Field label="Footing L (m)" hint="Plan length along barrier (perpendicular to wind)">
              <input
                type="number" min={0} step={0.1}
                className="field-input"
                placeholder="e.g. 1.2"
                value={numericValue(dp.footing_L_m)}
                onChange={(e) => set({ footing_L_m: parseNum(e.target.value) })}
              />
            </Field>

            <Field label="Footing B (m)" hint="Plan width in wind direction">
              <input
                type="number" min={0} step={0.1}
                className="field-input"
                placeholder="e.g. 0.9"
                value={numericValue(dp.footing_B_m)}
                onChange={(e) => set({ footing_B_m: parseNum(e.target.value) })}
              />
            </Field>

            <Field label="Footing D (m)" hint="Embedment depth below ground (0 for exposed pad)">
              <input
                type="number" min={0} step={0.1}
                className="field-input"
                placeholder="0"
                value={numericValue(dp.footing_D_m)}
                onChange={(e) => set({ footing_D_m: parseNum(e.target.value) ?? 0 })}
              />
            </Field>

            <Field label="Self-weight G (kN)" hint="Post + footing combined permanent vertical load">
              <input
                type="number" min={0} step={1}
                className="field-input"
                placeholder="e.g. 85"
                value={numericValue(dp.vertical_load_G_kN)}
                onChange={(e) => set({ vertical_load_G_kN: parseNum(e.target.value) })}
              />
            </Field>

            <Field label="Soil φk (°)" hint="P105 confirmed: 30°" provisional>
              <input
                type="number" min={0} max={50} step={1}
                className="field-input"
                value={dp.phi_k}
                onChange={(e) => set({ phi_k: parseFloat(e.target.value) || 30 })}
              />
            </Field>

            <Field label="Soil γs (kN/m³)" hint="P105 confirmed: 19 kN/m³" provisional>
              <input
                type="number" min={0} step={0.5}
                className="field-input"
                value={dp.gamma_s}
                onChange={(e) => set({ gamma_s: parseFloat(e.target.value) || 19 })}
              />
            </Field>

            <Field label="Soil c'k (kN/m²)" hint="P105 confirmed: 5 kN/m²" provisional>
              <input
                type="number" min={0} step={0.5}
                className="field-input"
                value={dp.cohesion_ck}
                onChange={(e) => set({ cohesion_ck: parseFloat(e.target.value) })}
              />
            </Field>
          </FieldGroup>

          {/* ── Run button ── */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleRunCalculations}
              disabled={!canRun || loading}
              className={`btn-primary px-6 py-2.5 text-sm font-semibold ${
                (!canRun || loading) ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {loading ? 'Calculating…' : 'Run Calculations'}
            </button>
            {!canRun && (
              <p className="text-xs text-muted">Fill all required fields to enable</p>
            )}
          </div>

          {apiError && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <strong>Error:</strong> {apiError}
            </div>
          )}

          {/* ── Results ── */}
          {calculation_results && (
            <div className="space-y-4 pt-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Results</p>
              <WindPanel wind={calculation_results.wind} />
              <SteelPanel steel={calculation_results.steel} />
              <FoundationPanel foundation={calculation_results.foundation} />
              <OverallBanner results={calculation_results} />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-border px-6 py-4">
        <button
          onClick={() => { confirmStep3(); navigate(`/project/${id}/step/4`) }}
          className={step3_confirmed ? 'btn-success' : 'btn-primary'}
        >
          {step3_confirmed ? 'Confirmed ✓' : 'Confirm & Continue →'}
        </button>
      </div>
    </div>
  )
}
