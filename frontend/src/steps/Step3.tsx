import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type {
  CalculationResults,
  DesignParameters,
  FootingType,
  OverridableValue,
} from '../types'

// ─── Shelter factor lookup — EN 1991-1-4 Figure 7.20 ─────────────────────────
// Data from shelter_factor_table.json (backend/app/data).
// Two curves only: phi=1.0 (solid) and phi=0.8.
// P105 validation: xh=8.71, phi=1.0 → ψs≈0.50 ✓ (interpolates to 0.4997)
// If phi < 0.8 or x/h ≥ 20: shelter factor does not apply → ψs = 1.0.

const SHELTER_CURVES: Record<'1.0' | '0.8', { xh: number; psi_s: number }[]> = {
  '1.0': [
    { xh: 0,  psi_s: 0.30 }, { xh: 2,  psi_s: 0.30 }, { xh: 5,  psi_s: 0.30 },
    { xh: 7,  psi_s: 0.38 }, { xh: 8,  psi_s: 0.45 }, { xh: 9,  psi_s: 0.52 },
    { xh: 10, psi_s: 0.60 }, { xh: 11, psi_s: 0.65 }, { xh: 12, psi_s: 0.70 },
    { xh: 13, psi_s: 0.76 }, { xh: 15, psi_s: 0.85 }, { xh: 17, psi_s: 0.92 },
    { xh: 20, psi_s: 1.00 },
  ],
  '0.8': [
    { xh: 0,  psi_s: 0.40 }, { xh: 2,  psi_s: 0.40 }, { xh: 5,  psi_s: 0.40 },
    { xh: 7,  psi_s: 0.46 }, { xh: 8,  psi_s: 0.50 }, { xh: 9,  psi_s: 0.55 },
    { xh: 10, psi_s: 0.60 }, { xh: 11, psi_s: 0.66 }, { xh: 12, psi_s: 0.72 },
    { xh: 13, psi_s: 0.78 }, { xh: 15, psi_s: 0.85 }, { xh: 17, psi_s: 0.93 },
    { xh: 20, psi_s: 1.00 },
  ],
}

/** Linear interpolation of ψs from EN 1991-1-4 Figure 7.20. */
function lookupShelterFactor(xh: number, phi: number): number {
  if (xh >= 20 || phi < 0.8) return 1.0
  const key: '1.0' | '0.8' = phi >= 1.0 ? '1.0' : '0.8'
  const curve = SHELTER_CURVES[key]
  if (xh <= curve[0].xh) return curve[0].psi_s
  for (let i = 0; i < curve.length - 1; i++) {
    const lo = curve[i], hi = curve[i + 1]
    if (xh >= lo.xh && xh <= hi.xh) {
      const t = (xh - lo.xh) / (hi.xh - lo.xh)
      return parseFloat((lo.psi_s + t * (hi.psi_s - lo.psi_s)).toFixed(3))
    }
  }
  return 1.0
}

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

// ─── Overridable field ────────────────────────────────────────────────────────
// Renders a number input pre-populated with the calculated default.
// Amber border + badge when the user has typed a different value.
// Revert link resets back to the calculated value.
// Reason field appears when overridden (required for PE report).
//
// Uses local rawInput string state so the user can backspace freely without the
// input snapping back mid-edit. Store is only updated when a valid number parses.
// On blur with an empty/invalid field, snaps back to the current effective value.

