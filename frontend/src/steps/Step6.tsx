import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'

function SummaryRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="w-48 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="text-sm text-white font-mono">
        {value === null || value === '' ? (
          <span className="text-muted/50 italic">—</span>
        ) : (
          String(value)
        )}
      </span>
    </div>
  )
}

export default function Step6() {
  useStepGuard(6)
  const { project_info: pi, site_data: sd } = useProjectStore()

  const totalLength = sd.segment_table.reduce((s, r) => s + r.length_m, 0)

  return (
    <div className="flex h-full flex-col">
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 6</span>
          <h1 className="step-title">Output Generation</h1>
        </div>
        <p className="step-subtitle">
          Generate engineering drawings and the PE-submission design report.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {/* ProjectContext summary */}
          <div className="panel">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted">
              Project Context Summary
            </p>

            {/* Step 1 */}
            <div className="mb-5">
              <p className="mb-1 text-xs font-semibold text-accent/80 uppercase tracking-widest">
                Step 1 — Project Info
              </p>
              <div className="divide-y divide-border/40">
                <SummaryRow label="Project Name" value={pi.project_name} />
                <SummaryRow label="Location" value={pi.location} />
                <SummaryRow label="Barrier Height" value={pi.barrier_height !== null ? `${pi.barrier_height} m` : null} />
                <SummaryRow label="Barrier Type" value={pi.barrier_type} />
                <SummaryRow label="Foundation Constraint" value={pi.foundation_constraint} />
                <SummaryRow label="Scope Note" value={pi.scope_note} />
                <SummaryRow
                  label="Step 1 Status"
                  value={pi.step1_confirmed ? 'Confirmed' : 'Not confirmed'}
                />
              </div>
            </div>

            {/* Step 2 */}
            <div>
              <p className="mb-1 text-xs font-semibold text-accent/80 uppercase tracking-widest">
                Step 2 — Site Data
              </p>
              <div className="divide-y divide-border/40">
                <SummaryRow
                  label="Site Plan"
                  value={sd.site_plan_filename ?? 'Not uploaded'}
                />
                <SummaryRow
                  label="Scale (px/m)"
                  value={sd.calibration.px_per_m !== null ? sd.calibration.px_per_m.toFixed(2) : null}
                />
                <SummaryRow
                  label="Calibration distance"
                  value={sd.calibration.known_distance !== null ? `${sd.calibration.known_distance} m` : null}
                />
                <SummaryRow label="Vertices" value={sd.alignment_points.length} />
                <SummaryRow label="Segments" value={sd.segment_table.length} />
                <SummaryRow
                  label="Total barrier length"
                  value={sd.segment_table.length > 0 ? `${totalLength.toFixed(2)} m` : null}
                />
                <SummaryRow
                  label="Step 2 Status"
                  value={sd.step2_confirmed ? 'Confirmed' : 'Not confirmed'}
                />
              </div>
            </div>
          </div>

          {/* Segments detail */}
          {sd.segment_table.length > 0 && (
            <div className="panel">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Segment Table
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="pb-2 text-left">ID</th>
                    <th className="pb-2 text-right">Length (m)</th>
                    <th className="pb-2 text-left pl-4">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {sd.segment_table.map((row) => (
                    <tr key={row.id} className="border-b border-border/40">
                      <td className="py-2 font-mono font-semibold text-accent">{row.id}</td>
                      <td className="py-2 text-right font-mono">{row.length_m.toFixed(2)}</td>
                      <td className="py-2 pl-4 text-muted">{row.tag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Output placeholder */}
          <div className="panel border-dashed">
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="text-3xl text-muted">📄</span>
              <p className="text-sm font-medium text-white">Output Generation</p>
              <p className="max-w-sm text-xs text-muted">
                AutoCAD drawing set, PE-submission design report (ReportLab PDF), and bill of
                quantities — coming in next iteration once the calculation engine is complete.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
