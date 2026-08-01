import { httpsCallable } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { functions } from './firebase'

// ── Helper ────────────────────────────────────────────────────────────────────
// Single wrapper: the Firebase SDK auto-attaches the ID token Bearer when
// auth.currentUser exists, and sends nothing when there is no session —
// covering both bootstrap (getInstructorSession, assignRole) and authed calls.

async function callFn<T>(name: string, data: object = {}): Promise<T> {
  const fn = httpsCallable<object, T>(functions, name)
  const result = await fn(data)
  return result.data
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestArgs   = { _test: { participant_id: string; game_instance_id: string } }
export type TokenArgs  = { token: string }
export type BearerArgs = Record<string, never>   // empty — auth is in Authorization header
export type CallArgs   = TestArgs | TokenArgs | BearerArgs

export type AssignRoleResult = {
  ok:               boolean
  role:             string
  customToken:      string
  participant_id:   string
  game_instance_id: string
}

/** Bootstrap — no session yet; classroom JWT or _test bypass travels in data. */
export const assignRole = (args: CallArgs) =>
  callFn<AssignRoleResult>('assignRole', args)

export const CLASSROOM_URL = import.meta.env.DEV
  ? 'http://localhost:5173'
  : 'https://classroom.mygames.live'

// onCall auth errors arrive as FirebaseError with code 'functions/permission-denied'
// or 'functions/unauthenticated' — not HTTP status strings.
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof FirebaseError)) return false
  return (
    err.code === 'functions/permission-denied' ||
    err.code === 'functions/unauthenticated'
  )
}

export type OutcomeFields = Record<string, unknown>

export const confirmReady = (args: CallArgs) =>
  callFn<{ ok: boolean }>('confirmReady', args)

export const verifyAttendanceCode = (args: CallArgs, code: string) =>
  callFn<{ ok: boolean }>('verifyAttendanceCode', { ...args, code })

export const startNegotiation = (args: CallArgs) =>
  callFn<{ ok: boolean }>('startNegotiation', args)

export const submitLeadOutcome = (args: CallArgs, outcome: OutcomeFields | null) =>
  callFn<{ ok: boolean }>('submitLeadOutcome', { ...args, outcome })

export const submitConfirmation = (args: CallArgs, confirmed: boolean) =>
  callFn<{ ok: boolean; outcome: string }>('submitConfirmation', { ...args, confirmed })

// ── Instructor API ────────────────────────────────────────────────────────────

export type InstructorSessionArgs =
  | { token: string }
  | { _dev: { game_instance_id: string } }

export type RosterParticipant = {
  participant_id: string
  display_name:   string
  role:           string | null
  role_label:     string | null
  group_id:       string | null
  is_lead:        boolean | null
  attended:       boolean
  finalized:      boolean
}

export type RosterGroup = {
  group_id:             string
  status:               string
  lead_participant_id:  string
  participants_by_role: Record<string, string[]>
  agreement_reached:    boolean | null
  outcome:              Record<string, unknown> | null
}

export type PushSummary = {
  total:     number
  succeeded: number
  failed:    { participant_id: string; reason: string }[]
}

/** Bootstrap — no session yet; JWT travels in data; SDK attaches nothing. */
export const getInstructorSession = (args: InstructorSessionArgs) =>
  callFn<{ ok: boolean; customToken: string }>('getInstructorSession', args)

/** Remaining instructor calls: SDK auto-attaches Firebase Bearer when session exists. */
export const syncRoster = () =>
  callFn<{ ok: boolean; synced: number; skipped: number }>('syncRoster', {})

export const generateAttendanceCode = () =>
  callFn<{ ok: boolean; code: string }>('generateAttendanceCode', {})

export const getRoster = () =>
  callFn<{ ok: boolean; participants: RosterParticipant[]; groups: RosterGroup[] }>('getRoster', {})

export const triggerMatching = () =>
  callFn<{ ok: boolean; groups: unknown[]; alreadyMatched?: boolean }>('triggerMatching', {})

export const finalizeInstance = () =>
  callFn<{ ok: boolean }>('finalizeInstance', {})

export const pushResultsToClassroom = () =>
  callFn<{ ok: boolean } & PushSummary>('pushResultsToClassroom', {})

// ── Online mode (Part 2) ──────────────────────────────────────────────────────

export type GameConfig = { ok: boolean; clock_mode?: string; instructor_email?: string; [k: string]: unknown }

/** Instructor: read the config (for the clock_mode toggle state). */
export const getGameConfig = () => callFn<GameConfig>('getGameConfig', {})

/** Instructor: flip classroom ('on') / online ('off') mode. */
export const setClockMode = (mode: 'on' | 'off') =>
  callFn<GameConfig>('updateGameConfig', { clock_mode: mode })

/** Instructor: pre-match the whole roster into Chris/Kelly pairs (online mode). */
export const groupParticipantsOnline = () =>
  callFn<{ ok: boolean; groups: number; full_pairs: number; short_group_size: number | null; total_humans: number }>(
    'groupParticipantsOnline', {})

/** Student: mark present in the online waiting room + trigger per-role auto-open. */
export const recordOnlineArrival = (args: CallArgs) =>
  callFn<{ ok: boolean; clock_mode: string; group_id: string | null; status: string | null; opened: boolean }>(
    'recordOnlineArrival', args)

/** Student: login stamp; returns clock_mode so the UI routes online vs classroom. */
export const recordLogin = (args: CallArgs) =>
  callFn<{ ok: boolean; group_id: string | null; clock_mode: string }>('recordLogin', args)

/** Student: "I can't reach my group" — raises the passive flag, returns the mailto facts. */
export const flagGroup = (args: CallArgs) =>
  callFn<{ ok: boolean; group_number: number; instructor_email: string | null; already_flagged?: boolean }>(
    'flagGroup', args)

// The assignment-status report shape (Online_Matching_Spec §6) — straight to the shared tile.
export type OnlineReport = {
  ok: boolean
  absence_label: string
  arrival_data_present: boolean
  counts: { finished: number; inProgress: number; neverStarted: number; flagged: number }
  groups: {
    groupId: string; groupNumber: number
    category: 'finished' | 'in_progress' | 'never_started'
    humanCount: number; botCount: number
    flagged: boolean; flagStale: boolean; reporterName: string | null; rounds: number
  }[]
  students: {
    participantId: string; name: string; groupNumber: number | null
    category: 'finished' | 'in_progress' | 'never_started' | 'no_group'
    arrived: boolean | null; lastLoginMs: number | null
    flagged: boolean; playedWithBots: boolean; absences: number; rounds: number | null
  }[]
}

/** Instructor: the assignment-status report. */
export const getOnlineReport = () => callFn<OnlineReport>('getOnlineReport', {})
