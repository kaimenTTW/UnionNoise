import { useNavigate } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'

export default function Step4() {
  useStepGuard(4)
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 4</span>
          <h1 className="step-title">Member Selection</h1>
        </div>
        <p className="step-subtitle">
          Choose structural members from the approved parts library.
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full border border-border p-6 text-4xl text-muted">⚙</div>
        <p className="text-lg font-medium text-white">Member Selection</p>
        <p className="max-w-md text-sm text-muted">
          The engineering rules engine and parts library are not yet implemented.
          This step will allow selection of UB sections, base plates, anchor bolts, and foundation
          members from the pre-approved library.
        </p>
        <div className="rounded border border-border bg-panel px-4 py-3 text-xs text-muted">
          Coming in next iteration — depends on confirmed parts library from client.
        </div>
      </div>

      <div className="flex justify-end border-t border-border px-6 py-4">
        <button onClick={() => navigate('/step/5')} className="btn-primary">
          Continue →
        </button>
      </div>
    </div>
  )
}
