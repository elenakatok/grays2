import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, signOut } from 'firebase/auth'
import { auth, functions } from '../firebase'
import {
  SortableTable,
  ReportBoard,
  GameHeader,
  ExportModal,
  AssignmentStatusReport,
  buildStudentTextExport,
  type SortableColumn,
  type ReportTileConfig,
  type AiTextRow,
} from '@mygames/game-ui'
import { PriceDistribution, type PriceDeal } from '../components/PriceDistribution'
import { SchemaField, parseForm, type FormValues } from '../phases/OutcomeReporting'
import { getOnlineReport, type OnlineReport } from '../api'
import { type OutcomeSchema } from '../gameConfig'

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportRow = {
  participant_id: string
  display_name: string
  group_number: number | null
  group_id: string | null
  role: string
  price: number | null                 // agreed price (null on walk-away)
  agreement_reached: boolean | null
  surplus: number | null               // net profit = raw_score
  normalized_score: number | null
  knowledge_check_score: number | null
  text_answers: Record<string, string>
}

type QuestionMeta = { field: string; prompt: string; role_target: string }
type Reservations = { chris: number; kelly: number }

// ── Outcomes-roster table columns (Tier 1) ────────────────────────────────────

type SortKey = 'name' | 'group' | 'role' | 'price' | 'surplus' | 'normalized' | 'kc' | 'edit'

const ROLE_LABELS: Record<string, string> = {
  chris: 'Chris (Seller)',
  kelly: 'Kelly (Buyer)',
}

const money = (n: number | null): string =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const COLUMNS: readonly SortableColumn<ReportRow, SortKey>[] = [
  {
    key: 'name', label: 'Name', headerStyle: { minWidth: 140 }, sticky: 'left',
    render: r => r.display_name,
    compare: (a, b) => a.display_name.localeCompare(b.display_name),
  },
  {
    key: 'group', label: 'Group #',
    render: r => r.group_number ?? '—',
    compare: (a, b) => (a.group_number ?? Infinity) - (b.group_number ?? Infinity),
  },
  {
    key: 'role', label: 'Role',
    render: r => ROLE_LABELS[r.role] ?? r.role,
    compare: (a, b) => a.role.localeCompare(b.role),
  },
  {
    key: 'price', label: 'Price', nullsLast: true, isNull: r => r.price === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => r.price == null
      ? <span style={{ color: '#92400e' }}>No deal</span>
      : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.price)}</span>,
    compare: (a, b) => (a.price ?? 0) - (b.price ?? 0),
  },
  {
    key: 'surplus', label: 'Surplus (raw)', nullsLast: true, isNull: r => r.surplus === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.surplus)}</span>,
    compare: (a, b) => (a.surplus ?? 0) - (b.surplus ?? 0),
  },
  {
    key: 'normalized', label: 'Normalized (z)', nullsLast: true, isNull: r => r.normalized_score === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.normalized_score == null ? '—' : r.normalized_score.toFixed(2)}</span>,
    compare: (a, b) => (a.normalized_score ?? 0) - (b.normalized_score ?? 0),
  },
  {
    key: 'kc', label: 'KC', nullsLast: true, isNull: r => r.knowledge_check_score === null,
    tiebreak: (a, b) => a.display_name.localeCompare(b.display_name),
    render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.knowledge_check_score == null ? '—' : r.knowledge_check_score.toFixed(1)}</span>,
    compare: (a, b) => (a.knowledge_check_score ?? 0) - (b.knowledge_check_score ?? 0),
  },
]

// ── Page component ────────────────────────────────────────────────────────────

