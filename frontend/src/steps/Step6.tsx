import { useState } from 'react'
import { useStepGuard } from '../hooks/useStepGuard'
import { useProjectStore } from '../store/projectStore'

const REPORT_SECTIONS = [
  '1. Design Basis — applicable codes, materials, load combinations',
  '2. Wind Analysis — EC1 pressure chain, cp,net, shelter factor, design pressure',
  '3. Steel Post Design — section classification, LTB, deflection, shear',
  '4. Connection Design — bolt tension/shear/bearing, embedment, weld, base plate, G clamp',
  '5. Subframe Design — CHS GI pipe bending check',
  '6. Lifting Design — hook tension/bond and web hole shear',
  '7. Foundation Design — SLS, DA1-C1, DA1-C2 sliding/overturning/bearing',
  '8. Results Summary — all URs and FOS in one table, override notes',
]

function Field({
  label, value, onChange, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded border border-border bg-surface px-3 py-2 text-sm text-white placeholder:text-muted/50 focus:border-accent focus:outline-none"
      />
    </div>
  )
}

export default function Step6() {
  useStepGuard(6)

  const {
    project_info: pi,
    meta,
    design_parameters: dp,
    calculation_results,
    section_override,
  } = useProjectStore()

  const [jobReference, setJobReference] = useState('')
  const [revision, setRevision]         = useState('')
  const [checkedBy, setCheckedBy]       = useState('')

  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [generated, setGenerated]   = useState(false)

  const canGenerate = calculation_results !== null

  async function handleGenerate() {
    if (!canGenerate) return
    setGenerating(true)
    setError(null)
    setGenerated(false)

    const payload = {
      project_info: {
        project_name:  pi.project_name,
        location:      pi.location,
        barrier_height: pi.barrier_height,
        barrier_type:  pi.barrier_type,
      },
      meta: {
        created_by: meta.created_by,
        created_at: meta.created_at,
      },
      report_meta: {
        job_reference: jobReference,
        revision,
        checked_by: checkedBy,
      },
      design_parameters: {
        post_spacing:        dp.post_spacing,
        subframe_spacing:    dp.subframe_spacing,
        vb:                  dp.vb,
        shelter_factor:      dp.shelter_factor,
        post_length:         dp.post_length,
        post_weight:         dp.post_weight,
        vertical_load_G:     dp.vertical_load_G,
        design_pressure_kPa: calculation_results?.wind?.design_pressure_kPa ?? null,
      },
      section_override: section_override.active ? section_override : null,
      calculation_results,
    }

    try {
      const res = await fetch('/api/report/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      if (!res.ok) {
        const detail = await res.json().then((d) => d.detail).catch(() => res.statusText)
        throw new Error(detail)
      }
      const blob     = await res.blob()
      const url      = URL.createObjectURL(blob)
      const anchor   = document.createElement('a')
      const safeName = pi.project_name.replace(/[^\w\-]/g, '_') || 'design_calculation'
      anchor.href     = url
      anchor.download = `design_calculation_${safeName}.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setGenerated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 6</span>
          <h1 className="step-title">Calculation Report</h1>
        </div>
        <p className="step-subtitle">
          Generate the PE-submission design calculation report as a PDF.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">

          {/* Report contents */}
          <div className="panel">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
              Report Contents
            </p>
            <ul className="space-y-1">
              {REPORT_SECTIONS.map((s) => (
                <li key={s} className="text-sm text-white/80 before:mr-2 before:text-accent before:content-['›']">
                  {s}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              Each section shows full derivations, formula substitutions, clause references,
              and pass / fail for every check. PE endorsement fields are left blank for the
              PE to complete after review.
            </p>
          </div>

          {/* Report metadata */}
          <div className="panel space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Report Metadata
            </p>
            <Field
              label="Job Reference"
              value={jobReference}
              onChange={setJobReference}
              placeholder="e.g. UN-2026-001"
            />
            <Field
              label="Revision"
              value={revision}
              onChange={setRevision}
              placeholder="e.g. Rev A"
            />
            <Field
              label="Checked by"
              value={checkedBy}
              onChange={setCheckedBy}
              placeholder="e.g. Engineer name"
            />
            <p className="text-xs text-muted">
              PE endorsement fields (name, registration, signature) are left blank in the
              generated PDF for the PE to complete after review.
            </p>
          </div>

          {/* Generate button */}
          <div className="panel space-y-3">
            {!canGenerate && (
              <p className="text-xs text-amber-400">
                Complete calculations in Step 3 before generating the report.
              </p>
            )}

            <button
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="w-full rounded bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {generating ? 'Generating…' : generated ? 'Regenerate Report' : 'Generate Calculation Report'}
            </button>

            {error && (
              <p className="rounded border border-red-700 bg-red-950/40 px-3 py-2 text-xs text-red-400">
                Error: {error}
              </p>
            )}

            {generated && !error && (
              <p className="text-xs text-green-400">
                Report generated — check your downloads.
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
