import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { validateOutcome, type Outcome } from '@mygames/game-engine'
import { extractInstructorGameId } from '@mygames/game-server'
import { computeScoreBreakdown, graysGameDef } from './gameDefinition'
import { VALID_ROLES, TEXT_FIELDS, type ReportRow } from './getReportData'

/**
 * Instructor-only. Edits a group's agreed contract from the Reports page and
 * recomputes every group member's raw_score through that member's own role formula.
 *
 * REPORT-ONLY by design — it writes the group contract and each member's
 * raw_score / value_or_cost, and NOTHING else. It never touches normalized_score,
 * finalized_at, or the classroom push (that is scoreAndRecord / finalize).
 *
 * Input:  { groupId, agreement_reached, outcome? }
 * Output: { ok, rows } — the updated ReportRow[] for this group.
 */
export const updateGroupContract = onCall({ cors: graysGameDef.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined

  const gameInstanceId = await extractInstructorGameId(data, isEmulator, authHeader)

  const groupId = data['groupId']
  if (typeof groupId !== 'string' || !groupId) {
    throw new HttpsError('invalid-argument', 'groupId is required.')
  }
  const agreement_reached = data['agreement_reached']
  if (typeof agreement_reached !== 'boolean') {
    throw new HttpsError('invalid-argument', 'agreement_reached must be a boolean.')
  }

  // Resolve the contract to store. No-deal → null (walk-away). Deal → validated outcome.
  let outcome: Outcome | null = null
  if (agreement_reached) {
    const provided = data['outcome']
    if (provided === null || typeof provided !== 'object' || Array.isArray(provided)) {
      throw new HttpsError('invalid-argument', 'outcome must be an object when agreement_reached is true.')
    }
    const check = validateOutcome(graysGameDef.outcomeSchema, provided as Outcome)
    if (!check.valid) {
      throw new HttpsError('invalid-argument', `Invalid contract: ${check.errors.join(' ')}`)
    }
    outcome = provided as Outcome
  }

  try {
    const db = admin.firestore()
    const rtdb = admin.database()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)
    const groupRef = instanceRef.collection('groups').doc(groupId)

    const groupSnap = await groupRef.get()
    if (!groupSnap.exists) {
      throw new HttpsError('not-found', `Group ${groupId} not found.`)
    }

    // 1. Persist the contract on the GROUP doc.
    await groupRef.update({ outcome, agreement_reached })

    // 2. Read everything needed to recompute + rebuild this group's rows.
    const [membersSnap, groupsSnap, configSnap, attendingSnap] = await Promise.all([
      instanceRef.collection('participants').where('group_id', '==', groupId).get(),
      instanceRef.collection('groups').get(),
      instanceRef.collection('config').doc('main').get(),
      rtdb.ref(`game_instances/${gameInstanceId}/attendance`).get(),
    ])

    const configData = (configSnap.data() ?? {}) as Record<string, unknown>
    const attending = (attendingSnap.val() ?? {}) as Record<string, { display_name?: string } | null>

    // Same 1-based group numbering getReportData uses (sorted by doc id).
    const sortedGroups = groupsSnap.docs.slice().sort((a, b) => a.id.localeCompare(b.id))
    const idx = sortedGroups.findIndex(g => g.id === groupId)
    const group_number = idx >= 0 ? idx + 1 : null

    // 3. Recompute each member through their OWN role formula; batch-write raw_score + value_or_cost.
    const batch = db.batch()
    const rows: ReportRow[] = []

    for (const pdoc of membersSnap.docs) {
      const d = pdoc.data() as Record<string, unknown>
      const role = d['role'] as string | undefined
      if (!role || !VALID_ROLES.has(role)) continue
      if (d['finalized_at'] == null) continue

      const { value_or_cost, raw_score } = computeScoreBreakdown(role, outcome, configData)
      batch.update(pdoc.ref, { raw_score, value_or_cost })

      const rtdbName = attending[pdoc.id]?.display_name?.trim()
      const fsName   = ((d['display_name'] ?? d['name'] ?? '') as string).trim()
      const display_name = rtdbName || fsName || `${pdoc.id.slice(0, 8)}…`

      const text_answers: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const val = d[field]
        if (typeof val === 'string' && val.trim()) text_answers[field] = val.trim()
      }

      // value_or_cost is still written to the doc (above); the report row exposes the
      // surplus (raw_score) and carries the unchanged normalized/KC scores.
      void value_or_cost
      rows.push({
        participant_id: pdoc.id,
        display_name,
        group_number,
        group_id: groupId,
        role,
        price: outcome ? (outcome['price'] as number) : null,
        agreement_reached,
        surplus: raw_score,
        normalized_score: (d['normalized_score'] ?? null) as number | null,
        knowledge_check_score: (d['knowledge_check_score'] ?? null) as number | null,
        text_answers,
      })
    }

    await batch.commit()

    rows.sort((a, b) => a.display_name.localeCompare(b.display_name))
    return { ok: true as const, rows }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[updateGroupContract] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})