export default function Reports() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const devGameInstanceId = import.meta.env.DEV
    ? searchParams.get('_dev_game_instance_id')
    : null
  const tokenParam          = searchParams.get('token')
  const gameInstanceIdParam = searchParams.get('game_instance_id')

  const [sessionReady, setSessionReady] = useState(false)
  const [authError,    setAuthError]    = useState<string | null>(null)

  const makeLink = (base: string): string => {
    if (devGameInstanceId) return `${base}?_dev_game_instance_id=${encodeURIComponent(devGameInstanceId)}`
    if (tokenParam && gameInstanceIdParam)
      return `${base}?token=${encodeURIComponent(tokenParam)}&game_instance_id=${encodeURIComponent(gameInstanceIdParam)}`
    return base
  }

  // ── Auth bootstrap ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const establish = async () => {
      await auth.authStateReady()
      if (cancelled) return
      if (auth.currentUser) {
        const expectedUid = devGameInstanceId
          ? `instructor_${devGameInstanceId}`
          : gameInstanceIdParam ? `instructor_${gameInstanceIdParam}` : null
        if (expectedUid && auth.currentUser.uid === expectedUid) { setSessionReady(true); return }
        await signOut(auth)
        if (cancelled) return
      }
      const args = devGameInstanceId
        ? { _dev: { game_instance_id: devGameInstanceId } }
        : tokenParam ? { token: tokenParam } : null
      if (!args) { setAuthError('No launch token found.'); return }
      try {
        const fn = httpsCallable<object, { customToken: string }>(functions, 'getInstructorSession')
        const res = await fn(args)
        if (cancelled) return
        await signInWithCustomToken(auth, res.data.customToken)
        if (cancelled) return
        setSessionReady(true)
      } catch (err) {
        if (cancelled) return
        setAuthError(err instanceof Error ? err.message : 'Failed to establish session.')
      }
    }
    void establish()
    return () => { cancelled = true }
  }, [devGameInstanceId, tokenParam]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data load ──────────────────────────────────────────────────────────────
  const [rows,      setRows]      = useState<ReportRow[] | null>(null)
  const [questions, setQuestions] = useState<QuestionMeta[]>([])
  const [schema,    setSchema]    = useState<OutcomeSchema | null>(null)
  const [reservations, setReservations] = useState<Reservations>({ chris: 25_000, kelly: 475_000 })
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!sessionReady) return
    setLoading(true)
    setError(null)
    const fn = httpsCallable<object, { ok: boolean; rows: ReportRow[]; questions: QuestionMeta[]; schema: OutcomeSchema; reservations: Reservations }>(functions, 'getReportData')
    fn({}).then(r => {
      setRows(r.data.rows)
      setQuestions(r.data.questions)
      setSchema(r.data.schema)
      if (r.data.reservations) setReservations(r.data.reservations)
      setLoading(false)
    }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load report data.')
      setLoading(false)
    })
  }, [sessionReady])

  // ── Inline group-contract editor (report-only: recomputes raw_score) ─────────
  const [editing,    setEditing]    = useState<{ groupId: string; groupNumber: number | null } | null>(null)
  const [formValues, setFormValues] = useState<FormValues>({})
  const [dealReached, setDealReached] = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [editError,  setEditError]  = useState<string | null>(null)

  const openEditor = (row: ReportRow) => {
    if (!row.group_id || !schema) return
    const hasDeal = schema.some(f => f.type !== 'text' && (row as Record<string, unknown>)[f.key] != null)
    const vals: FormValues = {}
    for (const f of schema) {
      const raw = (row as Record<string, unknown>)[f.key]
      vals[f.key] = f.type === 'boolean' ? Boolean(raw) : (raw == null ? '' : String(raw))
    }
    setFormValues(vals)
    setDealReached(hasDeal)
    setEditError(null)
    setEditing({ groupId: row.group_id, groupNumber: row.group_number })
  }

  const saveEditor = async () => {
    if (!editing || !schema) return
    let outcome: Record<string, unknown> | null = null
    if (dealReached) {
      const parsed = parseForm(formValues, schema)
      if (!parsed.ok) { setEditError(parsed.error); return }
      outcome = parsed.outcome
    }
    setSaving(true)
    setEditError(null)
    try {
      const fn = httpsCallable<
        { groupId: string; agreement_reached: boolean; outcome: Record<string, unknown> | null },
        { ok: boolean; rows: ReportRow[] }
      >(functions, 'updateGroupContract')
      const res = await fn({ groupId: editing.groupId, agreement_reached: dealReached, outcome })
      const updated = res.data.rows
      setRows(prev => prev ? prev.map(r => updated.find(u => u.participant_id === r.participant_id) ?? r) : prev)
      setEditing(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save contract.')
    } finally {
      setSaving(false)
    }
  }

  // ── Modal state ────────────────────────────────────────────────────────────
  const [contractOpen,  setContractOpen]  = useState(false)
  const [chartOpen,     setChartOpen]     = useState(false)
  const [activeExport,  setActiveExport]  = useState<{ title: string; text: string } | null>(null)

  // ── Tier-3 price distribution — one point per group (deals) + walk-away list ──
  const { deals, walkaways } = (() => {
    const byGroup = new Map<number, { price: number | null; agreement: boolean }>()
    for (const r of rows ?? []) {
      if (r.group_number == null) continue
      if (!byGroup.has(r.group_number)) {
        byGroup.set(r.group_number, { price: r.price, agreement: r.agreement_reached !== false && r.price != null })
      }
    }
    const deals: PriceDeal[] = []
    const walkaways: number[] = []
    for (const [gn, v] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
      if (v.agreement && v.price != null) deals.push({ groupNumber: gn, price: v.price })
      else walkaways.push(gn)
    }
    return { deals, walkaways }
  })()

  // Online assignment-status report (§6) — fetched on demand.
  const [onlineOpen,   setOnlineOpen]   = useState(false)
  const [onlineReport, setOnlineReport] = useState<OnlineReport | null>(null)
  const [onlineErr,    setOnlineErr]    = useState<string | null>(null)
  const openOnline = () => {
    setOnlineOpen(true); setOnlineErr(null)
    getOnlineReport().then(setOnlineReport).catch(e => setOnlineErr(e instanceof Error ? e.message : 'Failed to load report.'))
  }

  // ── Tile config (Reports_Contract_v1) ────────────────────────────────────────
  const finalized = rows?.length ?? 0

  const tiles: ReportTileConfig[] = [
    // Tier 1 — Outcomes roster (roster + outcomes, sortable).
    {
      id: 'contract-outcomes',
      title: 'Contract Outcomes — per participant',
      preview: rows == null
        ? <span style={{ color: '#888', fontSize: '0.85rem' }}>{loading ? 'Loading…' : 'No data'}</span>
        : <span style={{ fontSize: '0.9rem', color: '#555' }}>
            {finalized} participant{finalized !== 1 ? 's' : ''} finalized
          </span>,
      onOpen: () => setContractOpen(true),
      disabled: !rows || rows.length === 0,
      actionLabel: 'Open ↗',
    },
    // Tier 2 — one tile PER free-text question (prep + debrief). Driven by config;
    // role_target 'all' → aggregate every student's answer. Text is placeholder (Part 2).
    ...questions.map(q => {
      const tileTitle = q.prompt
      const qRows: AiTextRow[] = (rows ?? [])
        .filter(r => (q.role_target === 'all' || r.role === q.role_target) && r.text_answers[q.field])
        .map(r => ({ name: r.display_name, raw_score: r.surplus, answer: r.text_answers[q.field] }))
      const text = buildStudentTextExport(tileTitle, qRows)
      return {
        id: q.field,
        title: tileTitle,
        preview: qRows.length === 0
          ? <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No responses yet.</span>
          : <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111' }}>
              {qRows.length} response{qRows.length !== 1 ? 's' : ''}
            </span>,
        onOpen: () => setActiveExport({ title: tileTitle, text }),
        disabled: !rows,
        actionLabel: 'Open ↗',
      } satisfies ReportTileConfig
    }),
    // Tier 3 — price-distribution chart (spec §4.5): final prices across groups.
    {
      id: 'price-distribution',
      title: 'Price Distribution — final prices across groups',
      preview: deals.length === 0
        ? <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No deals to plot yet.</span>
        : <div style={{ pointerEvents: 'none' }}>
            <PriceDistribution deals={deals} walkaways={walkaways}
              reservationChris={reservations.chris} reservationKelly={reservations.kelly} />
          </div>,
      onOpen: () => setChartOpen(true),
      disabled: deals.length === 0 && walkaways.length === 0,
      actionLabel: 'Open ↗',
    },
    // Online (Part 2) — assignment-status report: who arrived, who was flagged, what was done.
    {
      id: 'assignment-status',
      title: 'Assignment Status — online (arrivals & flags)',
      preview: <span style={{ fontSize: '0.85rem', color: '#555' }}>
        Who arrived, who flagged &ldquo;can&apos;t reach my group&rdquo;, group progress.
      </span>,
      onOpen: openOnline,
      actionLabel: 'Open ↗',
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  if (authError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#c00' }}>{authError}</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <GameHeader />

      <div style={{ padding: '1rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={() => navigate(makeLink('/dashboard'))}
          style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          ← Dashboard
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Reports — Grays 2.0</h2>
      </div>

      <main style={{ flex: 1, padding: '1rem 1.5rem' }}>
        {error && <p style={{ color: '#c00', marginBottom: '1rem' }}>{error}</p>}
        <ReportBoard tiles={tiles} />
      </main>

      {/* ── Contract outcomes modal (Tier 1) ── */}
      {contractOpen && (
        <div
          onClick={() => setContractOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              width: '100%', maxWidth: 'min(1100px, calc(100vw - 2rem))', minWidth: 0,
              boxSizing: 'border-box', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto',
              padding: '1.25rem 1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Contract Outcomes — per participant</h3>
              <button
                onClick={() => setContractOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}
              >
                ✕
              </button>
            </div>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 14rem)', border: '1px solid #ddd', borderRadius: 6 }}>
              <SortableTable<ReportRow, SortKey>
                rows={rows ?? []}
                columns={[
                  ...COLUMNS,
                  {
                    key: 'edit', label: '', headerStyle: { cursor: 'default' }, sticky: 'right',
                    render: r => (
                      <button
                        onClick={() => openEditor(r)}
                        disabled={!r.group_id || !schema}
                        style={{ background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        Edit
                      </button>
                    ),
                    compare: () => 0,
                  },
                ]}
                getRowKey={r => r.participant_id}
                initialSortKey="group"
                roleLabels={ROLE_LABELS}
                getRowRole={r => r.role}
                emptyMessage="No finalized participants yet."
                wrapHeaders
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Price-distribution chart modal (Tier 3) ── */}
      {chartOpen && (
        <div onClick={() => setChartOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
            alignItems: 'flex-start', justifyContent: 'center', padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              width: '100%', maxWidth: 'min(960px, calc(100vw - 2rem))', boxSizing: 'border-box', padding: '1.25rem 1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Price Distribution — final prices across groups</h3>
              <button onClick={() => setChartOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#666' }}>
              Each dot is a group&apos;s agreed price. Deals within 10% of a reservation price are flagged (amber);
              walk-aways have no price and are listed below.
            </p>
            <PriceDistribution deals={deals} walkaways={walkaways}
              reservationChris={reservations.chris} reservationKelly={reservations.kelly} />
          </div>
        </div>
      )}

      {/* ── Inline group-contract editor ── */}
      {editing && schema && (
        <div
          onClick={() => !saving && setEditing(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '3rem 1rem', zIndex: 1100, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', width: '100%', maxWidth: 460, padding: '1.25rem 1.5rem' }}
          >
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 }}>
              Edit group {editing.groupNumber ?? '—'} contract
            </h3>
            <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666' }}>
              Applies to the whole group; all members' raw scores recompute.
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={dealReached}
                onChange={e => { setDealReached(e.target.checked); setEditError(null) }}
                disabled={saving}
                style={{ width: 18, height: 18 }}
              />
              Deal reached {dealReached ? '' : '— group walked away (no deal)'}
            </label>

            <div style={{ opacity: dealReached ? 1 : 0.5 }}>
              {schema.map(field => (
                <SchemaField
                  key={field.key}
                  field={field}
                  value={formValues[field.key] ?? (field.type === 'boolean' ? false : '')}
                  onChange={v => { setFormValues(prev => ({ ...prev, [field.key]: v })); setEditError(null) }}
                  disabled={saving || !dealReached}
                />
              ))}
            </div>

            {editError && <p style={{ color: '#c00', margin: '0 0 0.75rem', fontSize: '0.9rem' }}>{editError}</p>}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button onClick={saveEditor} disabled={saving} style={{ padding: '0.4rem 1rem', cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ padding: '0.4rem 1rem', background: 'none', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI text export modal (shared across all Tier-2 tiles) ── */}
      {activeExport && (
        <ExportModal
          title={activeExport.title}
          text={activeExport.text}
          onClose={() => setActiveExport(null)}
        />
      )}

      {/* ── Online assignment-status report modal (§6) ── */}
      {onlineOpen && (
        <div
          onClick={() => setOnlineOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '3rem 1rem', zIndex: 1000, overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              width: '100%', maxWidth: 'min(1000px, calc(100vw - 2rem))', minWidth: 0,
              boxSizing: 'border-box', maxHeight: 'calc(100vh - 6rem)', overflowY: 'auto',
              padding: '1.25rem 1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Assignment Status — online</h3>
              <button onClick={() => setOnlineOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>
            {onlineErr && <p style={{ color: '#c00' }}>{onlineErr}</p>}
            {!onlineReport && !onlineErr && <p style={{ color: '#888' }}>Loading…</p>}
            {onlineReport && (
              <AssignmentStatusReport
                groups={onlineReport.groups}
                students={onlineReport.students}
                counts={onlineReport.counts}
                absenceLabel={onlineReport.absence_label}
                arrivalDataPresent={onlineReport.arrival_data_present}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
