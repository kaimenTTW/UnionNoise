import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type {
  CalculationResults,
  ConnectionCalcResult,
  FoundationComboResult,
  LiftingCalcResult,
  SubframeCalcResult,
} from '../types'

// ─── Shared display helpers ───────────────────────────────────────────────────

function PassBadge({ pass }: { pass: boolean }) {
  return (
    <span className={`text-xs font-semibold ${pass ? 'text-green-400' : 'text-red-400'}`}>
      {pass ? '✓' : '✗'}
    </span>
  )
}

function UrRow({ label, value, pass }: { label: string; value: number | null | undefined; pass: boolean }) {
  if (value == null) return null
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-mono text-xs font-semibold ${pass ? 'text-green-400' : 'text-red-400'}`}>
        {value.toFixed(3)} <PassBadge pass={pass} />
      </span>
    </div>
  )
}

function FosRow({ label, value, limit, pass }: { label: string; value: number; limit: number; pass: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-mono text-xs font-semibold ${pass ? 'text-green-400' : 'text-red-400'}`}>
        {value.toFixed(2)} <span className="text-muted font-normal">(min {limit})</span> <PassBadge pass={pass} />
      </span>
    </div>
  )
}

// ─── Note editor (inline, per card) ──────────────────────────────────────────

function NoteEditor({ moduleId }: { moduleId: string }) {
  const note = useProjectStore((s) => s.step4_notes[moduleId] ?? '')
  const setStep4Note = useProjectStore((s) => s.setStep4Note)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(note)
    setEditing(true)
  }

  function save() {
    setStep4Note(moduleId, draft.trim())
    setEditing(false)
  }

  function cancel() {
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          className="w-full rounded border border-border bg-surface text-xs text-white p-2 resize-none focus:outline-none focus:border-accent"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Engineering note…"
          autoFocus
        />
        <div className="flex gap-2">
          <button onClick={save} className="text-xs font-medium text-accent hover:text-white transition-colors">
            Save
          </button>
          <button onClick={cancel} className="text-xs text-muted hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (note) {
    return (
      <div className="mt-3 flex items-start gap-2">
        <p className="text-xs text-amber-400 flex-1 leading-relaxed">{note}</p>
        <button onClick={startEdit} className="text-xs text-muted hover:text-white transition-colors shrink-0">
          Edit
        </button>
      </div>
    )
  }

  return (
    <button onClick={startEdit} className="mt-3 text-xs text-muted hover:text-white transition-colors">
      + Add note
    </button>
  )
}

// ─── Module cards ─────────────────────────────────────────────────────────────

