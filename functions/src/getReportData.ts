import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import type { Outcome } from '@mygames/game-engine'
import { extractInstructorGameId } from '@mygames/game-server'
import { computeScoreBreakdown, graysGameDef } from './gameDefinition'

// Exported so updateGroupContract can build identical rows without duplicating these.
export const VALID_ROLES = new Set(['chris', 'kelly'])

// Free-text questions from prepDefaults → one Tier-2 report tile per question (the 3
// free-text prep + the 1 free-text debrief). The two number prep questions are NOT tiles.
export const TEXT_QUESTIONS = (graysGameDef.prepDefaults ?? [])
  .filter(q => q.format === 'text' && !q.hidden)
  .map(q => ({ field: q.field, prompt: q.prompt, role_target: q.role_target }))

export const TEXT_FIELDS = TEXT_QUESTIONS.map(q => q.field)

export type ReportRow = {
  participant_id: string
  display_name: string
  group_number: number | null
  group_id: string | null
  role: string
  /** The agreed price (null on a walk-away / no deal). */
  price: number | null
  /** Whether the group reached a deal (false = walk-away). */
  agreement_reached: boolean | null
  /** Net profit surplus = raw_score (Chris: price−res; Kelly: res−price; walk-away: configured). */
  surplus: number | null
  normalized_score: number | null
  knowledge_check_score: number | null
  /** Free-text prep/debrief answers, keyed by question field. */
  text_answers: Record<string, string>
}

function readGroupOutcome(g: admin.firestore.DocumentData): { outcome: Outcome | null; agreement: boolean | null } {
  const outcome = (g['outcome'] as Outcome | null) ?? null
  const agreement = g['agreement_reached'] === undefined ? null : Boolean(g['agreement_reached'])
  return { outcome, agreement }
}

/**
 * Lenient USD parser for the numeric debrief field, which is captured through the
 * shared *text* debrief input (a plain textarea) — so we convert to a number in code
 * rather than requiring a shared-package number widget. Accepts "150000", "$150,000",
 * "150k", "1.2m"; anything non-numeric → null (that group simply drops out of the
 * regression, exactly as a missing value does upstream). Only positive amounts count.
 */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  if (typeof v !== 'string') return null
  let s = v.trim().toLowerCase().replace(/[$,\s]/g, '')
  if (!s) return null
  let mult = 1
  const suffix = s.slice(-1)
  if (suffix === 'k') { mult = 1_000; s = s.slice(0, -1) }
  else if (suffix === 'm') { mult = 1_000_000; s = s.slice(0, -1) }
  const n = parseFloat(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * mult) : null
}

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Per-participant fields the prep histograms + reflection export read (grays.com parity). */
export type ReportParticipant = {
  participant_id: string
  display_name: string
  role: 'chris' | 'kelly'
  prep_planned_first_offer: number | null
  prep_estimated_other_price: number | null
  debrief_reflection: string | null
}

/** Per-group fields the price histogram + regression read. */
export type ReportGroup = {
  group_id: string
  status: string
  agreement_reached: boolean | null
  final_price: number | null
  /** Average of the group members' parsed `debrief_initial_offer` (regression x-axis). */
  group_initial_price: number | null
  chris_participants: string[]
  kelly_participants: string[]
}

