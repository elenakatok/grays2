// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — ONLINE MODE (Part 2).
//
// Grays is the FIRST negotiation consumer of the shared online/seat machinery
// (game-server v0.28.0). It WIRES the shared factories with the NEGOTIATION adapter
// (makeNegotiationGroupAdapter — chris/kelly) and adds the two things that are
// genuinely grays-specific because roles are assigned AT GROUPING (not late like the
// stage family): a 2-role pre-grouping callable, and a per-ROLE-presence auto-open.
//
// Nothing here edits a shared package — the adapter, seat ops, moveSeat, flag, and
// report all come from @mygames/game-server. The grays-local callables consume the
// same adapter + helpers.
//
// SCOPE (Online_Matching_Spec_v1 + the grays spec): pre-group into Chris/Kelly pairs;
// students log in, see partner + email + presence; a group auto-opens the moment ≥1
// Chris AND ≥1 Kelly are present (per-ROLE, never a headcount — a 2-Chris/0-Kelly
// group can never start); the "I can't reach my group" flag (mailto only); the
// assignment-status report. NO BOTS (a bot cannot hold Kelly's private information and
// negotiate). Lock-at-first-play is the negotiation adapter's default hasStarted
// (status leaves 'matched' → seats frozen), which the panel mirrors.
// ═══════════════════════════════════════════════════════════════════════════════

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { randomUUID } from 'crypto'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { roleKeys } from '@mygames/game-engine'
import {
  makeMoveSeat,
  makeGetOnlineGroups,
  makeRecordLogin,
  makeFlagGroup,
  makeGetOnlineReport,
  makeNegotiationGroupAdapter,
  toSeatGroup,
  chunkIntoGroups,
  extractInstructorGameId,
  extractStudentOnCallIds,
  type OnlineContext,
  type OnlineDefinition,
  type GroupProgress,
} from '@mygames/game-server'
import { graysGameDef } from './gameDefinition'

const ROLE_KEYS = roleKeys(graysGameDef.roles)          // ['chris', 'kelly']
const LEAD_ROLE = ROLE_KEYS[0]                          // chris leads
const PAIR_SIZE = ROLE_KEYS.reduce((n, k) => n + (graysGameDef.composition[k] ?? 1), 0)  // 2 — one seat per role

/**
 * NO SIZE CAP for moves (winemaster's online.ts pattern). Doubling-up is LEGAL —
 * "a group may hold 2 Chris + 1 Kelly" (grays spec §2), and a student may move into ANY
 * not-started group. The pure seat op needs a finite seatCount to test fullness, so this
 * sentinel sits far above any real negotiation group: a manual move never bounces on size.
 * (Pre-grouping does NOT use this — it forms pairs of PAIR_SIZE explicitly.)
 */
const NO_SEAT_CAP = 999

// ── OnlineContext (negotiation adapter; no bots) ────────────────────────────────

const onlineDef: OnlineDefinition = {
  seatCount: NO_SEAT_CAP,
  // Negotiation is human-vs-human — bots never exist. makeMoveSeat only calls this on a
  // full-group eviction, which cannot arise without bots; it throws so an accidental
  // future wiring of bot-fill fails loudly rather than minting a phantom seat.
  makeBotSeat: () => {
    throw new HttpsError('failed-precondition', 'Grays 2.0 is a negotiation game — bots are never used.')
  },
  flagMailSubject: "Grays 2.0 — I can't reach my group",
}

// Default hasStarted (negotiation_started_at set OR status 'negotiating') — a group
// locks the moment it opens/connects, exactly what the dashboard panel's default
// isStarted (status !== 'matched') mirrors. Grays negotiates once, so no override.
const adapter = makeNegotiationGroupAdapter(ROLE_KEYS)

const ctx: OnlineContext = { def: graysGameDef, online: onlineDef, adapter }

// ── Shared factories (wired verbatim) ───────────────────────────────────────────

/** Instructor move / ungroup / place-into-new-group — the panel's control (per-group lock). */
export const moveSeat = makeMoveSeat(ctx)
/** Instructor read side: online groups + the No-Group pool. */
export const getOnlineGroups = makeGetOnlineGroups(ctx)
/** Student login stamp; hands back clock_mode so the UI routes online vs classroom. */
export const recordLogin = makeRecordLogin(ctx)
/** "I can't reach my group" — passive idempotent flag + the facts the mailto needs. */
export const flagGroup = makeFlagGroup(ctx)

