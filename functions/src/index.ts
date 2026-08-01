import { onRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import {
  makeGetInstructorSession,
  makeAssignRole,
  makeCompletePrep,
  makeConfirmReady,
  makeGenerateAttendanceCode,
  makeVerifyAttendanceCode,
  makeGetRoster,
  makeSyncRoster,
  makeTriggerMatching,
  makeStartNegotiation,
  makeGetGroupMemberEmails,
  makeSubmitLeadOutcome,
  makeSubmitConfirmation,
  makeSubmitInstructorOutcome,
  makeFinalizeInstance,
  makePushResultsToClassroom,
  makeGetGameConfig,
  makeUpdateGameConfig,
  validateKCGate,
  makeGetStudentPrepQuestions,
  makeGetDebriefQuestions,
  makeSubmitKnowledgeCheck,
  makeSubmitStaticKnowledgeCheckQuestion,
  makeGetInfoUrls,
} from '@mygames/game-server'
import { graysGameDef } from './gameDefinition'

admin.initializeApp()

// ── KC gate validation (runs at cold start — loud failure if gate is misconfigured) ──
const _kcGateError = validateKCGate(
  graysGameDef.roles.roles.map(r => r.key),
  graysGameDef.prepDefaults ?? [],
)
if (_kcGateError) throw new Error(`Grays 2.0 KC gate validation failed: ${_kcGateError}`)

// ── Game endpoints (onCall, via game-server factories + Grays 2.0 definition) ──
// CLASSROOM-ONLY (Part 1): no online-mode grouping and no instructor move/ungroup
// (moveSeat) are wired here. The move/ungroup substrate is inherited for free from
// the pinned shared packages and mounted in Part 2 (Groups panel + moveSeat adapter).

export const getInstructorSession  = makeGetInstructorSession(graysGameDef)
export const assignRole             = makeAssignRole(graysGameDef)
export const completePrep           = makeCompletePrep(graysGameDef)
export const confirmReady           = makeConfirmReady(graysGameDef)
export const generateAttendanceCode = makeGenerateAttendanceCode(graysGameDef)
export const verifyAttendanceCode   = makeVerifyAttendanceCode(graysGameDef)
export const getRoster              = makeGetRoster(graysGameDef)
export const syncRoster             = makeSyncRoster(graysGameDef)
export const triggerMatching            = makeTriggerMatching(graysGameDef)
export const startNegotiation           = makeStartNegotiation(graysGameDef)
export const getGroupMemberEmails      = makeGetGroupMemberEmails(graysGameDef)
export const submitLeadOutcome          = makeSubmitLeadOutcome(graysGameDef)
export const submitConfirmation         = makeSubmitConfirmation(graysGameDef)
export const submitInstructorOutcome    = makeSubmitInstructorOutcome(graysGameDef)
export const finalizeInstance       = makeFinalizeInstance(graysGameDef)
export const pushResultsToClassroom = makePushResultsToClassroom(graysGameDef)
export const getGameConfig          = makeGetGameConfig(graysGameDef)
export const updateGameConfig       = makeUpdateGameConfig(graysGameDef)
export const getStudentPrepQuestions            = makeGetStudentPrepQuestions(graysGameDef)
export const getDebriefQuestions                = makeGetDebriefQuestions(graysGameDef)
export const submitKnowledgeCheck               = makeSubmitKnowledgeCheck(graysGameDef)
export const submitStaticKnowledgeCheckQuestion = makeSubmitStaticKnowledgeCheckQuestion(graysGameDef)
export const getInfoUrls                        = makeGetInfoUrls(graysGameDef)
export { getReportData } from './getReportData'
export { updateGroupContract } from './updateGroupContract'
export { scoreAndRecord } from './scoreAndRecord'

// ── Non-game onRequest endpoints ──────────────────────────────────────────────

const CORS_ORIGINS = new Set(['https://grays2.mygames.live'])

export const health = onRequest((req, res) => {
  const origin = req.headers.origin ?? ''
  if (CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  res.json({ ok: true, game: 'grays2' })
})

// Emulator-only dev seed functions — onRequest, not game endpoints.
export { seedMatchTest, seedGroupForTest } from './seedFunctions'
