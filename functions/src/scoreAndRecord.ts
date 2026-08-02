import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { computeZScoresByRole, isValidRole, type ScoringRecord, type Outcome } from '@mygames/game-engine'
import {
  extractInstructorGameId,
  buildScoringRecord,
  dispatchResults,
  toGameResult,
  type CompletedGroup,
  type GameResult,
  type PushSummary,
} from '@mygames/game-server'
import { graysGameDef } from './gameDefinition'

// Same per-game secret finalize uses, so the CLI provisions it for this function too.
const classroomCallbackSecret = defineSecret('CLASSROOM_CALLBACK_SECRET')

/** Resolves the classroom callback URL + secret (prod env, with emulator _dev override). */
function resolveCallbackConfig(data: Record<string, unknown>, isEmulator: boolean): { url: string; secret: string } {
  const dev = isEmulator && data['_dev'] != null ? (data['_dev'] as Record<string, unknown>) : null
  return {
    url: (dev?.['callback_url'] as string | undefined) ?? process.env.CLASSROOM_CALLBACK_URL ?? '',
    secret: (dev?.['callback_secret'] as string | undefined) ?? process.env.CLASSROOM_CALLBACK_SECRET ?? '',
  }
}

const def = graysGameDef

/**
 * "Score & Record" — instructor-only, ALWAYS available, fully re-runnable.
 *
 * Every call does a complete recompute of the whole pool from the CURRENT group
 * outcomes (so post-finalize edits made via updateGroupContract are picked up) and
 * re-pushes the freshly computed set to the gradebook, overwriting in place.
 *
 * Per-game callable (mirrors updateGroupContract) so it deploys without a
 * game-server release.
 */
