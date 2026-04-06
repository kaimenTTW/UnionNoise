import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'

export default function Step3() {
  useStepGuard(3)
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const { applicable_codes, toggleCode } = useProjectStore()
  const [activeTab, setActiveTab] = useState<'codes' | 'design'>('codes')

  const selectedCount = applicable_codes.filter((c) => c.selected).length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 3</span>
          <h1 className="step-title">Design Workspace</h1>
        </div>
        <p className="step-subtitle">
          Select applicable codes before running calculations.
        </p>
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
                    {/* EN designation — primary label */}
                    <p className="text-sm font-semibold text-white font-mono">{code.en_designation}</p>
                    {/* Eurocode label — subtitle */}
                    <p className="mt-0.5 text-xs text-muted">{code.eurocode_label}</p>
                    {/* Governs — light descriptor */}
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

        {activeTab === 'design' && (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
            Design parameters panel — coming in next iteration
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-border px-6 py-4">
        <button onClick={() => navigate(`/project/${id}/step/4`)} className="btn-primary">
          Continue →
        </button>
      </div>
    </div>
  )
}

