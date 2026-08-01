import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { GroupsControlPanel } from '@mygames/game-ui'
import { auth, functions } from '../firebase'
import { getGameConfig, setClockMode, groupParticipantsOnline, getRoster } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — ONLINE-MODE DASHBOARD CONTROLS (Part 2).
//
// Mounted via the shared dashboard's `underHeadline` slot. In CLASSROOM mode it shows
// only the mode switch (the Part-1 action bar is otherwise untouched). In ONLINE mode
// it adds: the "Group participants" pre-matcher, the incomplete-group advisory (roll-up
// + per-group missing-role badge — INFORM, never block), and the shared role-aware
// move/ungroup GroupsControlPanel.
//
// ⚠ The incomplete-group badge is a grays-LOCAL companion, NOT a prop on the shared
// GroupsControlPanel (which has no badge/roll-up prop). Both read the same getRoster
// data, so the advisory and the panel always agree. A first-class on-row badge would
// need a new game-ui prop — deliberately NOT added here (shared-package change = a new
// tag, Elena's call).
// ═══════════════════════════════════════════════════════════════════════════════

const ROLE_LABELS: Record<string, string> = { chris: 'Chris', kelly: 'Kelly' }
const ROLE_KEYS = Object.keys(ROLE_LABELS)

type RosterGroup = { group_id: string; status: string; participants_by_role: Record<string, string[]> }

const box: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.5rem 0 1rem',
  background: '#fbfdff', fontSize: '0.9rem',
}
const btn = (active: boolean): React.CSSProperties => ({
  padding: '0.3rem 0.9rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem',
  border: active ? '1px solid #2563eb' : '1px solid #cbd5e1',
  background: active ? '#2563eb' : '#fff', color: active ? '#fff' : '#334155', fontWeight: active ? 600 : 400,
})

export default function OnlineControls() {
  const [ready, setReady] = useState(() => auth.currentUser != null)
  useEffect(() => onAuthStateChanged(auth, u => setReady(u != null)), [])

  const [clockMode, setClockModeState] = useState<string | null>(null)
  const [groups, setGroups] = useState<RosterGroup[]>([])
  const [saving, setSaving] = useState(false)
  const [grouping, setGrouping] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const online = clockMode === 'off'
  const anyStarted = groups.some(g => g.status !== 'matched')

  const refresh = useCallback(() => {
    getGameConfig().then(c => setClockModeState(c.clock_mode ?? 'on')).catch(() => setClockModeState('on'))
    getRoster().then(r => setGroups(r.groups as unknown as RosterGroup[])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!ready) return
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [ready, refresh])

  // Hide the classroom "Match Now" button while in online mode (Crisis doctrine §2:
  // ONE matching button per mode). Scoped, reversible, no shared-package change.
  useEffect(() => {
    const apply = () => {
      for (const b of Array.from(document.querySelectorAll('button'))) {
        const t = (b.textContent ?? '').trim()
        if (t === 'Match Now' || t === 'Matching…') (b as HTMLButtonElement).style.display = online ? 'none' : ''
      }
    }
    apply()
    const t = setInterval(apply, 1000)
    return () => { clearInterval(t); // restore on unmount
      for (const b of Array.from(document.querySelectorAll('button'))) {
        const txt = (b.textContent ?? '').trim()
        if (txt === 'Match Now' || txt === 'Matching…') (b as HTMLButtonElement).style.display = ''
      } }
  }, [online])

  const switchMode = (m: 'on' | 'off') => {
    if (m === clockMode || saving || anyStarted) return
    setSaving(true); setErr(null); setMsg(null)
    setClockMode(m).then(() => { setClockModeState(m); refresh() })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to switch mode.'))
      .finally(() => setSaving(false))
  }

  const preGroup = () => {
    setGrouping(true); setErr(null); setMsg(null)
    groupParticipantsOnline()
      .then(r => { setMsg(`Grouped ${r.total_humans} students into ${r.groups} pair(s)` +
        (r.short_group_size != null ? ` (one half-pair of ${r.short_group_size})` : '') + '.'); refresh() })
      .catch(e => setErr(e instanceof Error ? e.message : 'Grouping failed.'))
      .finally(() => setGrouping(false))
  }

  // ── Incomplete-group advisory (missing role) — populated, not-started groups only ──
  const incomplete = groups
    .filter(g => g.status === 'matched')
    .map(g => {
      const counts = Object.fromEntries(ROLE_KEYS.map(k => [k, (g.participants_by_role?.[k] ?? []).length]))
      const populated = ROLE_KEYS.reduce((n, k) => n + counts[k], 0) > 0
      const missing = ROLE_KEYS.filter(k => counts[k] === 0)
      return { group_id: g.group_id, populated, missing }
    })
    .filter(g => g.populated && g.missing.length > 0)

  const numberById = new Map(
    [...groups].sort((a, b) => a.group_id.localeCompare(b.group_id)).map((g, i) => [g.group_id, i + 1]),
  )

  return (
    <div>
      {/* Mode switch — prominent, at the top of the control area */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.25rem 0 0.5rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>Mode:</strong>
        <button style={btn(clockMode === 'on')} onClick={() => switchMode('on')} disabled={saving || anyStarted}>
          Classroom
        </button>
        <button style={btn(online)} onClick={() => switchMode('off')} disabled={saving || anyStarted}>
          Online
        </button>
        {anyStarted && <span style={{ color: '#64748b', fontSize: '0.8rem' }}>locked — a group has started</span>}
      </div>

      {err && <p style={{ color: '#c00', fontSize: '0.85rem', margin: '0.25rem 0' }}>{err}</p>}

      {online && (
        <div style={box}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <button onClick={preGroup} disabled={grouping || anyStarted}
              style={{ padding: '0.3rem 0.9rem', borderRadius: 4, cursor: 'pointer', border: '1px solid #cbd5e1' }}>
              {grouping ? 'Grouping…' : (groups.length ? 'Re-group participants' : 'Group participants')}
            </button>
            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
              Pre-matches the whole roster into Chris/Kelly pairs. Students then log in, coordinate, and start.
            </span>
          </div>
          {msg && <p style={{ color: '#166534', fontSize: '0.85rem', margin: '0.25rem 0' }}>{msg}</p>}

          {/* Roll-up + per-group missing-role advisory (INFORM, never block) */}
          {incomplete.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.5rem 0.75rem', margin: '0.5rem 0' }}>
              <strong style={{ color: '#92400e', fontSize: '0.85rem' }}>
                {incomplete.length} group{incomplete.length === 1 ? '' : 's'} can&apos;t start (missing a role)
              </strong>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', fontSize: '0.82rem', color: '#92400e' }}>
                {incomplete
                  .sort((a, b) => (numberById.get(a.group_id) ?? 0) - (numberById.get(b.group_id) ?? 0))
                  .map(g => (
                    <li key={g.group_id}>
                      Group {numberById.get(g.group_id) ?? '—'} — ⚠ {g.missing.map(k => `No ${ROLE_LABELS[k]}`).join(' · ')}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* The shared role-aware move/ungroup panel — online mode only (classroom Part 1 has none). */}
      {online && (
        <GroupsControlPanel functions={functions} auth={auth} roleLabels={ROLE_LABELS} testId="grays2-groups" />
      )}
    </div>
  )
}