export const getReportData = onCall({ cors: graysGameDef.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  const authHeader = request.rawRequest.headers.authorization as string | undefined

  const gameInstanceId = await extractInstructorGameId(data, isEmulator, authHeader)

  try {
    const db = admin.firestore()
    const rtdb = admin.database()
    const instanceRef = db.collection('game_instances').doc(gameInstanceId)

    const [participantsSnap, groupsSnap, configSnap, attendingSnap] = await Promise.all([
      instanceRef.collection('participants').get(),
      instanceRef.collection('groups').get(),
      instanceRef.collection('config').doc('main').get(),
      rtdb.ref(`game_instances/${gameInstanceId}/attendance`).get(),
    ])

    const configData = (configSnap.data() ?? {}) as Record<string, unknown>
    const resNum = (key: string, fallback: number) => {
      const v = configData[key]
      return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : fallback
    }
    const reservations = {
      chris: resNum('reservation_price_chris', 25_000),
      kelly: resNum('reservation_price_kelly', 475_000),
    }
    const attending = (attendingSnap.val() ?? {}) as Record<string, { display_name?: string } | null>

    const sortedGroups = groupsSnap.docs.slice().sort((a, b) => a.id.localeCompare(b.id))
    const groupNumberMap = new Map<string, number>(sortedGroups.map((g, i) => [g.id, i + 1]))
    const groupOutcomeMap = new Map(sortedGroups.map(g => [g.id, readGroupOutcome(g.data())]))

    const rows: ReportRow[] = []

    for (const pdoc of participantsSnap.docs) {
      const d = pdoc.data() as Record<string, unknown>
      if (d['finalized_at'] == null) continue
      const role = d['role'] as string | undefined
      if (!role || !VALID_ROLES.has(role)) continue
      if (d['raw_score'] === null || d['raw_score'] === undefined) continue

      const groupId = d['group_id'] as string | undefined
      const rtdbName = attending[pdoc.id]?.display_name?.trim()
      const fsName   = ((d['display_name'] ?? d['name'] ?? '') as string).trim()
      const display_name = rtdbName || fsName || `${pdoc.id.slice(0, 8)}…`

      const g = groupId ? groupOutcomeMap.get(groupId) : undefined
      const outcome = g?.outcome ?? null

      const text_answers: Record<string, string> = {}
      for (const field of TEXT_FIELDS) {
        const val = d[field]
        if (typeof val === 'string' && val.trim()) text_answers[field] = val.trim()
      }

      rows.push({
        participant_id: pdoc.id,
        display_name,
        group_number: groupId ? (groupNumberMap.get(groupId) ?? null) : null,
        group_id: groupId ?? null,
        role,
        price: outcome ? (outcome['price'] as number) : null,
        agreement_reached: g?.agreement ?? (outcome ? true : false),
        surplus: d['raw_score'] as number,
        normalized_score: (d['normalized_score'] ?? null) as number | null,
        knowledge_check_score: (d['knowledge_check_score'] ?? null) as number | null,
        text_answers,
      })
    }

    rows.sort((a, b) => {
      const gn = (a.group_number ?? Infinity) - (b.group_number ?? Infinity)
      if (gn !== 0) return gn
      return a.display_name.localeCompare(b.display_name)
    })

    // ── Chart inputs (grays.com report parity) ─────────────────────────────────
    // Prep histograms + reflection export read EVERY role-holder (prep answers exist
    // pre-negotiation, so we don't gate these on finalization the way the roster does).
    const nameOf = (id: string, d: Record<string, unknown>) => {
      const rtdbName = attending[id]?.display_name?.trim()
      const fsName = ((d['display_name'] ?? d['name'] ?? '') as string).trim()
      return rtdbName || fsName || `${id.slice(0, 8)}…`
    }
    const offerById = new Map<string, number | null>()
    const participants: ReportParticipant[] = []
    for (const pdoc of participantsSnap.docs) {
      const d = pdoc.data() as Record<string, unknown>
      offerById.set(pdoc.id, parseMoney(d['debrief_initial_offer']))
      const role = d['role'] as string | undefined
      if (role !== 'chris' && role !== 'kelly') continue
      const reflection = d['debrief_reflection']
      participants.push({
        participant_id: pdoc.id,
        display_name: nameOf(pdoc.id, d),
        role,
        prep_planned_first_offer:   numOrNull(d['prep_planned_first_offer']),
        prep_estimated_other_price: numOrNull(d['prep_estimated_other_price']),
        debrief_reflection: typeof reflection === 'string' && reflection.trim() ? reflection.trim() : null,
      })
    }

    const groups: ReportGroup[] = sortedGroups.map(g => {
      const gd = g.data() as Record<string, unknown>
      const { outcome, agreement } = readGroupOutcome(gd)
      const chris = (gd['chris_participants'] ?? []) as string[]
      const kelly = (gd['kelly_participants'] ?? []) as string[]
      const memberOffers = [...chris, ...kelly]
        .map(id => offerById.get(id))
        .filter((v): v is number => typeof v === 'number')
      const group_initial_price = memberOffers.length
        ? Math.round(memberOffers.reduce((a, b) => a + b, 0) / memberOffers.length)
        : null
      return {
        group_id: g.id,
        status: (gd['status'] as string | undefined) ?? 'matched',
        agreement_reached: agreement,
        final_price: outcome ? (outcome['price'] as number) : null,
        group_initial_price,
        chris_participants: chris,
        kelly_participants: kelly,
      }
    })

    return { ok: true as const, rows, questions: TEXT_QUESTIONS, schema: graysGameDef.outcomeSchema, reservations, groups, participants }
  } catch (err) {
    if (err instanceof HttpsError) throw err
    console.error('[getReportData] error:', err)
    throw new HttpsError('internal', 'Internal error')
  }
})

// Re-exported so scoreAndRecord builds the classroom `details` block from one place.
export { computeScoreBreakdown }
