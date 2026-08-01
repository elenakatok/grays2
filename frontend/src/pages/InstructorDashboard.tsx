import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { InstructorDashboard as SharedDashboard, type DeadlockResolutionProps, type OutcomeFields } from '@mygames/game-ui'
import { auth, functions, rtdb } from '../firebase'
import { graysConfig } from '../gameConfig'
import OnlineControls from './OnlineControls'

// ── Role labels from game config ──────────────────────────────────────────────

const roleLabels = Object.fromEntries(
  graysConfig.roles.map(r => [r.key, r.label])
)

// ── Deadlock resolution control (STUB — single price field, Part 3 supplies the real form) ──

function GraysDeadlockControl({ submitting, error, onSubmit }: DeadlockResolutionProps) {
  const [price,  setPrice]  = useState('')
  const [noDeal, setNoDeal] = useState(false)

  const handleSubmit = () => {
    if (noDeal) { onSubmit({ no_deal: true }); return }
    const priceNum = parseInt(price.replace(/[$,]/g, ''), 10)
    if (isNaN(priceNum)) return
    const outcome: OutcomeFields = { price: priceNum }
    onSubmit(outcome)
  }

  const inputStyle: React.CSSProperties = {
    fontSize: '0.875rem', padding: '0.3rem 0.5rem', borderRadius: 3, border: '1px solid #ccc',
  }
  const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {!noDeal && (
        <div style={fieldStyle}>
          <label style={{ fontSize: '0.875rem', minWidth: '6rem' }}>Price ($)</label>
          <input type="text" inputMode="numeric" placeholder="e.g. 150000" value={price}
            onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, width: '9rem' }} disabled={submitting} />
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
        <button onClick={handleSubmit} disabled={submitting || (!noDeal && !price)}>
          {submitting ? '…' : noDeal ? 'Confirm No Deal' : 'Lock Deal'}
        </button>
        <button onClick={() => setNoDeal(v => !v)} disabled={submitting} style={{ background: 'none', border: '1px solid #ccc' }}>
          {noDeal ? 'Enter deal terms instead' : 'No deal'}
        </button>
      </div>
      {error && <p style={{ color: '#c00', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
    </div>
  )
}

// ── Submit instructor outcome ─────────────────────────────────────────────────

async function submitInstructorOutcome(groupId: string, outcome: OutcomeFields): Promise<void> {
  const fn = httpsCallable(functions, 'submitInstructorOutcome')
  await fn({ group_id: groupId, outcome })
}

// ── Page component ────────────────────────────────────────────────────────────
// CLASSROOM-ONLY (Part 1): no GroupsControlPanel / mode toggle is mounted here.
// The move/ungroup Groups panel is Part 2 (the pinned shared packages already
// carry the substrate — game-ui GroupsControlPanel + game-server makeMoveSeat).

export default function InstructorDashboard() {
  return (
    <SharedDashboard
      title="Instructor Dashboard — Grays 2.0"
      roleLabels={roleLabels}
      DeadlockResolutionControl={GraysDeadlockControl}
      submitInstructorOutcome={submitInstructorOutcome}
      functions={functions}
      auth={auth}
      rtdb={rtdb}
      settingsRoute="/settings"
      reportsRoute="/reports"
      scoreAndRecord={{ callableName: 'scoreAndRecord', label: 'Score & Record' }}
      underHeadline={<OnlineControls />}
    />
  )
}