export const scoreAndRecord = onCall({ cors: def.corsOrigins, secrets: [classroomCallbackSecret] }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined

  const gameInstanceId = await extractInstructorGameId(data, isEmulator, authHeader)
  const { url: callbackUrl, secret: callbackSecret } = resolveCallbackConfig(data, isEmulator)

  const push = async (records: GameResult[]): Promise<PushSummary> => {
    if (!callbackUrl) {
      console.warn('[scoreAndRecord] CLASSROOM_CALLBACK_URL not configured — scores written, push skipped')
      return { total: 0, succeeded: 0, failed: [] }
    }
    const summary = await dispatchResults(records, callbackUrl, callbackSecret)
    console.log('[scoreAndRecord] push summary:', JSON.stringify(summary))
    return summary
  }

  try {
    const db = admin.firestore()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)

    // ── Full recompute from CURRENT state — no guard, no precondition ──────────
    const groupsSnap = await instanceRef.collection('groups').get()
    const completedGroups = new Map<string, CompletedGroup>()
    // Per-group metadata for the classroom `details` block (spec §5): the reconciled
    // deal, and the composition string ("1C+1K", "2C+1K", …).
    const groupMeta = new Map<string, { agreement: boolean; price: number | null; composition: string }>()
    for (const gdoc of groupsSnap.docs) {
      const d = gdoc.data()
      const outcome = (d['outcome'] as Outcome | null) ?? null
      const agreement = Boolean(d['agreement_reached'])
      completedGroups.set(gdoc.id, { outcome, agreement_reached: agreement })
      const nc = Array.isArray(d['chris_participants']) ? (d['chris_participants'] as string[]).length : 0
      const nk = Array.isArray(d['kelly_participants']) ? (d['kelly_participants'] as string[]).length : 0
      groupMeta.set(gdoc.id, {
        agreement,
        price: outcome ? ((outcome['price'] as number | undefined) ?? null) : null,
        composition: `${nc}C+${nk}K`,
      })
    }

    const [participantsSnap, configSnap] = await Promise.all([
      instanceRef.collection('participants').get(),
      instanceRef.collection('config').doc('main').get(),
    ])
    const configData = (configSnap.data() ?? {}) as Record<string, unknown>

    // First pass: ScoringRecord[] for role-bearing participants.
    const records: ScoringRecord[] = []
    for (const pdoc of participantsSnap.docs) {
      const record = buildScoringRecord(pdoc.id, pdoc.data() as Record<string, unknown>, completedGroups)
      if (record !== null) records.push(record)
    }

    // Normalize: per-role pools, sample SD, cost-sense, no_show→-2, walk-away in-pool.
    const scorer = (role: string, outcome: Outcome | null) => def.computeRawScore(role, outcome, configData)
    const finalized = computeZScoresByRole(records, def.roles, def.scoreSense, scorer)

    const recordMap = def.computeScoreBreakdown
      ? new Map(records.map(r => [r.participant_id, r]))
      : null
    const pdataById = new Map(participantsSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]))
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v)) ? v : null

    // The classroom `details` block (Grays_com_Game_Specification_v1 §5) — pushed via
    // toGameResult, which reads participant.details. Same shape the frozen game sent.
    const detailsFor = (pid: string, surplus: number): Record<string, unknown> => {
      const p = pdataById.get(pid) ?? {}
      const gid = p['group_id'] as string | undefined
      const gm = gid ? groupMeta.get(gid) : undefined
      return {
        display_name: ((p['display_name'] ?? p['name'] ?? '') as string) || pid.slice(0, 8),
        agreement_reached: gm?.agreement ?? false,
        final_price: gm?.price ?? null,
        surplus,
        debrief_initial_price: (typeof p['debrief_first_price'] === 'string' ? p['debrief_first_price'] : null),
        group_id: gid ?? null,
        group_composition: gm?.composition ?? null,
        is_lead: p['is_lead'] === true,
        prep_estimated_other_price: num(p['prep_estimated_other_price']),
        prep_planned_first_offer: num(p['prep_planned_first_offer']),
      }
    }

    // Write scores + the details block (overwrite each run). `details` is stored so
    // toGameResult picks it up on the push; the computed map below also carries it.
    const detailsById = new Map<string, Record<string, unknown>>()
    const now = FieldValue.serverTimestamp()
    const batch = db.batch()
    for (const f of finalized) {
      const rec = recordMap?.get(f.participant_id)
      const breakdown = (def.computeScoreBreakdown && rec)
        ? def.computeScoreBreakdown(rec.role, rec.outcome, configData)
        : null
      const details = detailsFor(f.participant_id, f.raw_score ?? 0)
      detailsById.set(f.participant_id, details)
      batch.update(instanceRef.collection('participants').doc(f.participant_id), {
        raw_score: f.raw_score,
        normalized_score: f.normalized_score,
        knowledge_check_score: f.knowledge_check_score,
        finalized_at: now,
        details,
        ...(breakdown !== null ? { value_or_cost: breakdown.value_or_cost } : {}),
      })
    }

    // Second pass: participants without a valid role → -2 floor.
    const scoredIds = new Set(finalized.map(f => f.participant_id))
    const rolelessPids: string[] = []
    for (const pdoc of participantsSnap.docs) {
      if (scoredIds.has(pdoc.id)) continue
      const role = pdoc.data()['role']
      if (typeof role === 'string' && isValidRole(def.roles, role)) continue
      batch.update(instanceRef.collection('participants').doc(pdoc.id), {
        raw_score: null, normalized_score: -2, finalized_at: now,
      })
      rolelessPids.push(pdoc.id)
    }

    // Instance marker (so getReportData's finalized_at filter + dashboard state see it).
    batch.set(instanceRef, { finalized_at: now, finalized: true }, { merge: true })
    await batch.commit()

    // Push the JUST-computed set (no re-read → no visibility race).
    const computed = new Map<string, Record<string, unknown>>()
    for (const f of finalized) {
      computed.set(f.participant_id, {
        raw_score: f.raw_score,
        normalized_score: f.normalized_score,
        knowledge_check_score: f.knowledge_check_score,
        details: detailsById.get(f.participant_id) ?? {},
      })
    }
    for (const pid of rolelessPids) {
      const doc = participantsSnap.docs.find(d => d.id === pid)
      computed.set(pid, {
        raw_score: null,
        normalized_score: -2,
        knowledge_check_score: (doc?.data()['knowledge_check_score'] ?? null) as number | null,
      })
    }
    const pushRecords: GameResult[] = participantsSnap.docs
      .filter(d => computed.has(d.id))
      .map(d => toGameResult(gameInstanceId, d.id, { ...d.data(), ...computed.get(d.id)! }, def.roles))

    const summary = await push(pushRecords)
    return { ok: true as const, scored: finalized.length + rolelessPids.length, push: summary }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[scoreAndRecord] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})