function OverridableField({
  label,
  hint,
  step = 0.1,
  span,
  value,
  onChange,
}: {
  label: string
  hint?: string
  step?: number
  span?: boolean
  value: OverridableValue
  onChange: (v: OverridableValue) => void
}) {
  const isOverridden = value.override !== null
  const displayValue = isOverridden ? value.override! : value.calculated

  // Local string tracks what's actually in the box, allowing partial editing.
  const [rawInput, setRawInput] = useState<string>(String(displayValue))

  // When the calculated value changes externally (e.g. shelter factor recomputed)
  // and no override is active, keep the box in sync.
  useEffect(() => {
    if (!isOverridden) setRawInput(String(value.calculated))
  }, [value.calculated, isOverridden])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setRawInput(raw)
    const n = parseFloat(raw)
    if (isNaN(n)) return  // user is mid-edit (e.g. cleared or typing "0.") — don't commit yet
    const newOverride = n === value.calculated ? null : n
    onChange({
      ...value,
      override: newOverride,
      override_reason: newOverride === null ? '' : value.override_reason,
      effective: newOverride ?? value.calculated,
    })
  }

  function handleBlur() {
    // If the box is empty or invalid when focus leaves, snap back to the effective value
    if (rawInput.trim() === '' || isNaN(parseFloat(rawInput))) {
      setRawInput(String(displayValue))
    }
  }

  function handleRevert() {
    onChange({ ...value, override: null, override_reason: '', effective: value.calculated })
    setRawInput(String(value.calculated))
  }

  return (
    <div className={`space-y-1${span ? ' col-span-2' : ''}`}>
      <div className="flex items-baseline gap-2">
        <label className="field-label mb-0">{label}</label>
        {isOverridden && (
          <>
            <span className="text-[10px] font-semibold text-warning px-1.5 py-px rounded bg-warning/10 border border-warning/30 leading-none">
              Overridden
            </span>
            <button
              type="button"
              onClick={handleRevert}
              className="text-[10px] text-muted hover:text-accent underline transition-colors"
              title={`Reset to calculated value: ${value.calculated}`}
            >
              ↺ reset to {value.calculated}
            </button>
          </>
        )}
      </div>
      <input
        type="number"
        step={step}
        className={`field-input transition-colors ${isOverridden ? 'border-warning/60 focus:border-warning' : ''}`}
        value={rawInput}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {isOverridden && (
        <input
          type="text"
          placeholder="Override reason (required for PE report)"
          className="field-input text-xs border-warning/40"
          value={value.override_reason}
          onChange={(e) => onChange({ ...value, override_reason: e.target.value })}
        />
      )}
      {hint && (
        <p className="text-xs text-muted/60">
          {isOverridden ? `Default: ${value.calculated} — ${hint}` : hint}
        </p>
      )}
    </div>
  )
}

// ─── Derivation panel ─────────────────────────────────────────────────────────
// Collapsible step-by-step calculation table. Collapsed by default.
// Overridden values shown in amber.

type DerivationRow = {
  label: string
  expr?: string
  result: string
  clause?: string
  overridden?: boolean
}