// Per-group progress for the assignment-status report — status → category.
async function progressOf(gameInstanceId: string): Promise<Map<string, GroupProgress>> {
  const snap = await admin.firestore()
    .collection('game_instances').doc(gameInstanceId).collection('groups').get()
  const map = new Map<string, GroupProgress>()
  for (const g of snap.docs) {
    const status = (g.data()['status'] as string | undefined) ?? 'matched'
    const category = status === 'completed'
      ? 'finished' as const
      : (status === 'negotiating' || status === 'reporting' || status === 'deadlocked')
        ? 'in_progress' as const
        : 'never_started' as const
    map.set(g.id, { category, rounds: category === 'never_started' ? 0 : 1 })
  }
  return map
}

export const getOnlineReport = makeGetOnlineReport(ctx, { progressOf, absenceLabel: 'Missed' })

// ── grays-local helpers ─────────────────────────────────────────────────────────

const db = () => admin.firestore()
const instanceRef = (iid: string) => db().collection('game_instances').doc(iid)
const groupsRef = (iid: string) => instanceRef(iid).collection('groups')
const participantsRef = (iid: string) => instanceRef(iid).collection('participants')
const authHeaderOf = (req: CallableRequest) => req.rawRequest.headers.authorization as string | undefined
const isEmu = () => process.env.FUNCTIONS_EMULATOR === 'true'
const cors = { cors: graysGameDef.corsOrigins }

const displayNameOf = (d: Record<string, unknown>, id: string): string => {
  const chosen = d['display_name']; if (typeof chosen === 'string' && chosen.trim()) return chosen
  const roster = d['name']; if (typeof roster === 'string' && roster.trim()) return roster
  return id
}
const emailOf = (d: Record<string, unknown>): string | null => {
  const e = d['email']; return typeof e === 'string' && e.trim() ? e.trim() : null
}
/** Denormalised member entry the online reveal reads off the group doc (rules block a
 *  student from reading a partner's participant doc, so names/emails live here). */
type MemberEntry = { participant_id: string; display_name: string; email: string | null; is_bot: false; role: string }
const memberEntry = (id: string, d: Record<string, unknown>, role: string): MemberEntry => ({
  participant_id: id, display_name: displayNameOf(d, id), email: emailOf(d), is_bot: false, role,
})

async function requireOnline(iid: string): Promise<void> {
  const cfg = await instanceRef(iid).collection('config').doc('main').get()
  if (String(cfg.data()?.['clock_mode'] ?? 'on') !== 'off') {
    throw new HttpsError('failed-precondition', 'This action is only available in online mode.')
  }
}

// A trivial local shuffle (grouping is not meant to be reproducible).
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ── Pre-grouping (grays-local: 2-role, roles assigned AT grouping) ──────────────
//
// The instructor pre-matches the WHOLE roster into Chris/Kelly PAIRS before anyone
// logs in. Deterministic role rule: FIRST seat → Chris (lead), SECOND seat → Kelly.
// A leftover single forms a one-person group (Chris only) — a half-pair the missing-
// role badge flags and the instructor merges. Re-runnable until the first group opens.

export const groupParticipantsOnline = onCall(cors, async (request) => {
  const data = request.data as Record<string, unknown>
  const gameInstanceId = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))
  await requireOnline(gameInstanceId)

  const [groupsSnap, participantsSnap] = await Promise.all([
    groupsRef(gameInstanceId).get(),
    participantsRef(gameInstanceId).get(),
  ])

  // INSTANCE-WIDE lock — the only one. Re-forming after any group opened forks a live game.
  const anyStarted = groupsSnap.docs.some(d => adapter.hasStarted(d.data() as Record<string, unknown>))
  if (anyStarted) {
    throw new HttpsError('failed-precondition', 'A group has already started, so groups can no longer be re-formed.')
  }

  const humans = participantsSnap.docs.filter(d => (d.data() as Record<string, unknown>)['is_bot'] !== true)
  if (humans.length === 0) throw new HttpsError('failed-precondition', 'No participants on the roster to group yet.')

  const dataById = new Map(humans.map(d => [d.id, d.data() as Record<string, unknown>]))
  const pairs = chunkIntoGroups(shuffle(humans.map(d => d.id)), PAIR_SIZE)
  const now = FieldValue.serverTimestamp()

  const batch = db().batch()
  for (const g of groupsSnap.docs) batch.delete(g.ref)  // re-run: drop prior groups

  const created: { group_id: string; size: number }[] = []
  for (const pair of pairs) {
    const groupId = randomUUID()
    // seat 0 → chris (lead), seat 1 → kelly.
    const roleOfSeat = (i: number) => ROLE_KEYS[i] ?? ROLE_KEYS[ROLE_KEYS.length - 1]
    const members: MemberEntry[] = pair.map((pid, i) => memberEntry(pid, dataById.get(pid) ?? {}, roleOfSeat(i)))
    const lead = pair[0] ?? null

    const groupDoc: Record<string, unknown> = {
      group_id: groupId,
      game_instance_id: gameInstanceId,
      lead_participant_id: lead,
      outcome: null,
      status: 'matched',
      matched_at: now,
      arrived: [],          // presence set — load-bearing for the report's arrival_data_present
      members,              // denormalised name+email+role for the online reveal
    }
    for (const k of ROLE_KEYS) groupDoc[`${k}_participants`] = members.filter(m => m.role === k).map(m => m.participant_id)
    batch.set(groupsRef(gameInstanceId).doc(groupId), groupDoc)

    for (const m of members) {
      batch.update(participantsRef(gameInstanceId).doc(m.participant_id), {
        group_id: groupId,
        role: m.role,
        role_assigned_at: now,
        is_lead: m.participant_id === lead,
        display_name: m.display_name,
      })
    }
    created.push({ group_id: groupId, size: pair.length })
  }
  await batch.commit()

  const short = created.find(g => g.size < PAIR_SIZE)
  return {
    ok: true as const,
    groups: created.length,
    full_pairs: created.filter(g => g.size === PAIR_SIZE).length,
    short_group_size: short?.size ?? null,
    total_humans: humans.length,
    seat_count: PAIR_SIZE,
  }
})

