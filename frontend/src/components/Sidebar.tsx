import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useProjectStore, useUnlockedUpTo } from '../store/projectStore'
import { STEPS, type StepStatus } from '../types'

function stepStatus(
  stepNumber: number,
  step1Confirmed: boolean,
  step2Confirmed: boolean,
  currentStep: number,
): StepStatus {
  if (stepNumber === 1 && step1Confirmed) return 'complete'
  if (stepNumber === 2 && step2Confirmed) return 'complete'
  if (stepNumber === currentStep) return 'in-progress'
  return 'not-started'
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'complete') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20 text-success text-xs font-bold">
        ✓
      </span>
    )
  }
  if (status === 'in-progress') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent">
        <span className="h-2 w-2 rounded-full bg-accent" />
      </span>
    )
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border" />
  )
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  // Derive current step from pathname since step routes are static, not parameterised
  const stepMatch = location.pathname.match(/\/step\/(\d+)$/)
  const currentStep = stepMatch ? parseInt(stepMatch[1], 10) : 1
  const unlockedUpTo = useUnlockedUpTo()
  const { project_info, site_data } = useProjectStore()

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel">
      {/* Back to projects */}
      <div className="border-b border-border px-6 py-4">
        <button
          onClick={() => navigate('/')}
          className="mb-3 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-white"
        >
          ← Projects
        </button>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Union Noise</p>
        <p className="mt-0.5 text-sm font-semibold text-white">Barrier Design System</p>
      </div>

      {/* Step list */}
      <nav className="flex-1 py-4">
        {STEPS.map((s) => {
          const locked = s.number > unlockedUpTo
          const isActive = s.number === currentStep
          const status = stepStatus(
            s.number,
            project_info.step1_confirmed,
            site_data.step2_confirmed,
            currentStep,
          )

          return (
            <button
              key={s.number}
              disabled={locked}
              onClick={() => {
                if (!locked) navigate(`/project/${id}/step/${s.number}`)
              }}
              className={[
                'flex w-full items-start gap-3 px-5 py-3 text-left transition-colors',
                isActive
                  ? 'bg-accent/10 text-white'
                  : locked
                  ? 'cursor-not-allowed text-muted/40'
                  : 'text-muted hover:bg-white/5 hover:text-white',
              ].join(' ')}
            >
              <div className="mt-0.5 shrink-0">
                <StatusIcon status={status} />
              </div>
              <div className="min-w-0">
                <p
                  className={[
                    'text-xs font-semibold uppercase tracking-wide',
                    isActive ? 'text-accent' : '',
                  ].join(' ')}
                >
                  Step {s.number}
                </p>
                <p className="truncate text-sm font-medium leading-tight">{s.title}</p>
                <p className="mt-0.5 truncate text-xs opacity-60">{s.subtitle}</p>
              </div>
            </button>
          )
        })}
      </nav>

      {/* Bottom metadata */}
      <div className="border-t border-border px-5 py-4">
        <p className="text-xs text-muted">v0.2.0 — prototype</p>
        <p className="mt-0.5 text-xs text-muted/50">Hebei Jinbiao / Union Noise</p>
      </div>
    </aside>
  )
}