function CardShell({
  title,
  pass,
  subtitle,
  children,
}: {
  title: string
  pass: boolean
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className={`panel border ${pass ? 'border-green-500/30' : 'border-red-500/40'} space-y-3`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</p>
          {subtitle && <p className="mt-0.5 text-sm font-mono text-white">{subtitle}</p>}
        </div>
        <PassBadge pass={pass} />
      </div>
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  )
}

function SteelCard({ results }: { results: CalculationResults }) {
  const confirmed = useProjectStore((s) => s.confirmed_section)
  const steel = results.steel

  const gradeLabel = confirmed
    ? ((confirmed.fy_N_per_mm2 ?? 275) >= 355 ? 'S355' : 'S275')
    : 'S275'
  const source = confirmed?.source ?? null
  const isLive = source === 'live'

  const momentPass = (steel.UR_moment ?? 1) < 1.0
  const deflPass = (steel.UR_deflection ?? 1) < 1.0
  const shearPass = (steel.UR_shear ?? 1) < 1.0
  const pass = steel.pass

  const subtitle = confirmed
    ? `UB ${confirmed.designation}  ·  ${gradeLabel}  ·  ${confirmed.mass_kg_per_m} kg/m`
    : steel.designation ? `UB ${steel.designation}` : '—'

  return (
    <CardShell
      title="Steel Post"
      pass={pass}
      subtitle={subtitle}
    >
      {source != null && (
        <div className="py-1 border-b border-border/30">
          <span className={`text-xs font-mono ${isLive ? 'text-green-400' : 'text-amber-400'}`}>
            {isLive ? 'live ✓' : 'cache ⚠'} — section source
          </span>
        </div>
      )}
      <UrRow label="Moment UR" value={steel.UR_moment} pass={momentPass} />
      <UrRow label="Deflection UR" value={steel.UR_deflection} pass={deflPass} />
      <UrRow label="Shear UR" value={steel.UR_shear} pass={shearPass} />
      <NoteEditor moduleId="steel" />
    </CardShell>
  )
}

function FoundationCard({
  foundation,
  cuKPa,
}: {
  foundation: CalculationResults['foundation']
  cuKPa: number
}) {
  const hasUndrained = cuKPa > 0

  function ComboRows({ label, data }: { label: string; data: FoundationComboResult }) {
    return (
      <>
        <FosRow
          label={`${label} — Sliding FOS`}
          value={data.FOS_sliding}
          limit={data.fos_limit_sliding}
          pass={data.pass_sliding}
        />
        <FosRow
          label={`${label} — Overturning ODF`}
          value={data.FOS_overturning}
          limit={data.fos_limit_overturning}
          pass={data.pass_overturning}
        />
        <UrRow
          label={`${label} — Bearing UR (drained)`}
          value={data.bearing_drained?.UR_bearing}
          pass={data.pass_bearing}
        />
        {hasUndrained && data.bearing_undrained?.UR_bearing != null && (
          <UrRow
            label={`${label} — Bearing UR (undrained)`}
            value={data.bearing_undrained.UR_bearing}
            pass={data.pass_bearing}
          />
        )}
      </>
    )
  }

  return (
    <CardShell
      title={`Foundation  (${foundation.footing_type})`}
      pass={foundation.pass}
    >
      <ComboRows label="SLS" data={foundation.SLS} />
      <ComboRows label="DA1-C1" data={foundation.DA1_C1} />
      <ComboRows label="DA1-C2" data={foundation.DA1_C2} />
      <NoteEditor moduleId="foundation" />
    </CardShell>
  )
}

function ConnectionCard({ conn }: { conn: ConnectionCalcResult }) {
  const configId = conn.config_id ?? '—'
  const pass = conn.all_checks_pass ?? false

  return (
    <CardShell title={`Connection  (${configId})`} pass={pass}>
      {conn.bolt_tension?.UR != null && (
        <UrRow label="Bolt tension" value={conn.bolt_tension.UR} pass={conn.bolt_tension.pass ?? false} />
      )}
      {conn.bolt_shear?.UR != null && (
        <UrRow label="Bolt shear" value={conn.bolt_shear.UR} pass={conn.bolt_shear.pass ?? false} />
      )}
      {conn.bolt_combined?.UR != null && (
        <UrRow label="Bolt combined" value={conn.bolt_combined.UR} pass={conn.bolt_combined.pass ?? false} />
      )}
      {conn.bolt_embedment?.UR != null && (
        <UrRow label="Bolt embedment" value={conn.bolt_embedment.UR} pass={conn.bolt_embedment.pass ?? false} />
      )}
      {conn.weld?.UR != null && (
        <UrRow label="Weld" value={conn.weld.UR} pass={conn.weld.pass ?? false} />
      )}
      {conn.base_plate?.UR != null && (
        <UrRow label="Base plate" value={conn.base_plate.UR} pass={conn.base_plate.pass ?? false} />
      )}
      {conn.g_clamp?.UR != null && (
        <UrRow label="G clamp" value={conn.g_clamp.UR} pass={conn.g_clamp.pass ?? false} />
      )}
      <NoteEditor moduleId="connection" />
    </CardShell>
  )
}

function SubframeCard({ sf }: { sf: SubframeCalcResult }) {
  const pass = sf.pass ?? false
  return (
    <CardShell title="Subframe" pass={pass} subtitle={sf.designation}>
      <UrRow label="Moment UR" value={sf.UR_subframe} pass={pass} />
      {sf.hardware_note && (
        <div className="py-1.5">
          <p className="text-xs text-amber-400/80">{sf.hardware_note}</p>
        </div>
      )}
      <NoteEditor moduleId="subframe" />
    </CardShell>
  )
}

function LiftingCard({ lift }: { lift: LiftingCalcResult }) {
  const pass = lift.all_checks_pass ?? false
  const hook = lift.hook
  const hole = lift.hole
  return (
    <CardShell title="Lifting" pass={pass}>
      {hook?.UR_tension != null && (
        <UrRow label="Hook tension UR" value={hook.UR_tension} pass={hook.pass_tension ?? false} />
      )}
      {hook?.UR_bond != null && (
        <UrRow label="Hook bond UR" value={hook.UR_bond} pass={hook.pass_bond ?? false} />
      )}
      {hole?.UR_shear != null && (
        <UrRow label="Hole shear UR" value={hole.UR_shear} pass={hole.pass_shear ?? false} />
      )}
      <NoteEditor moduleId="lifting" />
    </CardShell>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Step4() {
  useStepGuard(4)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const calculation_results = useProjectStore((s) => s.calculation_results)
  const dp = useProjectStore((s) => s.design_parameters)
  const confirmStep4 = useProjectStore((s) => s.confirmStep4)

  if (!calculation_results) {
    return (
      <div className="flex h-full flex-col">
        <div className="step-header">
          <div className="flex items-baseline gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 4</span>
            <h1 className="step-title">Design Review</h1>
          </div>
          <p className="step-subtitle">Review utilisation ratios and accept the design before proceeding to outputs.</p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center p-8">
          <p className="text-sm text-muted">
            No calculation results found. Return to Step 3 to run calculations.
          </p>
          <button
            onClick={() => navigate(`/project/${id}/step/3`)}
            className="btn-primary"
          >
            ← Back to Step 3
          </button>
        </div>
      </div>
    )
  }

  const { steel, foundation, connection, subframe, lifting } = calculation_results

  const steelPass = steel.pass
  const foundationPass = foundation.pass
  const connPass = connection?.all_checks_pass ?? true
  const subframePass = subframe?.pass ?? true
  const liftingPass = lifting?.all_checks_pass ?? true
  const allPass = steelPass && foundationPass && connPass && subframePass && liftingPass

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 4</span>
          <h1 className="step-title">Design Review</h1>
        </div>
        <p className="step-subtitle">Review utilisation ratios and accept the design before proceeding to outputs.</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-6">

          {/* Overall banner */}
          <div className={`rounded-lg border px-5 py-4 ${allPass ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
            <p className={`text-sm font-semibold ${allPass ? 'text-green-400' : 'text-red-400'}`}>
              {allPass
                ? 'All checks pass — ready to proceed'
                : 'Design has failures — review required'}
            </p>
          </div>

          {/* Module cards — 2-col desktop, 1-col mobile */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SteelCard results={calculation_results} />
            <FoundationCard foundation={foundation} cuKPa={dp.cu_kPa ?? 0} />
            {connection && <ConnectionCard conn={connection} />}
            {subframe && <SubframeCard sf={subframe} />}
            {lifting && <LiftingCard lift={lifting} />}
          </div>

          {/* Proceed button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={() => { confirmStep4(); navigate(`/project/${id}/step/6`) }}
              disabled={!allPass}
              title={allPass ? undefined : 'Resolve all failures before proceeding'}
              className={`btn-primary ${!allPass ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Proceed to Outputs →
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
