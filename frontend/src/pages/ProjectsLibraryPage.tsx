import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjects } from '../hooks/useProjects'
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

export default function ProjectsLibraryPage() {
  const navigate = useNavigate()
  const projects = useProjects()

  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'complete'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filtered = projects.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      q === '' ||
      p.project_name.toLowerCase().includes(q) ||
      p.location.toLowerCase().includes(q)
    return matchesStatus && matchesSearch
  })

  const handleRowClick = (p: Project) => {
    // TODO: revision vs overwrite decision pending — see PRD Section 13
    // Stub: navigates to project workflow; future: GET /api/projects/:id → hydrate ProjectContext
    navigate(`/project/${p.id}`)
  }

  return (
    <div className="flex h-screen flex-col bg-surface text-white font-['Inter',sans-serif]">
      <header className="flex items-center justify-between border-b border-border bg-panel px-8 py-5">
        <div>
          <button
            onClick={() => navigate('/')}
            className="mb-2 flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-white"
          >
            ← Overview
          </button>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Union Noise</p>
          <p className="mt-0.5 text-lg font-semibold text-white">Projects Library</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-4xl space-y-4">

          {/* Filter controls */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search by name or location…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="field-input flex-1 max-w-xs"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="field-input w-36"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="complete">Complete</option>
            </select>
            <span className="text-xs text-muted">
              {filtered.length} of {projects.length} project{projects.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_80px_200px_110px_80px] gap-4 border-b border-border bg-panel px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Project Name</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Type</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Location</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Date</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Status</span>
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted">
                No projects match the current filters.
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleRowClick(p)}
                  className="grid w-full grid-cols-[1fr_80px_200px_110px_80px] gap-4 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] last:border-b-0"
                >
                  <span className="truncate text-sm font-medium text-white">{p.project_name}</span>
                  <span className="font-mono text-xs text-accent/80">{p.barrier_type}</span>
                  <span className="truncate text-xs text-muted">{p.location}</span>
                  <span className="text-xs text-muted">
                    {new Date(p.created_at).toLocaleDateString('en-SG', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                  <span><StatusBadge status={p.status} /></span>
                </button>
              ))
            )}
          </div>

        </div>
      </main>

      <footer className="border-t border-border px-8 py-3">
        <p className="text-xs text-muted/50">v0.2.2 — prototype · Hebei Jinbiao / Union Noise</p>
      </footer>
    </div>
  )
}
