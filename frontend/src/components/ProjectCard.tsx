import { useNavigate } from 'react-router-dom'
import type { Project } from '../types'

function StatusBadge({ status }: { status: Project['status'] }) {
  if (status === 'complete') {
    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-success/15 text-success">
        Complete
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-warning/15 text-warning">
      Draft
    </span>
  )
}

export default function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(`/project/${project.id}`)}
      className="panel w-full text-left transition-colors hover:border-accent/40 hover:bg-white/[0.03] active:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{project.project_name}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{project.location}</p>
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span className="rounded bg-surface px-2 py-0.5 font-mono text-accent/80">{project.barrier_type}</span>
        <span>{new Date(project.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      </div>
    </button>
  )
}