function DerivationPanel({ rows }: { rows: DerivationRow[] }) {
  const [open, setOpen] = useState(false)

  if (rows.length === 0) return null

  return (
    <div className="mt-2 border-t border-border/30 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-accent transition-colors"
      >
        <span
          className="inline-block transition-transform duration-150 text-[8px]"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▶
        </span>
        {open ? 'Hide derivation' : 'Show derivation'}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded border border-border/40 bg-surface/30 px-3 py-2">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/20 last:border-0">
                  <td
                    className={`py-1.5 pr-4 font-sans w-44 whitespace-nowrap align-top ${
                      row.overridden ? 'text-warning font-medium' : 'text-muted'
                    }`}
                  >
                    {row.label}
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-foreground/70 align-top">
                    {row.expr}
                  </td>
                  <td
                    className={`py-1.5 pr-4 font-mono font-semibold whitespace-nowrap align-top ${
                      row.overridden ? 'text-warning' : 'text-foreground'
                    }`}
                  >
                    {row.result}
                    {row.overridden && (
                      <span className="ml-1.5 text-warning text-[10px] font-sans font-normal">
                        [Override]
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 font-sans text-muted/50 whitespace-nowrap align-top">
                    {row.clause}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Derivation row builders ──────────────────────────────────────────────────

function buildWindRows(
  wind: CalculationResults['wind'],
  vbOverridden: boolean,
  shelterOverridden: boolean,
): DerivationRow[] {
  const vb = wind.vb_m_per_s ?? 20
  const rows: DerivationRow[] = [
    {
      label: 'Basic wind velocity',
      expr: `vb = ${vb.toFixed(1)} m/s`,
      result: `${vb.toFixed(1)} m/s`,
      clause: 'SG NA 2.4',
      overridden: vbOverridden,
    },
  ]
  if (wind.cdir != null) {
    rows.push({ label: 'Directional factor', expr: `cdir = ${wind.cdir}`, result: String(wind.cdir), clause: 'confirmed' })
  }
  if (wind.cseason != null) {
    rows.push({ label: 'Season factor', expr: `cseason = ${wind.cseason}`, result: String(wind.cseason), clause: 'confirmed' })
  }
  if (wind.qb_N_per_m2 != null) {
    rows.push({
      label: 'Basic wind pressure',
      expr: `qb = ½ × 1.194 × ${vb.toFixed(1)}²`,
      result: `${wind.qb_N_per_m2.toFixed(2)} N/m²`,
      clause: 'EC1 Eq 4.10',
    })
  }
  rows.push(
    {
      label: 'Roughness factor',
      expr: `cr = 0.19 × ln(${wind.ze_m}/0.05)`,
      result: String(wind.cr),
      clause: 'EC1 Cl 4.3.2',
    },
    {
      label: 'Mean velocity',
      expr: `vm = ${wind.cr} × 1.0 × ${vb.toFixed(1)}`,
      result: `${wind.vm_m_per_s.toFixed(2)} m/s`,
      clause: 'EC1 Cl 4.3.1',
    },
    {
      label: 'Turbulence intensity',
      expr: `Iv = 1.0 / ln(${wind.ze_m}/0.05)`,
      result: String(wind.Iv),
      clause: 'EC1 Cl 4.4',
    },
    {
      label: 'Peak velocity pressure',
      expr: `qp = [1+7×${wind.Iv}] × ½ × 1.194 × ${wind.vm_m_per_s.toFixed(2)}²`,
      result: `${wind.qp_N_per_m2.toFixed(1)} N/m²  (${wind.qp_kPa.toFixed(3)} kPa)`,
      clause: 'EC1 Eq 4.8',
    },
    {
      label: 'Pressure coefficient',
      expr: `cp,net = ${wind.cp_net}`,
      result: String(wind.cp_net),
      clause: 'EC1 Table 7.9',
    },
    {
      label: 'Shelter factor',
      expr: `ψs = ${wind.shelter_factor}`,
      result: String(wind.shelter_factor),
      clause: 'EC1 Fig 7.20 (stub)',
      overridden: shelterOverridden,
    },
    {
      label: 'Design pressure',
      expr: `q = ${wind.qp_N_per_m2.toFixed(1)} × ${wind.cp_net} × ${wind.shelter_factor}`,
      result: `${(wind.design_pressure_kPa * 1000).toFixed(1)} N/m²  ≈ ${wind.design_pressure_kPa.toFixed(3)} kPa`,
      clause: 'EC1 §6.2',
    },
  )
  return rows
}

function buildSteelRows(steel: CalculationResults['steel']): DerivationRow[] {
  if (!steel.pass || steel.error || !steel.designation) return []
  const rows: DerivationRow[] = []

  if (steel.w_kN_per_m != null) {
    rows.push({ label: 'Design UDL', expr: `w = q_design × post_spacing`, result: `${steel.w_kN_per_m.toFixed(3)} kN/m` })
  }
  if (steel.M_Ed_kNm != null) {
    rows.push({ label: 'Moment ULS', expr: `M_Ed = 1.5 × w × L² / 2`, result: `${steel.M_Ed_kNm.toFixed(2)} kNm`, clause: 'EC3' })
  }
  if (steel.V_Ed_kN != null) {
    rows.push({ label: 'Shear ULS', expr: `V_Ed = 1.5 × w × L`, result: `${steel.V_Ed_kN.toFixed(2)} kN`, clause: 'EC3' })
  }
  rows.push({ label: 'Selected section', expr: 'lightest passing', result: `UB ${steel.designation}` })
  if (steel.Mpl_kNm != null) {
    rows.push({ label: 'Plastic moment cap.', expr: `Mpl = Wpl × fy / γM1`, result: `${steel.Mpl_kNm.toFixed(2)} kNm`, clause: 'EC3 Cl 6.2.5' })
  }
  if (steel.Mcr_kNm != null) {
    rows.push({ label: 'Elastic critical moment', expr: `Mcr = C1 × π²EIz/Lcr² × √(Iw/Iz + Lcr²GIt/π²EIz)`, result: `${steel.Mcr_kNm.toFixed(2)} kNm`, clause: 'EC3 Ann. BB' })
  }
  if (steel.lambda_bar_LT != null) {
    rows.push({ label: 'LTB slenderness', expr: `λ̄LT = √(Mpl / Mcr)`, result: steel.lambda_bar_LT.toFixed(4), clause: 'EC3 Cl 6.3.2.2' })
  }
  if (steel.chi_LT != null) {
    rows.push({ label: 'LTB reduction factor', expr: `χLT = 1 / (φLT + √(φLT²−β×λ̄LT²))`, result: steel.chi_LT.toFixed(4), clause: 'EC3 Cl 6.3.2.3' })
  }
  if (steel.Mb_Rd_kNm != null) {
    rows.push({ label: 'Buckling resistance', expr: `Mb,Rd = χLT × Wpl × fy / γM1`, result: `${steel.Mb_Rd_kNm.toFixed(2)} kNm`, clause: 'EC3 Cl 6.3.2.1' })
  }
  if (steel.UR_moment != null) {
    rows.push({ label: 'Moment UR', expr: `M_Ed / Mb,Rd`, result: `${steel.UR_moment.toFixed(3)} ${steel.UR_moment < 1.0 ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }
  if (steel.delta_mm != null && steel.delta_allow_mm != null) {
    rows.push({ label: 'Deflection (SLS)', expr: `δ = w × L⁴ / (8EI)`, result: `${steel.delta_mm.toFixed(1)} mm  (allow ${steel.delta_allow_mm.toFixed(1)} mm, L/65)`, clause: 'EC3 §7.2' })
  }
  if (steel.UR_deflection != null) {
    rows.push({ label: 'Deflection UR', expr: `δ / δallow`, result: `${steel.UR_deflection.toFixed(3)} ${steel.UR_deflection < 1.0 ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }
  if (steel.Vc_kN != null) {
    rows.push({ label: 'Shear capacity', expr: `Vc,Rd = Av × (fy/√3) / γM0`, result: `${steel.Vc_kN.toFixed(2)} kN`, clause: 'EC3 Cl 6.2.6' })
  }
  if (steel.UR_shear != null) {
    rows.push({ label: 'Shear UR', expr: `V_Ed / Vc,Rd`, result: `${steel.UR_shear.toFixed(4)} ${steel.UR_shear < 1.0 ? '< 1.0 ✓' : '≥ 1.0 ✗'}`, clause: 'EC3 Cl 6.2.6' })
  }
  return rows
}

function buildFoundationRows(foundation: CalculationResults['foundation']): DerivationRow[] {
  const c1 = foundation.DA1_C1
  const rows: DerivationRow[] = [
    {
      label: 'Factored H (DA1-C1)',
      expr: `H = H_SLS × γQ`,
      result: `${c1.H_factored_kN.toFixed(2)} kN`,
      clause: 'γQ = 1.5',
    },
    {
      label: 'Factored M (DA1-C1)',
      expr: `M = M_SLS × γQ`,
      result: `${c1.M_factored_kNm.toFixed(2)} kNm`,
      clause: 'γQ = 1.5',
    },
  ]

  if (foundation.footing_type === 'Exposed pad') {
    rows.push({ label: 'Sliding resistance', expr: `F_R = μ × P_G  (μ=0.3)`, result: `${c1.F_R_sliding_kN.toFixed(2)} kN`, clause: 'P105 confirmed' })
  } else {
    const phi = c1.phi_d_deg != null ? `tanφd=tan(${c1.phi_d_deg.toFixed(1)}°)` : 'tanφd'
    rows.push({ label: 'Sliding resistance', expr: `F_R = P_G × ${phi}`, result: `${c1.F_R_sliding_kN.toFixed(2)} kN`, clause: 'EC7 Cl 6.5.3' })
  }

  rows.push(
    {
      label: 'Sliding FOS',
      expr: `FOS = F_R / H`,
      result: `${c1.FOS_sliding.toFixed(3)} ${c1.pass_sliding ? `≥ ${c1.fos_limit_sliding} ✓` : `< ${c1.fos_limit_sliding} ✗`}`,
    },
    {
      label: 'Overturning M_Rd',
      expr: `M_Rd = P_G × 0.9 × B/2`,
      result: `${c1.M_Rd_overturning_kNm.toFixed(2)} kNm`,
      clause: 'EC7 EQU: γG,stb=0.9',
    },
    {
      label: 'Overturning FOS',
      expr: `FOS = M_Rd / M`,
      result: `${c1.FOS_overturning.toFixed(3)} ${c1.pass_overturning ? `≥ ${c1.fos_limit_overturning} ✓` : `< ${c1.fos_limit_overturning} ✗`}`,
    },
  )

  const br = c1.bearing
  if (foundation.footing_type === 'Exposed pad' && br.q_max_kPa != null && br.q_allow_kPa != null) {
    if (br.e_m != null) {
      rows.push({ label: 'Eccentricity', expr: `e = M / P_G`, result: `${br.e_m.toFixed(3)} m` })
    }
    rows.push(
      { label: 'Max bearing pressure', expr: `q_max = P/A × (1 + 6e/B)`, result: `${br.q_max_kPa.toFixed(2)} kPa` },
      { label: 'Allowable bearing', expr: `q_allow (user input)`, result: `${br.q_allow_kPa.toFixed(2)} kPa` },
    )
  } else if (foundation.footing_type === 'Embedded RC' && br.qu_kPa != null && br.q_applied_kPa != null) {
    if (br.Nq != null) {
      rows.push({ label: 'Bearing factors', expr: `Nq=${br.Nq?.toFixed(2)}  Nc=${br.Nc?.toFixed(2)}  Nγ=${br.Ny?.toFixed(2)}`, result: '', clause: 'EC7 Ann. D.4' })
    }
    rows.push(
      { label: 'Bearing capacity qu', expr: `c'Nc·sc + q·Nq·sq + ½γB'Nγ·sγ`, result: `${br.qu_kPa.toFixed(2)} kPa`, clause: 'EC7 Ann. D.4' },
      { label: 'Applied bearing', expr: `q = P_G / (B' × L)`, result: `${br.q_applied_kPa.toFixed(2)} kPa` },
    )
  }

  if (br.UR_bearing != null) {
    rows.push({ label: 'Bearing UR', expr: `q_applied / q_capacity`, result: `${br.UR_bearing.toFixed(3)} ${c1.pass_bearing ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }

  return rows
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

function WindPanel({
  wind,
  vbOverridden,
  shelterOverridden,
}: {
  wind: CalculationResults['wind']
  vbOverridden: boolean
  shelterOverridden: boolean
}) {
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
          <p className={`text-xs ${shelterOverridden ? 'text-warning' : 'text-muted'}`}>
            ψs{shelterOverridden && ' [Override]'}
          </p>
          <p className={`font-mono ${shelterOverridden ? 'text-warning' : ''}`}>{wind.shelter_factor}</p>
        </div>
        {wind.vb_m_per_s != null && (
          <div>
            <p className={`text-xs ${vbOverridden ? 'text-warning' : 'text-muted'}`}>
              vb{vbOverridden && ' [Override]'}
            </p>
            <p className={`font-mono ${vbOverridden ? 'text-warning' : ''}`}>{wind.vb_m_per_s.toFixed(1)} m/s</p>
          </div>
        )}
      </div>
      <DerivationPanel rows={buildWindRows(wind, vbOverridden, shelterOverridden)} />
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
        {steel.UR_shear !== undefined && (
          <div>
            <p className="text-muted text-xs">Shear UR</p>
            <p className="font-mono">
              <UrCell value={steel.UR_shear} pass={steel.UR_shear < 1.0} />
            </p>
          </div>
        )}
      </div>
      <DerivationPanel rows={buildSteelRows(steel)} />
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
      <DerivationPanel rows={buildFoundationRows(foundation)} />
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
  const structureHeight = project_info.barrier_height ?? dp.structure_height

  // Footing weight hint — estimates concrete-only weight from dimensions when all three are filled.
  const footingWeightHint = useMemo(() => {
    if (dp.footing_B_m && dp.footing_L_m && dp.footing_D_m) {
      const est = dp.footing_B_m * dp.footing_L_m * dp.footing_D_m * 25
      return `Footing concrete only: ~${est.toFixed(1)} kN (${dp.footing_B_m}×${dp.footing_L_m}×${dp.footing_D_m}m × 25 kN/m³). Add post self-weight.`
    }
    return 'Post + footing combined permanent vertical load'
  }, [dp.footing_B_m, dp.footing_L_m, dp.footing_D_m])

  // Derive ψs from Figure 7.20 in real time.
  // Returns null when shelter_present=false or required inputs are incomplete.
  const computedShelterFactor = useMemo<number | null>(() => {
    if (!dp.shelter_present) return null
    if (dp.shelter_x == null || dp.shelter_phi == null || structureHeight == null || structureHeight <= 0) return null
    return lookupShelterFactor(dp.shelter_x / structureHeight, dp.shelter_phi)
  }, [dp.shelter_present, dp.shelter_x, dp.shelter_phi, structureHeight])

  // Sync computed ψs back to store whenever it changes so the derivation panel
  // and override badge logic read the correct `calculated` value.
  // The guard prevents unnecessary dispatches that would cause re-render loops.
  useEffect(() => {
    // When all inputs are available: use the looked-up value.
    // When shelter_present=false: reset to 1.0.
    // When shelter_present but inputs incomplete: keep the current stub (no update).
    if (!dp.shelter_present) return  // handleShelterPresent already sets 1.0 on toggle-off
    if (computedShelterFactor === null) return  // incomplete inputs — leave stub in place
    if (computedShelterFactor === dp.shelter_factor.calculated) return  // no change
    setDesignParameters({
      shelter_factor: {
        ...dp.shelter_factor,
        calculated: computedShelterFactor,
        effective: dp.shelter_factor.override ?? computedShelterFactor,
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedShelterFactor])

  // When shelter_present toggles, reset the shelter_factor field.
  // On toggle-on: stub 0.5 until x/φ/h are all filled (useEffect above then takes over).
  // On toggle-off: 1.0 (no shelter).
  function handleShelterPresent(present: boolean) {
    const calc = present ? 0.5 : 1.0
    set({
      shelter_present: present,
      shelter_factor: { calculated: calc, override: null, override_reason: '', effective: calc },
    })
  }

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
        // Effective ψs — respects any engineer override.
        // Uses computedShelterFactor directly (not the store) to avoid any sync lag.
        shelter_factor: dp.shelter_factor.override ?? (computedShelterFactor ?? dp.shelter_factor.calculated),
        // Send vb only when overridden — backend defaults to SG NA 20 m/s when omitted.
        vb: dp.vb.override !== null ? dp.vb.effective : undefined,
        return_period: dp.return_period,
        post_spacing: dp.post_spacing,
        subframe_spacing: dp.subframe_spacing,
        post_length: dp.post_length,
        deflection_limit_n: dp.deflection_limit_n,
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

  const vbOverridden = dp.vb.override !== null
  const shelterOverridden = dp.shelter_factor.override !== null

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

            <OverridableField
              label="Basic wind velocity vb (m/s)"
              hint="SG NA fixed: 20 m/s"
              step={0.5}
              value={dp.vb}
              onChange={(v) => set({ vb: v })}
            />

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
                    onClick={() => handleShelterPresent(opt === 'Yes')}
                    className={`px-4 py-1.5 rounded text-sm font-medium border transition-colors ${
                      (opt === 'Yes') === dp.shelter_present
                        ? 'border-accent bg-accent/20 text-accent'
                        : 'border-border text-muted hover:border-muted'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
                {dp.shelter_present && computedShelterFactor === null && !shelterOverridden && (
                  <span className="ml-2 self-center text-xs text-muted/60 italic">
                    Enter x and φ to calculate ψs
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

                <Field label="Solidity ratio φ" hint="EN 1991-1-4 Fig 7.20: 1.0 = solid wall, 0.8 = porous. φ < 0.8 not covered — use ψs = 1.0.">
                  <select
                    className="field-input"
                    value={dp.shelter_phi ?? ''}
                    onChange={(e) => set({ shelter_phi: e.target.value ? parseFloat(e.target.value) : null })}
                  >
                    <option value="">— Select —</option>
                    <option value={0.8}>0.8 (porous)</option>
                    <option value={1.0}>1.0 (solid)</option>
                  </select>
                </Field>
              </>
            )}

            <OverridableField
              label="Shelter factor ψs"
              hint={
                dp.shelter_present && computedShelterFactor !== null && structureHeight != null && dp.shelter_x != null
                  ? `Fig 7.20: x/h = ${(dp.shelter_x / structureHeight).toFixed(2)}, φ = ${dp.shelter_phi}`
                  : dp.shelter_present
                  ? 'Fill x and φ above — Fig 7.20 interpolation pending'
                  : '1.0 = no shelter'
              }
              step={0.05}
              value={{
                ...dp.shelter_factor,
                // Show live computed value in the field even before the store sync fires
                calculated: computedShelterFactor ?? dp.shelter_factor.calculated,
                effective: dp.shelter_factor.override ?? (computedShelterFactor ?? dp.shelter_factor.calculated),
              }}
              onChange={(v) => set({ shelter_factor: v })}
            />
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

            <Field label="Deflection limit (L/n)" hint="Default n=65 — confirmed P105. Change only if PE specifies otherwise.">
              <input
                type="number" min={20} max={500} step={5}
                className="field-input"
                value={numericValue(dp.deflection_limit_n)}
                onChange={(e) => set({ deflection_limit_n: parseNum(e.target.value) ?? 65 })}
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

            <Field label="Self-weight G (kN)" hint={footingWeightHint}>
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
              <WindPanel
                wind={calculation_results.wind}
                vbOverridden={vbOverridden}
                shelterOverridden={shelterOverridden}
              />
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