// ── Online arrival + per-ROLE auto-open (grays-local) ───────────────────────────
//
// The student's online waiting screen calls this on mount. It stamps the caller into
// the group's `arrived` set, RE-HYDRATES the denormalised members[] from truth (so a
// prior instructor move is reflected), and AUTO-OPENS the group the moment BOTH roles
// have a present member — per ROLE, never a seat headcount. A 2-Chris/0-Kelly group
// therefore can never auto-open (no Kelly seat to be present), which is exactly why the
// missing-role badge is advisory only: the predicate physically cannot fire.

export const recordOnlineArrival = onCall(cors, async (request) => {
  const data = request.data as Record<string, unknown>
  const { participantId, gameInstanceId } = await extractStudentOnCallIds(data, isEmu(), authHeaderOf(request))

  const configSnap = await instanceRef(gameInstanceId).collection('config').doc('main').get()
  const clockMode = String(configSnap.data()?.['clock_mode'] ?? 'on')

  const pRef = participantsRef(gameInstanceId).doc(participantId)
  const pSnap = await pRef.get()
  const groupId = (pSnap.data()?.['group_id'] as string | undefined) ?? null
  await pRef.set({ last_login_at: FieldValue.serverTimestamp() }, { merge: true })

  if (clockMode !== 'off' || !groupId) {
    return { ok: true as const, clock_mode: clockMode, group_id: groupId, status: null as string | null, opened: false }
  }

  const gRef = groupsRef(gameInstanceId).doc(groupId)

  const result = await db().runTransaction(async (tx) => {
    const gSnap = await tx.get(gRef)
    if (!gSnap.exists) return { status: null as string | null, opened: false }
    const g = gSnap.data() as Record<string, unknown>

    // Member ids by role, straight off the group doc's role arrays.
    const idsByRole = new Map<string, string[]>(
      ROLE_KEYS.map(k => [k, (Array.isArray(g[`${k}_participants`]) ? (g[`${k}_participants`] as string[]) : [])]),
    )
    const allIds = ROLE_KEYS.flatMap(k => idsByRole.get(k) ?? [])

    // Re-hydrate members[] from truth (keeps names/emails fresh through instructor moves).
    const memberSnaps = allIds.length ? await tx.getAll(...allIds.map(id => participantsRef(gameInstanceId).doc(id))) : []
    const dataById = new Map(memberSnaps.map(s => [s.id, (s.data() ?? {}) as Record<string, unknown>]))
    const roleOf = (id: string) => ROLE_KEYS.find(k => (idsByRole.get(k) ?? []).includes(id)) ?? LEAD_ROLE
    const members: MemberEntry[] = allIds.map(id => memberEntry(id, dataById.get(id) ?? {}, roleOf(id)))

    const arrived = new Set<string>(Array.isArray(g['arrived']) ? (g['arrived'] as string[]) : [])
    arrived.add(participantId)

    // Per-ROLE presence: EVERY role must have ≥1 seated member who has arrived.
    const bothRolesPresent = ROLE_KEYS.every(k => (idsByRole.get(k) ?? []).some(id => arrived.has(id)))
    const status = (g['status'] as string | undefined) ?? 'matched'
    const shouldOpen = bothRolesPresent && status === 'matched'

    const patch: Record<string, unknown> = { arrived: [...arrived], members }
    if (shouldOpen) { patch['status'] = 'negotiating'; patch['negotiation_started_at'] = FieldValue.serverTimestamp() }
    tx.update(gRef, patch)

    return { status: shouldOpen ? 'negotiating' : status, opened: shouldOpen }
  })

  return { ok: true as const, clock_mode: clockMode, group_id: groupId, status: result.status, opened: result.opened }
})

export { toSeatGroup }
