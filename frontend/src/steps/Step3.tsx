import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'
import type {
  CalculationResults,
  ConnectionCalcResult,
  DesignParameters,
  FootingType,
  LiftingCalcResult,
  OptimiseResult,
  OverridableValue,
  Phase1Result,
  SelectionResult,
  SteelSection,
  SubframeCalcResult,
  WindCalcResult,
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

  // Section source provenance — top of derivation
  if (steel.selection_source != null) {
    rows.push({ label: 'Section source', result: steel.selection_source })
  }
  if (steel.fallback_reason != null) {
    rows.push({ label: 'Fallback reason', result: steel.fallback_reason })
  }

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
  const c2 = foundation.DA1_C2
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

  const br = c1.bearing_drained
  if (foundation.footing_type === 'Exposed pad' && br?.q_max_kPa != null && br?.q_allow_kPa != null) {
    if (br.e_m != null) {
      rows.push({ label: 'Eccentricity', expr: `e = M_SLS / P_G`, result: `${br.e_m.toFixed(3)} m` })
    }
    rows.push(
      { label: 'Max bearing pressure', expr: `q_max = P/A × (1 + 6e/B)`, result: `${br.q_max_kPa.toFixed(2)} kPa` },
      { label: 'Allowable bearing', expr: `q_allow (user input)`, result: `${br.q_allow_kPa.toFixed(2)} kPa` },
    )
  } else if (foundation.footing_type === 'Embedded RC' && br?.qu_kPa != null && br?.q_applied_kPa != null) {
    if (br.Nq != null) {
      rows.push({ label: 'Bearing factors (drained)', expr: `Nq=${br.Nq?.toFixed(2)}  Nc=${br.Nc?.toFixed(2)}  Nγ=${br.Ny?.toFixed(2)}`, result: '', clause: 'EC7 Ann. D.4' })
    }
    rows.push(
      { label: 'Bearing capacity qu (drained)', expr: `c'Nc·sc + q·Nq·sq + ½γB'Nγ·sγ`, result: `${br.qu_kPa.toFixed(2)} kPa`, clause: 'EC7 Ann. D.4' },
      { label: 'Applied bearing', expr: `q = P_G / (B' × L)`, result: `${br.q_applied_kPa.toFixed(2)} kPa` },
    )
  }

  if (br?.UR_bearing != null) {
    rows.push({ label: 'Bearing UR (drained)', expr: `q_applied / qu`, result: `${br.UR_bearing.toFixed(3)} ${c1.pass_bearing ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }

  const bru = c1.bearing_undrained
  if (bru?.qu_kPa != null && bru?.q_applied_kPa != null) {
    rows.push(
      { label: 'qu (undrained, DA1-C1)', expr: `(π+2)×cu,d×bc×ic×sc + q`, result: `${bru.qu_kPa.toFixed(2)} kPa`, clause: 'EC7 Ann. D.3' },
      { label: 'Applied bearing', expr: `q = P_G / (B' × L)`, result: `${bru.q_applied_kPa.toFixed(2)} kPa` },
    )
    if (bru.UR_bearing != null) {
      rows.push({ label: 'Bearing UR (undrained, DA1-C1)', expr: `q_applied / qu`, result: `${bru.UR_bearing.toFixed(3)}` })
    }
  }

  if (c1.bearing_governs) {
    rows.push({ label: 'Governing check (DA1-C1)', result: c1.bearing_governs })
  }

  const bru2 = c2.bearing_undrained
  if (bru2?.qu_kPa != null && bru2?.q_applied_kPa != null) {
    rows.push(
      { label: 'qu (undrained, DA1-C2)', expr: `(π+2)×cu,d×bc×ic×sc + q`, result: `${bru2.qu_kPa.toFixed(2)} kPa`, clause: 'EC7 Ann. D.3' },
      { label: 'Applied bearing', expr: `q = P_G / (B' × L)`, result: `${bru2.q_applied_kPa.toFixed(2)} kPa` },
    )
    if (bru2.UR_bearing != null) {
      rows.push({ label: 'Bearing UR (undrained, DA1-C2)', expr: `q_applied / qu`, result: `${bru2.UR_bearing.toFixed(3)}` })
    }
  }

  if (c2.bearing_governs) {
    rows.push({ label: 'Governing check (DA1-C2)', result: c2.bearing_governs })
  }

  return rows
}

function buildConnectionRows(conn: ConnectionCalcResult): DerivationRow[] {
  const rows: DerivationRow[] = []
  const bt = conn.bolt_tension
  if (bt) {
    if (bt.M_Ed_kNm != null) rows.push({ label: 'M_Ed (ULS)', expr: 'from steel module', result: `${bt.M_Ed_kNm.toFixed(2)} kNm`, clause: 'EC3' })
    if (bt.Ds_mm != null) rows.push({ label: 'Lever arm Ds', expr: 'from connection config', result: `${bt.Ds_mm} mm` })
    if (bt.T_total_kN != null) rows.push({ label: 'T_total', expr: `M_Ed×1000 / Ds`, result: `${bt.T_total_kN.toFixed(2)} kN` })
    if (bt.Ft_per_bolt_kN != null && bt.n_tension != null) rows.push({ label: 'Ft per bolt', expr: `T_total / ${bt.n_tension} tension bolts`, result: `${bt.Ft_per_bolt_kN.toFixed(2)} kN` })
    if (bt.FT_Rd_kN != null) rows.push({ label: 'FT,Rd', expr: `0.9 × fub × As / γM2`, result: `${bt.FT_Rd_kN.toFixed(2)} kN`, clause: 'EC3-1-8 Cl 3.6.1' })
    if (bt.UR != null) rows.push({ label: 'UR bolt tension', expr: `Ft / FT,Rd`, result: `${bt.UR.toFixed(3)} ${bt.pass ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }
  const be = conn.bolt_embedment
  if (be) {
    if (be.fbd_N_per_mm2 != null) rows.push({ label: 'fbd', expr: `2.25×η1×η2×fctd`, result: `${be.fbd_N_per_mm2.toFixed(3)} N/mm²`, clause: 'EC2 Cl 8.4.2' })
    if (be.L_required_mm != null && be.L_provided_mm != null) rows.push({ label: 'Embedment length', expr: `Ft / (fbd×π×d)`, result: `${be.L_required_mm.toFixed(1)} mm req'd / ${be.L_provided_mm} mm prov'd` })
  }
  const w = conn.weld
  if (w) {
    if (w.weld_length_mm != null) rows.push({ label: 'Weld length', expr: 'from config', result: `${w.weld_length_mm} mm` })
    if (w.FR_N_per_mm != null && w.Fw_Rd_N_per_mm != null) rows.push({ label: 'Weld demand / capacity', expr: `FR / Fw,Rd`, result: `${w.FR_N_per_mm.toFixed(3)} / ${w.Fw_Rd_N_per_mm.toFixed(3)} N/mm` })
  }
  const gc = conn.g_clamp
  if (gc) {
    if (gc.F_per_clamp_kN != null) rows.push({ label: 'G clamp load', expr: `p×h/2×spacing / n_clamps`, result: `${gc.F_per_clamp_kN.toFixed(2)} kN` })
    if (gc.failure_load_kN != null) rows.push({ label: 'G clamp failure load', expr: 'STS test-based', result: `${gc.failure_load_kN.toFixed(2)} kN` })
  }
  return rows
}

function buildSubframeRows(sf: SubframeCalcResult): DerivationRow[] {
  const rows: DerivationRow[] = []
  if (sf.w_kN_per_m != null) rows.push({ label: 'UDL w', expr: `q_design × subframe_spacing`, result: `${sf.w_kN_per_m.toFixed(3)} kN/m` })
  if (sf.M_Ed_kNm != null) rows.push({ label: 'M_Ed', expr: `1.5 × w × L² / 10`, result: `${sf.M_Ed_kNm.toFixed(2)} kNm`, clause: 'EC3 /10 (P105)' })
  if (sf.Mc_Rd_kNm != null) rows.push({ label: 'Mc,Rd', expr: `1.2 × fy × Wel / γM0`, result: `${sf.Mc_Rd_kNm.toFixed(2)} kNm`, clause: 'EC3 Class 2' })
  if (sf.UR_subframe != null) rows.push({ label: 'UR subframe', expr: `M_Ed / Mc,Rd`, result: `${sf.UR_subframe.toFixed(3)} ${(sf.pass ?? false) ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  return rows
}

function buildLiftingRows(lift: LiftingCalcResult): DerivationRow[] {
  const rows: DerivationRow[] = []
  const hole = lift.hole
  if (hole) {
    if (hole.post_weight_kN != null) rows.push({ label: 'Post self-weight', expr: 'user input', result: `${hole.post_weight_kN.toFixed(1)} kN` })
    if (hole.W_post_factored_kN != null) rows.push({ label: 'Factored hole load', expr: `post_weight × 1.5`, result: `${hole.W_post_factored_kN.toFixed(2)} kN` })
    if (hole.Av_mm2 != null) rows.push({ label: 'Shear area Av', expr: `web area at hole`, result: `${hole.Av_mm2.toFixed(1)} mm²` })
    if (hole.V_Rd_kN != null) rows.push({ label: 'V_Rd hole', expr: `Av × fy/√3 / γM0`, result: `${hole.V_Rd_kN.toFixed(2)} kN`, clause: 'EC3 Cl 6.2.6' })
    if (hole.UR_shear != null) rows.push({ label: 'UR hole shear', expr: `load / V_Rd`, result: `${hole.UR_shear.toFixed(3)} ${(hole.pass_shear ?? false) ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
  }
  const hook = lift.hook
  if (hook) {
    if (hook.W_factored_kN != null) rows.push({ label: 'Factored hook load', expr: `P_G × 1.5`, result: `${hook.W_factored_kN.toFixed(2)} kN` })
    if (hook.F_hook_kN != null && hook.n_hooks != null) rows.push({ label: 'Load per hook', expr: `W_factored / ${hook.n_hooks} hooks`, result: `${hook.F_hook_kN.toFixed(2)} kN` })
    if (hook.FT_Rd_kN != null) rows.push({ label: 'FT,Rd (hook rebar)', expr: `0.9 × fub × As / γM2`, result: `${hook.FT_Rd_kN.toFixed(2)} kN`, clause: 'EC3-1-8 Cl 3.6.1' })
    if (hook.UR_tension != null) rows.push({ label: 'UR hook tension', expr: `F_hook / FT,Rd`, result: `${hook.UR_tension.toFixed(3)} ${(hook.pass_tension ?? false) ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
    if (hook.fbd_N_per_mm2 != null) rows.push({ label: 'fbd', expr: `2.25×fctd`, result: `${hook.fbd_N_per_mm2.toFixed(3)} N/mm²`, clause: 'EC2 Cl 8.4.2' })
    if (hook.L_required_mm != null && hook.L_provided_mm != null) rows.push({ label: 'Bond length', expr: `F_hook / (fbd×π×d)`, result: `${hook.L_required_mm.toFixed(1)} mm req'd / ${hook.L_provided_mm} mm prov'd` })
    if (hook.UR_bond != null) rows.push({ label: 'UR bond', expr: `L_req / L_prov`, result: `${hook.UR_bond.toFixed(3)} ${(hook.pass_bond ?? false) ? '< 1.0 ✓' : '≥ 1.0 ✗'}` })
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
        {steel.section_class != null && (
          <div className="col-span-2 flex items-center gap-4 pt-1 border-t border-border/30">
            <div>
              <p className="text-muted text-xs">Section class</p>
              <p className={`font-mono font-semibold ${steel.section_class >= 4 ? 'text-red-400' : steel.section_class === 3 ? 'text-warning' : 'text-green-400'}`}>
                Class {steel.section_class}
                {steel.class3_wel_used && <span className="ml-1 text-xs font-normal text-warning">(Wel used)</span>}
              </p>
            </div>
            {steel.epsilon != null && (
              <div>
                <p className="text-muted text-xs">ε</p>
                <p className="font-mono">{steel.epsilon.toFixed(3)}</p>
              </div>
            )}
            {steel.cf_tf_ratio != null && (
              <div>
                <p className="text-muted text-xs">cf/tf</p>
                <p className="font-mono">{steel.cf_tf_ratio.toFixed(2)}</p>
              </div>
            )}
            {steel.cw_tw_ratio != null && (
              <div>
                <p className="text-muted text-xs">cw/tw</p>
                <p className="font-mono">{steel.cw_tw_ratio.toFixed(2)}</p>
              </div>
            )}
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

  const hasUndrained = combos.some((c) => c.data.bearing_undrained != null)

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
              <th className="text-left py-1 pr-4 font-medium">Bearing UR (dr.)</th>
              {hasUndrained && <th className="text-left py-1 pr-4 font-medium">Bearing UR (undr.)</th>}
              {hasUndrained && <th className="text-left py-1 pr-4 font-medium">Governs</th>}
              <th className="text-left py-1 pl-2 font-medium">Pass</th>
            </tr>
          </thead>
          <tbody>
            {combos.map(({ key, data }) => (
              <tr key={key} className="border-b border-border/50">
                <td className="py-1.5 pr-4 font-mono font-semibold">{key}</td>
                <td className="py-1.5 pr-4 font-mono">
                  <FosCell value={data.FOS_sliding} limit={data.fos_limit_sliding} pass={data.pass_sliding} />
                </td>
                <td className="py-1.5 pr-4 font-mono">
                  <FosCell value={data.FOS_overturning} limit={data.fos_limit_overturning} pass={data.pass_overturning} />
                </td>
                <td className="py-1.5 pr-4 font-mono">
                  {data.bearing_drained?.UR_bearing != null ? (
                    <UrCell value={data.bearing_drained.UR_bearing} pass={data.pass_bearing} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                {hasUndrained && (
                  <td className="py-1.5 pr-4 font-mono">
                    {data.bearing_undrained?.UR_bearing != null ? (
                      <UrCell value={data.bearing_undrained.UR_bearing} pass={data.pass_bearing} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                )}
                {hasUndrained && (
                  <td className="py-1.5 pr-4 font-sans text-muted">
                    {data.bearing_governs ?? '—'}
                  </td>
                )}
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

function ConnectionPanel({ conn }: { conn: ConnectionCalcResult }) {
  const checks = [
    { label: 'Bolt tension',         demand: conn.bolt_tension?.Ft_per_bolt_kN != null ? `${conn.bolt_tension.Ft_per_bolt_kN.toFixed(2)} kN` : '—', capacity: conn.bolt_tension?.FT_Rd_kN != null ? `${conn.bolt_tension.FT_Rd_kN.toFixed(2)} kN` : '—', ur: conn.bolt_tension?.UR, pass: conn.bolt_tension?.pass ?? false },
    { label: 'Bolt shear',           demand: conn.bolt_shear?.Fv_per_bolt_kN != null ? `${conn.bolt_shear.Fv_per_bolt_kN.toFixed(2)} kN` : '—', capacity: conn.bolt_shear?.Fv_Rd_kN != null ? `${conn.bolt_shear.Fv_Rd_kN.toFixed(2)} kN` : '—', ur: conn.bolt_shear?.UR, pass: conn.bolt_shear?.pass ?? false },
    ...(conn.bolt_bearing != null ? [{ label: 'Bolt bearing', demand: '—', capacity: conn.bolt_bearing.Fb_Rd_kN != null ? `${conn.bolt_bearing.Fb_Rd_kN.toFixed(2)} kN` : '—', ur: conn.bolt_bearing.UR, pass: conn.bolt_bearing.pass ?? false }] : []),
    { label: 'Bolt combined',        demand: '—', capacity: '—', ur: conn.bolt_combined?.UR, pass: conn.bolt_combined?.pass ?? false },
    { label: 'Bolt embedment',       demand: conn.bolt_embedment?.L_required_mm != null ? `${conn.bolt_embedment.L_required_mm.toFixed(0)} mm` : '—', capacity: conn.bolt_embedment?.L_provided_mm != null ? `${conn.bolt_embedment.L_provided_mm} mm` : '—', ur: conn.bolt_embedment?.UR, pass: conn.bolt_embedment?.pass ?? false },
    { label: 'Weld',                 demand: conn.weld?.FR_N_per_mm != null ? `${conn.weld.FR_N_per_mm.toFixed(3)} N/mm` : '—', capacity: conn.weld?.Fw_Rd_N_per_mm != null ? `${conn.weld.Fw_Rd_N_per_mm.toFixed(3)} N/mm` : '—', ur: conn.weld?.UR, pass: conn.weld?.pass ?? false },
    { label: 'Base plate — bearing', demand: '—', capacity: conn.base_plate?.base_plate_bearing?.compression_resistance_kN != null ? `${conn.base_plate.base_plate_bearing.compression_resistance_kN.toFixed(1)} kN` : '—', ur: conn.base_plate?.base_plate_bearing?.UR, pass: conn.base_plate?.base_plate_bearing?.pass ?? false },
    ...(conn.base_plate?.base_plate_bending != null ? [{ label: 'Base plate — bending', demand: conn.base_plate.base_plate_bending.M_demand_kNm != null ? `${conn.base_plate.base_plate_bending.M_demand_kNm.toFixed(3)} kNm` : '—', capacity: conn.base_plate.base_plate_bending.M_cap_kNm != null ? `${conn.base_plate.base_plate_bending.M_cap_kNm.toFixed(3)} kNm` : '—', ur: conn.base_plate.base_plate_bending.UR, pass: conn.base_plate.base_plate_bending.pass ?? false }] : []),
    { label: 'G clamp',              demand: conn.g_clamp?.F_per_clamp_kN != null ? `${conn.g_clamp.F_per_clamp_kN.toFixed(2)} kN` : '—', capacity: conn.g_clamp?.failure_load_kN != null ? `${conn.g_clamp.failure_load_kN.toFixed(2)} kN` : '—', ur: conn.g_clamp?.UR, pass: conn.g_clamp?.pass ?? false },
  ]
  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Connection Design</p>
        <PassBadge pass={conn.all_checks_pass ?? false} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="text-left py-1 pr-3 font-medium">Check</th>
              <th className="text-left py-1 pr-3 font-medium">Demand</th>
              <th className="text-left py-1 pr-3 font-medium">Capacity</th>
              <th className="text-left py-1 pr-3 font-medium">UR</th>
              <th className="text-left py-1 font-medium">Pass</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.label} className="border-b border-border/50">
                <td className="py-1.5 pr-3 font-sans">{c.label}</td>
                <td className="py-1.5 pr-3 font-mono text-muted">{c.demand}</td>
                <td className="py-1.5 pr-3 font-mono text-muted">{c.capacity}</td>
                <td className="py-1.5 pr-3 font-mono">
                  {c.ur != null ? <UrCell value={c.ur} pass={c.pass} /> : <span className="text-muted">—</span>}
                </td>
                <td className="py-1.5"><PassBadge pass={c.pass} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DerivationPanel rows={buildConnectionRows(conn)} />
    </div>
  )
}

function SubframePanel({ sf }: { sf: SubframeCalcResult }) {
  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Horizontal Subframe</p>
        <PassBadge pass={sf.pass ?? false} />
      </div>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-muted text-xs">Section</p>
          <p className="font-mono">{sf.designation ?? '—'}</p>
        </div>
        <div>
          <p className="text-muted text-xs">M_Ed</p>
          <p className="font-mono">{sf.M_Ed_kNm != null ? `${sf.M_Ed_kNm.toFixed(2)} kNm` : '—'}</p>
        </div>
        <div>
          <p className="text-muted text-xs">Mc,Rd</p>
          <p className="font-mono">{sf.Mc_Rd_kNm != null ? `${sf.Mc_Rd_kNm.toFixed(2)} kNm` : '—'}</p>
        </div>
        <div>
          <p className="text-muted text-xs">UR</p>
          <p className="font-mono">
            {sf.UR_subframe != null
              ? <UrCell value={sf.UR_subframe} pass={sf.UR_subframe < 1.0} />
              : '—'}
          </p>
        </div>
      </div>
      {sf.hardware_note && (
        <p className="text-xs text-warning/80 border border-warning/30 rounded px-2 py-1.5 bg-warning/5">
          ⚠ {sf.hardware_note}
        </p>
      )}
      <DerivationPanel rows={buildSubframeRows(sf)} />
    </div>
  )
}

function LiftingPanel({ lift }: { lift: LiftingCalcResult }) {
  const hole = lift.hole
  const hook = lift.hook
  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Lifting</p>
        <PassBadge pass={lift.all_checks_pass ?? false} />
      </div>

      {hole && (
        <div>
          <p className="text-xs text-muted mb-1.5">Lifting hole — post web shear</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-muted text-xs">Factored load</p>
              <p className="font-mono">{hole.W_post_factored_kN != null ? `${hole.W_post_factored_kN.toFixed(1)} kN` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">V_Rd hole</p>
              <p className="font-mono">{hole.V_Rd_kN != null ? `${hole.V_Rd_kN.toFixed(1)} kN` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">UR</p>
              <p className="font-mono">
                {hole.UR_shear != null
                  ? <UrCell value={hole.UR_shear} pass={hole.pass_shear ?? false} />
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {hook && (
        <div className="border-t border-border/30 pt-3">
          <p className="text-xs text-muted mb-1.5">Lifting hooks — footing rebar</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-muted text-xs">Load per hook</p>
              <p className="font-mono">{hook.F_hook_kN != null ? `${hook.F_hook_kN.toFixed(2)} kN` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">FT,Rd</p>
              <p className="font-mono">{hook.FT_Rd_kN != null ? `${hook.FT_Rd_kN.toFixed(2)} kN` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">UR tension</p>
              <p className="font-mono">
                {hook.UR_tension != null
                  ? <UrCell value={hook.UR_tension} pass={hook.pass_tension ?? false} />
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted text-xs">Bond L_req</p>
              <p className="font-mono">{hook.L_required_mm != null ? `${hook.L_required_mm.toFixed(1)} mm` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">Bond L_prov</p>
              <p className="font-mono">{hook.L_provided_mm != null ? `${hook.L_provided_mm} mm` : '—'}</p>
            </div>
            <div>
              <p className="text-muted text-xs">UR bond</p>
              <p className="font-mono">
                {hook.UR_bond != null
                  ? <UrCell value={hook.UR_bond} pass={hook.pass_bond ?? false} />
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}
      <DerivationPanel rows={buildLiftingRows(lift)} />
    </div>
  )
}

// ─── Section selection cards ──────────────────────────────────────────────────

function SectionCard({
  result,
  onOptimise,
  onConfirmAndContinue,
  isOptimising,
  isPhase2Loading,
  canRun,
}: {
  result: SelectionResult
  onOptimise: () => void
  onConfirmAndContinue: () => void
  isOptimising: boolean
  isPhase2Loading: boolean
  canRun: boolean
}) {
  const { section, checks, source, fallback_reason } = result
  const allPass = checks.pass
  const gradeLabel = section.fy_N_per_mm2 >= 355 ? 'S355' : 'S275'
  const sourceLabel =
    source === 'live' ? 'Continental Steel (live)' : source === 'cache' ? 'Library (cached)' : 'Pre-selected'
  const confirmDisabled = !canRun || isPhase2Loading

  return (
    <div className="rounded border border-border bg-surface/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-mono font-semibold text-white text-base">UB {section.designation}</span>
          <span className="ml-2 text-muted text-sm">{gradeLabel} · {section.mass_kg_per_m} kg/m</span>
        </div>
        <PassBadge pass={allPass} />
      </div>
      <p className="text-xs text-muted">Source: {sourceLabel}</p>
      {fallback_reason && (
        <p className="text-xs text-warning/80">{fallback_reason}</p>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted mb-0.5">UR moment</p>
          <span className={checks.UR_moment < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_moment.toFixed(3)} {checks.UR_moment < 1.0 ? '✓' : '✗'}
          </span>
        </div>
        <div>
          <p className="text-muted mb-0.5">UR deflection</p>
          <span className={checks.UR_deflection < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_deflection.toFixed(3)} {checks.UR_deflection < 1.0 ? '✓' : '✗'}
          </span>
        </div>
        <div>
          <p className="text-muted mb-0.5">UR shear</p>
          <span className={checks.UR_shear < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_shear.toFixed(3)} {checks.UR_shear < 1.0 ? '✓' : '✗'}
          </span>
        </div>
      </div>
      {allPass ? (
        <p className="text-xs text-green-400">All checks pass</p>
      ) : (
        <p className="text-xs text-warning">Some checks fail — optimisation recommended</p>
      )}
      {!canRun && (
        <p className="text-xs text-red-400/80">Fill all foundation fields above to enable confirmation.</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onOptimise}
          disabled={isOptimising || isPhase2Loading}
          className={`btn-primary px-4 py-1.5 text-xs font-medium ${(isOptimising || isPhase2Loading) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isOptimising ? 'Optimising…' : 'Optimize Selection'}
        </button>
        <button
          type="button"
          onClick={onConfirmAndContinue}
          disabled={confirmDisabled}
          title={!canRun ? 'Fill all foundation fields to enable' : undefined}
          className={`px-4 py-1.5 text-xs font-medium border border-border rounded transition-colors ${confirmDisabled ? 'opacity-40 cursor-not-allowed text-muted' : 'hover:border-accent'}`}
        >
          {isPhase2Loading ? 'Calculating…' : 'Confirm & Continue →'}
        </button>
      </div>
    </div>
  )
}

function OptimisedCard({
  result,
  onConfirm,
  onChange,
  isPhase2Loading,
}: {
  result: OptimiseResult
  onConfirm: () => void
  onChange: () => void
  isPhase2Loading: boolean
}) {
  const { selected_section: sec, checks, optimisation_case, iterations, optimised } = result
  const maxUR = Math.max(checks.UR_moment, checks.UR_deflection, checks.UR_shear)
  const gradeLabel = (sec.fy_N_per_mm2 ?? 275) >= 355 ? 'S355' : 'S275'

  return (
    <div className="rounded border border-accent/40 bg-accent/5 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-mono font-semibold text-white text-base">UB {sec.designation}</span>
          <span className="ml-2 text-muted text-sm">{gradeLabel} · {sec.mass_kg_per_m} kg/m</span>
        </div>
        <span className="text-xs text-accent font-medium">
          Optimised {optimised ? '✓' : ''} (Case {optimisation_case} — {iterations} iter.)
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted mb-0.5">UR moment</p>
          <span className={checks.UR_moment < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_moment.toFixed(3)} {checks.UR_moment < 1.0 ? '✓' : '✗'}
            {checks.UR_moment >= 0.95 && <span className="ml-1 text-accent">(≥0.95)</span>}
          </span>
        </div>
        <div>
          <p className="text-muted mb-0.5">UR deflection</p>
          <span className={checks.UR_deflection < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_deflection.toFixed(3)} {checks.UR_deflection < 1.0 ? '✓' : '✗'}
            {checks.UR_deflection >= 0.95 && <span className="ml-1 text-accent">(≥0.95)</span>}
          </span>
        </div>
        <div>
          <p className="text-muted mb-0.5">UR shear</p>
          <span className={checks.UR_shear < 1.0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
            {checks.UR_shear.toFixed(3)} {checks.UR_shear < 1.0 ? '✓' : '✗'}
            {checks.UR_shear >= 0.95 && <span className="ml-1 text-accent">(≥0.95)</span>}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted">{result.message}</p>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPhase2Loading}
          className={`btn-primary px-4 py-1.5 text-xs font-semibold ${isPhase2Loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isPhase2Loading ? 'Calculating…' : 'Confirm & Continue →'}
        </button>
        <button
          type="button"
          onClick={onChange}
          disabled={isPhase2Loading}
          className={`px-4 py-1.5 text-xs font-medium border border-border rounded hover:border-accent transition-colors ${isPhase2Loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Change
        </button>
      </div>
    </div>
  )
}

function OverallBanner({ results }: { results: CalculationResults }) {
  const steelPass = results.steel.pass
  const foundationPass = results.foundation.pass
  const connPass = results.connection?.all_checks_pass ?? true
  const sfPass = results.subframe?.pass ?? true
  const liftPass = results.lifting?.all_checks_pass ?? true
  const allPass = steelPass && foundationPass && connPass && sfPass && liftPass

  const failCount = [steelPass, foundationPass, connPass, sfPass, liftPass].filter((p) => !p).length

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
    phase1_result,
    confirmed_section,
    setDesignParameters,
    setCalculationResults,
    setPhase1Result,
    setConfirmedSection,
    confirmStep3,
    step3_confirmed,
  } = useProjectStore()

  const [phase1Loading, setPhase1Loading] = useState(false)
  const [phase2Loading, setPhase2Loading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  // ── Section selection flow state ──
  const [isOptimising, setIsOptimising] = useState(false)
  const [optimiseResult, setOptimiseResult] = useState<OptimiseResult | null>(null)
  const [sectionCleared, setSectionCleared] = useState(false)

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

  // Auto-clear Phase 1 + Phase 2 results when wind/post params change.
  // Foundation param changes deliberately excluded — they don't affect Phase 1.
  const clearTrigger = `${dp.post_spacing}|${dp.post_length}|${dp.subframe_spacing}|${structureHeight}|${dp.return_period}|${dp.vb.effective}|${dp.shelter_factor.effective}|${dp.cp_net}`
  useEffect(() => {
    if (confirmed_section || phase1_result || calculation_results) {
      setConfirmedSection(null)
      setPhase1Result(null)
      setCalculationResults(null)
      setOptimiseResult(null)
      setSectionCleared(true)
    }
  // Only fire on structural param changes, not on the results themselves
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTrigger])

  // Phase 1 enabled when wind + post fields are filled (no foundation needed yet)
  const canPhase1 =
    structureHeight != null &&
    dp.post_spacing != null &&
    dp.subframe_spacing != null &&
    dp.post_length != null

  // Phase 2 enabled when all fields are filled (foundation required)
  const canRun =
    canPhase1 &&
    dp.footing_type != null &&
    dp.footing_B_m != null &&
    dp.footing_L_m != null &&
    dp.footing_D_m != null &&
    dp.vertical_load_G_kN != null

  // Shared wind+post body used by both phases
  function windPostBody() {
    return {
      structure_height: structureHeight,
      shelter_factor: dp.shelter_factor.override ?? (computedShelterFactor ?? dp.shelter_factor.calculated),
      vb: dp.vb.override !== null ? dp.vb.effective : undefined,
      return_period: dp.return_period,
      cp_net: dp.cp_net ?? 1.2,
      post_spacing: dp.post_spacing,
      subframe_spacing: dp.subframe_spacing,
      post_length: dp.post_length,
      deflection_limit_n: dp.deflection_limit_n,
      remarks: dp.remarks ?? '',
    }
  }

  // Map the flat section_result dict from the API into a SelectionResult
  function mapSectionResult(raw: Record<string, unknown>): SelectionResult {
    const L_mm = (dp.post_length ?? 0) * 1000
    const Lcr_mm = (dp.subframe_spacing ?? 0) * 1000
    return {
      section: {
        designation: raw.designation as string,
        mass_kg_per_m: raw.mass_kg_per_m as number,
        h_mm: (raw.h_mm as number) ?? 0,
        b_mm: (raw.b_mm as number) ?? 0,
        tf_mm: (raw.tf_mm as number) ?? 0,
        tw_mm: (raw.tw_mm as number) ?? 0,
        r_mm: (raw.r_mm as number) ?? 0,
        Iy_cm4: (raw.Iy_cm4 as number) ?? 0,
        Iz_cm4: (raw.Iz_cm4 as number) ?? 0,
        Wpl_y_cm3: (raw.Wpl_y_cm3 as number) ?? 0,
        Wel_y_cm3: (raw.Wel_y_cm3 as number) ?? 0,
        Iw_dm6: (raw.Iw_dm6 as number) ?? 0,
        It_cm4: (raw.It_cm4 as number) ?? 0,
        fy_N_per_mm2: (raw.fy_N_per_mm2 as number) ?? 275,
      },
      checks: {
        UR_moment: (raw.UR_moment as number) ?? 0,
        UR_deflection: (raw.UR_deflection as number) ?? 0,
        UR_shear: (raw.UR_shear as number) ?? 0,
        pass: (raw.pass as boolean) ?? false,
      },
      source: (raw.source as SelectionResult['source']) ?? 'cache',
      fallback_reason: (raw.fallback_reason as string | null) ?? null,
      all_sections: (raw.all_sections as SteelSection[]) ?? [],
      M_Ed_kNm: (raw.M_Ed_kNm as number) ?? 0,
      V_Ed_kN: (raw.V_Ed_kN as number) ?? 0,
      w_kN_per_m: (raw.w_kN_per_m as number) ?? 0,
      L_mm: (raw.L_mm as number) ?? L_mm,
      Lcr_mm: (raw.Lcr_mm as number) ?? Lcr_mm,
    }
  }

  // Phase 1 — wind + section search
  async function handleRunPhase1() {
    if (!canPhase1) return
    setPhase1Loading(true)
    setApiError(null)
    setOptimiseResult(null)
    setSectionCleared(false)
    try {
      const res = await fetch('/api/wind-and-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(windPostBody()),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.section_result?.error && !data.section_result?.designation) {
        throw new Error(data.section_result.error)
      }
      const phase1: Phase1Result = {
        wind_result: data.wind_result as WindCalcResult,
        section_result: mapSectionResult(data.section_result),
      }
      setPhase1Result(phase1)
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Phase 1 failed')
    } finally {
      setPhase1Loading(false)
    }
  }

  // Phase 2 — full calculation chain using confirmed section
  async function handleRunPhase2(section: SteelSection) {
    if (!canRun) return
    setConfirmedSection(section)
    setPhase2Loading(true)
    setApiError(null)
    try {
      const body = {
        ...windPostBody(),
        footing_type: dp.footing_type,
        fck: dp.fck ?? 25,
        phi_k: dp.phi_k,
        gamma_s: dp.gamma_s,
        cohesion_ck: dp.cohesion_ck,
        allowable_soil_bearing: dp.allowable_soil_bearing,
        footing_B: dp.footing_B_m,
        footing_W: dp.footing_L_m,   // L (along barrier) → API footing_W
        footing_D: dp.footing_D_m,
        vertical_load_G_kN: dp.vertical_load_G_kN,
        post_weight_kN: dp.post_weight_kN ?? 6,
        cu_kPa: dp.cu_kPa ?? 0,
        pre_selected_section: section,
        // use_retrieval defaults to false on the backend — no web search in Phase 2
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
      setApiError(e instanceof Error ? e.message : 'Phase 2 failed')
    } finally {
      setPhase2Loading(false)
    }
  }

  // Clear everything and return to initial state so engineer can restart Phase 1
  function handleChangeSection() {
    setConfirmedSection(null)
    setPhase1Result(null)
    setCalculationResults(null)
    setOptimiseResult(null)
    setSectionCleared(false)
  }

  async function handleOptimise() {
    const sr = phase1_result?.section_result
    if (!sr) return
    setIsOptimising(true)
    try {
      const body = {
        section: sr.section,
        w_kN_per_m: sr.w_kN_per_m,
        L_mm: sr.L_mm,
        Lcr_mm: sr.Lcr_mm,
        post_length_m: dp.post_length,
        deflection_limit_n: dp.deflection_limit_n,
        M_Ed_kNm: sr.M_Ed_kNm,
        V_Ed_kN: sr.V_Ed_kN,
      }
      const res = await fetch('/api/optimize-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.detail ?? `HTTP ${res.status}`)
      }
      const data: OptimiseResult = await res.json()
      setOptimiseResult(data)
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Optimisation failed')
    } finally {
      setIsOptimising(false)
    }
  }

  const vbOverridden = dp.vb.override !== null
  const shelterOverridden = dp.shelter_factor.override !== null
  const phase1Complete = phase1_result != null
  // Wind results available from Phase 1 onwards; Phase 2 wind overrides with same values
  const windResult: WindCalcResult | null = (calculation_results?.wind ?? phase1_result?.wind_result) ?? null

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

            <Field label="Panel type (cp,net)" hint="Porous TNCB panels = 1.2 (standard). Solid panels — confirm value with PE.">
              <select
                className="field-input"
                value={dp.cp_net ?? 1.2}
                onChange={(e) => set({ cp_net: parseFloat(e.target.value) })}
              >
                <option value={1.2}>Porous (cp,net = 1.2)</option>
                <option value={1.3}>Solid — confirm with PE (cp,net = 1.3)</option>
              </select>
            </Field>
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

            <Field label="Concrete grade fck (N/mm²)" hint="C25/30 → 25, C28/35 → 28, C30/37 → 30. Check project specification.">
              <input
                type="number" min={20} max={50} step={1}
                className="field-input"
                value={dp.fck ?? 25}
                onChange={(e) => set({ fck: parseFloat(e.target.value) || 25 })}
              />
            </Field>

            <Field label="Post self-weight (kN)" hint="Steel post only — not including footing. Used for lifting hole shear check (footing not yet cast when post is lifted via web holes).">
              <input
                type="number" min={0.1} step={0.1}
                className="field-input"
                value={dp.post_weight_kN ?? 6}
                onChange={(e) => set({ post_weight_kN: parseFloat(e.target.value) || 6 })}
              />
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

            <Field label="Undrained shear strength cu (kPa)" hint="Soft clay only. Leave 0 for sand or gravel. P105 uses 30 kPa. When > 0, both drained and undrained bearing checks run." provisional>
              <input
                type="number" min={0} step={5}
                className="field-input"
                value={dp.cu_kPa ?? 0}
                onChange={(e) => set({ cu_kPa: parseFloat(e.target.value) || 0 })}
              />
            </Field>
          </FieldGroup>

          {/* ── Additional Considerations ── */}
          <div className="panel space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Additional Considerations</p>
            <Field
              label="Additional Considerations"
              hint="Optional. Any site-specific conditions, PE instructions, or project requirements that should influence section selection."
              span
            >
              <textarea
                rows={3}
                placeholder="e.g. Limited headroom — prefer shallower sections. Adjacent to sensitive receiver — minimise deflection."
                className="w-full border border-border rounded px-3 py-2 text-sm bg-transparent text-foreground placeholder-muted/40 focus:outline-none focus:border-accent resize-none"
                value={dp.remarks ?? ''}
                onChange={(e) => set({ remarks: e.target.value })}
              />
            </Field>
          </div>

          {/* ── Section Selection ── */}
          <div className="panel space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Section Selection</p>

            {sectionCleared && !phase1Complete && !confirmed_section && (
              <p className="text-xs text-warning/80 border border-warning/30 rounded px-3 py-2 bg-warning/5">
                Parameters changed — results cleared. Click Run Calculations to re-run.
              </p>
            )}

            {/* Re-run banner: confirmed section exists but Phase 1 not shown (returned from Step 4) */}
            {confirmed_section && !phase1Complete && (
              <div className="flex items-center gap-2 rounded border border-accent/30 bg-accent/5 px-4 py-2.5 text-sm text-accent">
                <span>Using confirmed section: <span className="font-mono font-semibold">UB {confirmed_section.designation}</span></span>
                <button
                  type="button"
                  onClick={handleChangeSection}
                  className="ml-auto text-xs text-muted hover:text-accent underline"
                >
                  Change Section to re-select
                </button>
              </div>
            )}

            {/* Run Calculations button — shown when no Phase 1 result, or when confirmed section (re-run) */}
            {(!phase1Complete || confirmed_section != null) && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={confirmed_section ? () => handleRunPhase2(confirmed_section) : handleRunPhase1}
                  disabled={confirmed_section ? (!canRun || phase2Loading) : (!canPhase1 || phase1Loading)}
                  className={`btn-primary px-5 py-2 text-sm font-semibold ${
                    (confirmed_section ? (!canRun || phase2Loading) : (!canPhase1 || phase1Loading))
                      ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {phase1Loading ? 'Searching…' : phase2Loading ? 'Calculating…' : 'Run Calculations'}
                </button>
                {!confirmed_section && !canPhase1 && (
                  <p className="text-xs text-muted">Fill wind + post fields to enable</p>
                )}
                {confirmed_section && !canRun && (
                  <p className="text-xs text-muted">Fill all required fields to enable</p>
                )}
              </div>
            )}

            {apiError && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <strong>Error:</strong> {apiError}
              </div>
            )}

            {/* Phase 1 section card — shown after search, before confirmation */}
            {phase1Complete && !confirmed_section && !optimiseResult && (
              <SectionCard
                result={phase1_result!.section_result}
                onOptimise={handleOptimise}
                onConfirmAndContinue={() => handleRunPhase2(phase1_result!.section_result.section)}
                isOptimising={isOptimising}
                isPhase2Loading={phase2Loading}
                canRun={canRun}
              />
            )}

            {phase1Complete && !confirmed_section && optimiseResult && (
              <OptimisedCard
                result={optimiseResult}
                onConfirm={() => handleRunPhase2(optimiseResult.selected_section)}
                onChange={() => setOptimiseResult(null)}
                isPhase2Loading={phase2Loading}
              />
            )}

            {/* Confirmed section banner — shown after Phase 2 runs */}
            {confirmed_section && (
              <div className="flex items-center gap-2 rounded border border-green-500/40 bg-green-500/10 px-4 py-2.5 text-sm text-green-400">
                <span className="font-bold">✓</span>
                <span>
                  Section confirmed: <span className="font-mono font-semibold">UB {confirmed_section.designation}</span>
                  {' '}({confirmed_section.fy_N_per_mm2 >= 355 ? 'S355' : 'S275'}, {confirmed_section.mass_kg_per_m} kg/m)
                </span>
                <button
                  type="button"
                  onClick={handleChangeSection}
                  className="ml-auto text-xs text-muted hover:text-accent underline"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* ── Results (shown from Phase 1 onwards) ── */}
          {(windResult || calculation_results) && (
            <div className="space-y-4 pt-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted">Results</p>

              {windResult && (
                <WindPanel
                  wind={windResult}
                  vbOverridden={vbOverridden}
                  shelterOverridden={shelterOverridden}
                />
              )}

              {calculation_results && (
                <>
                  <SteelPanel steel={calculation_results.steel} />
                  <FoundationPanel foundation={calculation_results.foundation} />
                  {calculation_results.connection && (
                    <ConnectionPanel conn={calculation_results.connection} />
                  )}
                  {calculation_results.subframe && (
                    <SubframePanel sf={calculation_results.subframe} />
                  )}
                  {calculation_results.lifting && (
                    <LiftingPanel lift={calculation_results.lifting} />
                  )}
                  <OverallBanner results={calculation_results} />
                </>
              )}
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
