import { useNavigate } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'

export default function Step5() {
  useStepGuard(5)
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 5</span>
          <h1 className="step-title">Verification</h1>
        </div>
        <p className="step-subtitle">
          Review utilisation ratios across all structural checks.
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full border border-border p-6 text-4xl text-muted">✓</div>
        <p className="text-lg font-medium text-white">Structural Acceptance Gate</p>
        <p className="max-w-md text-sm text-muted">
          All structural checks (UR &lt; 1.0) will be displayed here once the calculation engine is
          implemented. Includes: moment/torsional buckling, deflection, bolt checks, weld,
          foundation sliding, overturning, and bearing.
        </p>
        <div className="rounded border border-border bg-panel px-4 py-3 text-xs text-muted">
          Coming in next iteration — confirmed check list from PE calculation report (Lawson Chung).
        </div>
      </div>

      <div className="flex justify-end border-t border-border px-6 py-4">
        <button onClick={() => navigate('/step/6')} className="btn-primary">
          Continue →
        </button>
      </div>
    </div>
  )
}
