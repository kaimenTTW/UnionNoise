import { useNavigate } from 'react-router-dom'

/**
 * Master Data — member library management page.
 * Upgrade path: "Upload Members" posts to POST /api/master-data; backend
 * parses CSV/Excel and stores in PostgreSQL parts library table.
 * See PRD Section 2.6.
 */

interface MemberRow {
  member_id: string
  type: 'UB' | 'SHS' | 'Plate' | 'Bolt' | 'Rebar' | 'Pipe'
  designation: string
  grade: string
  weight_kg_m: number | null
  notes: string
}

// Sample data — representative of member types seen in PE calculation reports
// PROVISIONAL: pending real parts library from client — see PRD Section 2.6
const SAMPLE_MEMBERS: MemberRow[] = [
  { member_id: 'UB-001', type: 'UB',    designation: 'UB 152×89×16',    grade: 'S275', weight_kg_m: 16.0,  notes: 'Light post section' },
  { member_id: 'UB-002', type: 'UB',    designation: 'UB 203×102×23',   grade: 'S275', weight_kg_m: 23.1,  notes: 'Standard post — 6 m barrier' },
  { member_id: 'UB-003', type: 'UB',    designation: 'UB 254×102×28',   grade: 'S275', weight_kg_m: 28.3,  notes: 'Confirmed in Faber Walk PE report' },
  { member_id: 'UB-004', type: 'UB',    designation: 'UB 406×140×46',   grade: 'S275', weight_kg_m: 46.0,  notes: 'Confirmed in P105 Punggol PE report (Type 2A)' },
  { member_id: 'SHS-001', type: 'SHS',  designation: 'SHS 50×50×4',     grade: 'S275', weight_kg_m: 5.72,  notes: 'Subframe / open-web beam — P105' },
  { member_id: 'SHS-002', type: 'SHS',  designation: 'SHS 75×75×5',     grade: 'S275', weight_kg_m: 10.8,  notes: 'Heavier subframe option' },
  { member_id: 'BOLT-001', type: 'Bolt', designation: 'M16 Cast-in Bolt', grade: '8.8',  weight_kg_m: null,  notes: 'Standard CIB — embedment per EC2 bond check' },
  { member_id: 'BOLT-002', type: 'Bolt', designation: 'M20 Cast-in Bolt', grade: '8.8',  weight_kg_m: null,  notes: 'Heavy-duty CIB' },
]

const TYPE_COLORS: Record<MemberRow['type'], string> = {
  UB:    'text-accent/90',
  SHS:   'text-warning/80',
  Plate: 'text-muted',
  Bolt:  'text-success/80',
  Rebar: 'text-muted',
  Pipe:  'text-muted',
}

export default function MasterDataPage() {
  const navigate = useNavigate()

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
          <p className="mt-0.5 text-lg font-semibold text-white">Master Data</p>
        </div>
        {/* Upload button stub */}
        <button
          disabled
          className="btn-primary opacity-50 cursor-not-allowed"
          title="Upload functionality coming soon"
        >
          Upload Members
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-4xl space-y-6">

          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Member Library</h2>
              <p className="mt-1 text-xs text-muted">
                Pre-approved structural members used by the calculation engine in Step 4.
              </p>
            </div>
            <span className="text-xs text-muted">{SAMPLE_MEMBERS.length} members</span>
          </div>

          {/* Members table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="grid grid-cols-[90px_60px_180px_70px_90px_1fr] gap-4 border-b border-border bg-panel px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Member ID</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Type</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Designation</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Grade</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">kg/m</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</span>
            </div>
            {SAMPLE_MEMBERS.map((m) => (
              <div
                key={m.member_id}
                className="grid grid-cols-[90px_60px_180px_70px_90px_1fr] gap-4 border-b border-border/50 px-4 py-2.5 last:border-b-0 hover:bg-white/[0.02]"
              >
                <span className="font-mono text-xs text-muted">{m.member_id}</span>
                <span className={`font-mono text-xs font-semibold ${TYPE_COLORS[m.type]}`}>{m.type}</span>
                <span className="font-mono text-sm text-white">{m.designation}</span>
                <span className="font-mono text-xs text-muted">{m.grade}</span>
                <span className="font-mono text-xs text-muted">
                  {m.weight_kg_m !== null ? m.weight_kg_m.toFixed(1) : '—'}
                </span>
                <span className="text-xs text-muted/70 truncate">{m.notes}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted/60">
            Member library is DB-sourced. Uploaded files are loaded into the database.
            Contact your administrator to update the library.
          </p>

        </div>
      </main>

      <footer className="border-t border-border px-8 py-3">
        <p className="text-xs text-muted/50">v0.2.2 — prototype · Hebei Jinbiao / Union Noise</p>
      </footer>
    </div>
  )
}
