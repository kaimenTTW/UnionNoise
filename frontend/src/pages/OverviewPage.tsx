import { useNavigate } from 'react-router-dom'
import { useProjects } from '../hooks/useProjects'
import type { Project } from '../types'

// ─── Old Projects row ─────────────────────────────────────────────────────────

function ProjectRow({ project }: { project: Project }) {
  const navigate = useNavigate()

  const handleClick = () => {
    // TODO: revision vs overwrite decision pending — see PRD Section 13
    // Stub: navigates to the project workflow; in future, GET /api/projects/:id
    // hydrates ProjectContext then navigates to the last visited step.
    navigate(`/project/${project.id}`)
  }

  return (
    <button
      onClick={handleClick}
      className="flex w-full items-center gap-4 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] last:border-b-0"
    >
      <span className="flex-1 min-w-0 truncate text-sm font-medium text-white">{project.project_name}</span>
      <span className="w-16 shrink-0 font-mono text-xs text-accent/80">{project.barrier_type}</span>
      <span className="w-48 shrink-0 truncate text-xs text-muted">{project.location}</span>
      <span className="w-24 shrink-0 text-xs text-muted">
        {new Date(project.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <StatusBadge status={project.status} />
    </button>
  )
}

function StatusBadge({ status }: { status: Project['status'] }) {
  if (status === 'complete') {
    return (
      <span className="w-16 shrink-0 inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-semibold bg-success/15 text-success">
        Complete
      </span>
    )
  }
  return (
    <span className="w-16 shrink-0 inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-semibold bg-warning/15 text-warning">
      Draft
    </span>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  label,
  description,
  onClick,
  active,
}: {
  label: string
  description: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex flex-col gap-1 rounded-lg border px-6 py-5 text-left transition-colors w-full',
        active
          ? 'border-accent/60 bg-accent/5 text-white'
          : 'border-border bg-panel text-white hover:border-accent/40 hover:bg-white/[0.03]',
      ].join(' ')}
    >
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs text-muted">{description}</span>
    </button>
  )
}

// ─── Overview page ────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const navigate = useNavigate()
  const projects = useProjects()

  // Recent projects: top 5 sorted by most recent created_at
  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)

  return (
    <div className="flex h-screen flex-col bg-surface text-white font-['Inter',sans-serif]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-panel px-8 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Union Noise</p>
          <p className="mt-0.5 text-lg font-semibold text-white">Barrier Design System</p>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-3xl space-y-8">

          {/* Three action buttons */}
          <div className="grid grid-cols-3 gap-4">
            <ActionButton
              label="+ New Project"
              description="Start a fresh design from a tender brief"
              onClick={() => navigate('/project/new')}
            />
            <ActionButton
              label="Projects Library"
              description="Browse and reload past projects"
              onClick={() => navigate('/projects-library')}
            />
            <ActionButton
              label="Master Data"
              description="Upload member library and reference data"
              onClick={() => navigate('/master-data')}
            />
          </div>

          {/* Recent Projects */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
              Recent Projects
            </p>
            <div className="rounded-lg border border-border overflow-hidden">
              {/* Column headers */}
              <div className="flex items-center gap-4 border-b border-border/50 bg-panel px-4 py-2">
                <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted">Name</span>
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Type</span>
                <span className="w-48 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Location</span>
                <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Date</span>
                <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">Status</span>
              </div>
              {recentProjects.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">No projects yet.</div>
              ) : (
                recentProjects.map((p) => <ProjectRow key={p.id} project={p} />)
              )}
            </div>
          </div>

        </div>
      </main>

      <footer className="border-t border-border px-8 py-3">
        <p className="text-xs text-muted/50">v0.2.0 — prototype · Hebei Jinbiao / Union Noise</p>
      </footer>
    </div>
  )
}
