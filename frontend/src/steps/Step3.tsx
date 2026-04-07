import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type {
  BoltGrade,
  ConcreteGrade,
  DesignParameters,
  FootingType,
  RebarGrade,
  SteelGrade,
  WindZone,
} from '../types'

// ─── Reusable field components ────────────────────────────────────────────────

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
  children,
}: {
  label: string
  hint?: string
  provisional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2">
        <label className="field-label mb-0">{label}</label>
        {provisional && (
          <span className="text-xs text-warning/70 italic">provisional</span>
        )}
      </div>
      {children}
      {hint && <p className="text-xs text-muted/60">{hint}</p>}
    </div>
  )
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────

export default function Step3() {
  useStepGuard(3)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const { applicable_codes, toggleCode, design_parameters: dp, setDesignParameters, confirmStep3, step3_confirmed } = useProjectStore()
  const [activeTab, setActiveTab] = useState<'codes' | 'design'>('codes')

  const selectedCount = applicable_codes.filter((c) => c.selected).length

  // Helper for numeric inputs — stores null when blank
  const numericValue = (v: number | null) => (v === null ? '' : String(v))
  const parseNum = (s: string): number | null => {
    const n = parseFloat(s)
    return isNaN(n) ? null : n
  }

  const set = (partial: Partial<DesignParameters>) => setDesignParameters(partial)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 3</span>
          <h1 className="step-title">Design Workspace</h1>
        </div>
        <p className="step-subtitle">Select applicable codes and configure design parameters.</p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border px-6">
        {(['codes', 'design'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab
                ? 'border-accent text-white'
                : 'border-transparent text-muted hover:text-white',
            ].join(' ')}
          >
            {tab === 'codes' ? 'Code Selection' : 'Design Parameters'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* ── Code Selection ── */}
        {activeTab === 'codes' && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                Select codes governing this design. Pre-selected codes are required for all standard
                temporary noise barrier projects.
              </p>
              <span className="badge-success">{selectedCount} selected</span>
            </div>

            <div className="panel divide-y divide-border">
              {applicable_codes.map((code) => (
                <label
                  key={code.en_designation}
                  className="flex cursor-pointer items-start gap-4 py-4 first:pt-0 last:pb-0 hover:bg-white/[0.02] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={code.selected}
                    onChange={() => toggleCode(code.en_designation)}
                    className="mt-1 h-4 w-4 accent-accent shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white font-mono">{code.en_designation}</p>
                    <p className="mt-0.5 text-xs text-muted">{code.eurocode_label}</p>
                    <p className="mt-0.5 text-xs text-muted/50 italic">{code.governs}</p>
                  </div>
                  {code.selected && code.en_designation !== 'SS 602:2014' && (
                    <span className="shrink-0 text-xs text-muted/60 mt-0.5">Required</span>
                  )}
                </label>
              ))}
            </div>

            <div className="rounded border border-border bg-panel/50 px-4 py-3 text-xs text-muted">
              <strong className="text-white">Note:</strong> Calculation engine is not yet
              implemented. Code selection is captured in ProjectContext for the next iteration.
              {/* PROVISIONAL: pending SME validation — see PRD Section 2.3 */}
            </div>
          </div>
        )}

        {/* ── Design Parameters ── */}
        {activeTab === 'design' && (
          <div className="max-w-3xl space-y-5">

            {/* Wind */}
            <FieldGroup title="Wind Analysis">
              <Field label="Basic wind speed (m/s)" hint="SG NA fixed constant: 20 m/s">
                <input
                  type="number" min={0} step={0.5}
                  className="field-input"
                  value={dp.basic_wind_speed}
                  onChange={(e) => set({ basic_wind_speed: parseFloat(e.target.value) || 20 })}
                />
              </Field>

              <Field label="Return period (years)" hint="Default 50 yr — 5/10 yr used for short-term works" provisional>
                <select
                  className="field-input"
                  value={dp.return_period}
                  onChange={(e) => set({ return_period: parseInt(e.target.value) })}
                >
                  <option value={5}>5 years</option>
                  <option value={10}>10 years</option>
                  <option value={50}>50 years</option>
                </select>
              </Field>

              <Field label="Structure height ze (m)" hint="Height from ground — drives qp calculation">
                <input
                  type="number" min={0} step={0.1}
                  className="field-input"
                  placeholder="e.g. 6.0"
                  value={numericValue(dp.structure_height)}
                  onChange={(e) => set({ structure_height: parseNum(e.target.value) })}
                />
              </Field>

              <Field label="Shelter factor" hint="1.0 = open site (default); 0.5 = enclosed/sheltered" provisional>
                <input
                  type="number" min={0} max={1} step={0.1}
                  className="field-input"
                  value={dp.shelter_factor}
                  onChange={(e) => set({ shelter_factor: parseFloat(e.target.value) || 1.0 })}
                />
              </Field>

              <Field label="Wind zone (EC1 Table 7.9)" hint="A/B/C/D — engineering judgement, user-confirmed" provisional>
                <select
                  className="field-input"
                  value={dp.wind_zone ?? ''}
                  onChange={(e) => set({ wind_zone: (e.target.value as WindZone) || null })}
                >
                  <option value="">— Select zone —</option>
                  <option value="A">Zone A (highest pressure)</option>
                  <option value="B">Zone B</option>
                  <option value="C">Zone C</option>
                  <option value="D">Zone D (lowest pressure)</option>
                </select>
              </Field>

              <Field label="l/h ratio" hint="Barrier length ÷ barrier height — used to interpolate cp">
                <input
                  type="number" min={0} step={0.1}
                  className="field-input"
                  placeholder="e.g. 5.0"
                  value={numericValue(dp.lh_ratio)}
                  onChange={(e) => set({ lh_ratio: parseNum(e.target.value) })}
                />
              </Field>
            </FieldGroup>

            {/* Structural geometry */}
            <FieldGroup title="Structural Geometry">
              <Field label="Post spacing (m)" hint="Drives tributary area and reaction forces">
                <input
                  type="number" min={0} step={0.5}
                  className="field-input"
                  placeholder="e.g. 3.0"
                  value={numericValue(dp.post_spacing)}
                  onChange={(e) => set({ post_spacing: parseNum(e.target.value) })}
                />
              </Field>

              <Field label="Subframe spacing (m)" hint="Lcr for torsional buckling = this value">
                <input
                  type="number" min={0} step={0.25}
                  className="field-input"
                  placeholder="e.g. 1.5"
                  value={numericValue(dp.subframe_spacing)}
                  onChange={(e) => set({ subframe_spacing: parseNum(e.target.value) })}
                />
              </Field>
            </FieldGroup>

            {/* Materials */}
            <FieldGroup title="Materials">
              <Field label="Concrete grade" hint="Default C25/30 per PE reports" provisional>
                <select
                  className="field-input"
                  value={dp.concrete_grade}
                  onChange={(e) => set({ concrete_grade: e.target.value as ConcreteGrade })}
                >
                  <option value="C25/30">C25/30 (fck 25 MPa)</option>
                  <option value="C28/35">C28/35 (fck 28 MPa)</option>
                  <option value="C30/37">C30/37 (fck 30 MPa)</option>
                </select>
              </Field>

              <Field label="Steel grade">
                <select
                  className="field-input"
                  value={dp.steel_grade}
                  onChange={(e) => set({ steel_grade: e.target.value as SteelGrade })}
                >
                  <option value="S275">S275 (fy = 275 N/mm²)</option>
                  <option value="S355">S355 (fy = 355 N/mm²)</option>
                </select>
              </Field>

              <Field label="Rebar grade">
                <select
                  className="field-input"
                  value={dp.rebar_grade}
                  onChange={(e) => set({ rebar_grade: e.target.value as RebarGrade })}
                >
                  <option value="B500B">B500B (fyk = 500 N/mm²)</option>
                  <option value="B500C">B500C (fyk = 500 N/mm²)</option>
                </select>
              </Field>

              <Field label="Bolt grade">
                <select
                  className="field-input"
                  value={dp.bolt_grade}
                  onChange={(e) => set({ bolt_grade: e.target.value as BoltGrade })}
                >
                  <option value="8.8">Grade 8.8</option>
                  <option value="10.9">Grade 10.9</option>
                </select>
              </Field>
            </FieldGroup>

            {/* Foundation */}
            <FieldGroup title="Foundation">
              <Field label="Footing type" hint="Determines which foundation calculation branch runs">
                <select
                  className="field-input"
                  value={dp.footing_type ?? ''}
                  onChange={(e) => set({ footing_type: (e.target.value as FootingType) || null })}
                >
                  <option value="">— Select type —</option>
                  <option value="Exposed pad">Exposed pad footing</option>
                  <option value="Embedded RC">Embedded RC footing</option>
                </select>
              </Field>

              <Field label="Allowable soil bearing (kPa)" hint="Default 75 kPa if no site investigation">
                <input
                  type="number" min={0} step={5}
                  className="field-input"
                  value={dp.allowable_soil_bearing}
                  onChange={(e) => set({ allowable_soil_bearing: parseFloat(e.target.value) || 75 })}
                />
              </Field>
            </FieldGroup>

            {/* Soil parameters */}
            <FieldGroup title="Soil Parameters">
              <Field label="Friction angle φk (°)" hint="Default 30° — SG typical" provisional>
                <input
                  type="number" min={0} max={50} step={1}
                  className="field-input"
                  value={dp.phi_k}
                  onChange={(e) => set({ phi_k: parseFloat(e.target.value) || 30 })}
                />
              </Field>

              <Field label="Soil unit weight γs (kN/m³)" hint="Default 20 kN/m³" provisional>
                <input
                  type="number" min={0} step={0.5}
                  className="field-input"
                  value={dp.gamma_s}
                  onChange={(e) => set({ gamma_s: parseFloat(e.target.value) || 20 })}
                />
              </Field>

              <Field label="Cohesion c'k (kN/m²)" hint="Default 0 — site-specific, user-editable" provisional>
                <input
                  type="number" min={0} step={0.5}
                  className="field-input"
                  value={dp.cohesion_ck}
                  onChange={(e) => set({ cohesion_ck: parseFloat(e.target.value) })}
                />
              </Field>
            </FieldGroup>

            <div className="rounded border border-border bg-panel/50 px-4 py-3 text-xs text-muted">
              <strong className="text-white">Note:</strong> Parameters marked{' '}
              <span className="text-warning/70 italic">provisional</span> have defaults derived from
              PE calculation reports but require SME confirmation for each project.
              Calculation engine not yet implemented — values are captured in ProjectContext.
              {/* PROVISIONAL: pending SME validation — see PRD Section 2.4 / 2.5 */}
            </div>
          </div>
        )}
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
