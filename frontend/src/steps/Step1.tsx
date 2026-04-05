import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { extractFromFile, extractFromText } from '../api/extract'
import { useStepGuard } from '../hooks/useStepGuard'
import {
  MOCK_PROJECT_INFO,
  useProjectStore,
  useStep1Ready,
} from '../store/projectStore'
import type { BarrierType, ExtractedParameters } from '../types'

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({
  label,
  confirmed,
  children,
}: {
  label: string
  confirmed: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="field-label mb-0">{label}</label>
        {!confirmed && <span className="badge-warning">Needs confirmation</span>}
        {confirmed && <span className="badge-success">Confirmed</span>}
      </div>
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Step1() {
  useStepGuard(1)
  const navigate = useNavigate()

  const { project_info, setProjectInfo, confirmStep1 } = useProjectStore()
  const step1Ready = useStep1Ready()

  // Track which fields have been touched/set (populated by extraction or mock)
  const [populated, setPopulated] = useState(false)

  // Left-panel tab
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file')
  const [pasteText, setPasteText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Error state
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const applyExtracted = (params: ExtractedParameters) => {
    setProjectInfo({
      project_name: params.project_name,
      location: params.location,
      barrier_height: params.barrier_height,
      barrier_type: params.barrier_type,
      foundation_constraint: params.foundation_constraint,
      scope_note: params.scope_note,
    })
    setPopulated(true)
    setErrorMsg(null)
  }

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (inputMode === 'file' && selectedFile) {
        return extractFromFile(selectedFile)
      }
      if (inputMode === 'text' && pasteText.trim()) {
        return extractFromText(pasteText)
      }
      throw new Error('Provide a file or paste text before extracting.')
    },
    onSuccess: applyExtracted,
    onError: (err: Error) => {
      setErrorMsg(err.message ?? 'Extraction failed. Please try again.')
    },
  })

  const handleUseMockData = () => {
    applyExtracted(MOCK_PROJECT_INFO)
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setSelectedFile(file)
      setInputMode('file')
    }
  }

  const handleConfirm = () => {
    confirmStep1()
    navigate('/step/2')
  }

  const pi = project_info

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="step-header">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-accent">Step 1</span>
          <h1 className="step-title">Project Setup</h1>
        </div>
        <p className="step-subtitle">
          Upload a requirements document or paste text to extract design parameters.
        </p>
      </div>

      {/* Body — two columns */}
      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* ── Left panel: input ── */}
        <div className="flex w-[42%] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-6">
          {/* Tab toggle */}
          <div className="flex rounded border border-border bg-surface p-0.5">
            {(['file', 'text'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setInputMode(mode)}
                className={[
                  'flex-1 rounded py-1.5 text-sm font-medium transition-colors',
                  inputMode === mode
                    ? 'bg-panel text-white shadow-sm'
                    : 'text-muted hover:text-white',
                ].join(' ')}
              >
                {mode === 'file' ? 'Upload File' : 'Paste Text'}
              </button>
            ))}
          </div>

          {/* File upload */}
          {inputMode === 'file' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={[
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 text-center transition-colors',
                dragOver
                  ? 'border-accent bg-accent/5'
                  : selectedFile
                  ? 'border-success/50 bg-success/5'
                  : 'border-border hover:border-border/80 hover:bg-white/[0.02]',
              ].join(' ')}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) setSelectedFile(f)
                }}
              />
              {selectedFile ? (
                <>
                  <span className="text-2xl">📄</span>
                  <p className="text-sm font-medium text-white">{selectedFile.name}</p>
                  <p className="text-xs text-muted">Click to change</p>
                </>
              ) : (
                <>
                  <span className="text-2xl text-muted">↑</span>
                  <p className="text-sm font-medium text-white">Drop file here or click to browse</p>
                  <p className="text-xs text-muted">PDF, .docx, .txt</p>
                </>
              )}
            </div>
          )}

          {/* Text paste */}
          {inputMode === 'text' && (
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste the tender brief or requirements document text here…"
              className="field-input min-h-[200px] resize-y font-mono text-xs leading-relaxed"
            />
          )}

          {/* Error banner */}
          {errorMsg && (
            <div className="rounded border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {errorMsg}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => extractMutation.mutate()}
              disabled={
                extractMutation.isPending ||
                (inputMode === 'file' && !selectedFile) ||
                (inputMode === 'text' && !pasteText.trim())
              }
              className="btn-primary flex items-center justify-center gap-2"
            >
              {extractMutation.isPending ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Extracting…
                </>
              ) : (
                'Extract Parameters'
              )}
            </button>
            <button onClick={handleUseMockData} className="btn-secondary">
              Use Mock Data
            </button>
          </div>

          <p className="text-xs text-muted">
            "Extract Parameters" calls Claude via the backend.
            "Use Mock Data" loads sample values locally — no API call.
          </p>
        </div>

        {/* ── Right panel: extracted fields ── */}
        <div className="flex flex-1 flex-col overflow-y-auto p-6">
          {!populated && (
            <div className="mb-4 rounded border border-warning/20 bg-warning/5 px-4 py-3 text-sm text-warning/80">
              Extract parameters from a document or load mock data to populate these fields.
            </div>
          )}

          <div className="grid gap-5">
            {/* Project Name */}
            <FieldRow label="Project Name" confirmed={pi.project_name.trim() !== ''}>
              <input
                type="text"
                className="field-input"
                value={pi.project_name}
                onChange={(e) => setProjectInfo({ project_name: e.target.value })}
                placeholder="e.g. CR208 Noise Barrier"
              />
            </FieldRow>

            {/* Location */}
            <FieldRow label="Location" confirmed={pi.location.trim() !== ''}>
              <input
                type="text"
                className="field-input"
                value={pi.location}
                onChange={(e) => setProjectInfo({ location: e.target.value })}
                placeholder="e.g. Clementi Ave 3, Singapore"
              />
            </FieldRow>

            {/* Barrier Height */}
            <FieldRow label="Barrier Height (m)" confirmed={pi.barrier_height !== null}>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className="field-input w-36"
                  value={pi.barrier_height ?? ''}
                  onChange={(e) =>
                    setProjectInfo({
                      barrier_height: e.target.value === '' ? null : parseFloat(e.target.value),
                    })
                  }
                  placeholder="6.0"
                />
                <span className="text-sm text-muted">m</span>
              </div>
            </FieldRow>

            {/* Barrier Type */}
            <FieldRow label="Barrier Type" confirmed={pi.barrier_type !== null}>
              <select
                className="field-input"
                value={pi.barrier_type ?? ''}
                onChange={(e) =>
                  setProjectInfo({
                    barrier_type: e.target.value === '' ? null : (e.target.value as BarrierType),
                  })
                }
              >
                <option value="">— Select type —</option>
                <option value="Type 1">Type 1</option>
                <option value="Type 2">Type 2</option>
                <option value="Type 3">Type 3</option>
              </select>
            </FieldRow>

            {/* Foundation Constraint */}
            <FieldRow
              label="Foundation Constraint"
              confirmed={pi.foundation_constraint.trim() !== ''}
            >
              <input
                type="text"
                className="field-input"
                value={pi.foundation_constraint}
                onChange={(e) => setProjectInfo({ foundation_constraint: e.target.value })}
                placeholder="e.g. Embedded RC footing"
              />
            </FieldRow>

            {/* Scope Note */}
            <FieldRow label="Scope Note" confirmed={pi.scope_note.trim() !== ''}>
              <textarea
                className="field-input min-h-[80px] resize-y"
                value={pi.scope_note}
                onChange={(e) => setProjectInfo({ scope_note: e.target.value })}
                placeholder="Brief description of the project scope…"
              />
            </FieldRow>
          </div>

          {/* Confirm button */}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <p className="text-xs text-muted">
              {step1Ready
                ? 'All fields populated. Review and confirm to proceed.'
                : 'All fields must be completed before confirming.'}
            </p>
            <button
              onClick={handleConfirm}
              disabled={!step1Ready || project_info.step1_confirmed}
              className="btn-success"
            >
              {project_info.step1_confirmed ? 'Confirmed ✓' : 'Confirm Extracted Brief →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
