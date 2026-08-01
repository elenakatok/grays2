import type { Outcome, OutcomeSchema, RoleConfig } from '@mygames/game-engine'
import type { GameDefinition } from '@mygames/game-server'
// Shared latecomer joinability (Latecomer_Placement_Spec_v1 §3.1) — one predicate for all negotiation games.
import { negotiationIsJoinable } from '@mygames/game-server'

// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — bilateral negotiation, TWO roles, ONE student per role.
//
// PART 1 = the BLANK CANVAS. Real role KEYS (chris/kelly) and labels are stable and
// kept, but ALL CONTENT below — reservation prices, KC/prep text, info docs, the
// outcome schema, and the scoring formula — is PLACEHOLDER / STUB. Part 2 drops the
// easy data (role names, reservations, info docs, KC), Part 3 supplies the real
// contract-form fields and the per-role scoring formula. Do not treat any number
// or prompt here as final.
//
// Spawned FROM WINEMASTER (the canonical 2-role reference), classroom-only. Matching,
// role-as-data, and the dashboard-invoked triggerMatching are winemaster-identical.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Role config ───────────────────────────────────────────────────────────────
// Chris = seller and LEAD in every group. Kelly = buyer.

export const graysConfig: RoleConfig = {
  roles: [
    { key: 'chris', label: 'Chris', short: 'C' },  // first key → lead
    { key: 'kelly', label: 'Kelly', short: 'K' },
  ],
}

// ── Outcome schema (STUB — Part 3 supplies the real contract fields) ───────────
// One dummy price field plus optional free-text notes, matching winemaster's shape.

export const graysSchema: OutcomeSchema = [
  { key: 'price', type: 'integer', min: 0, max: 1_000_000 },
  { key: 'notes', type: 'text' },  // optional free-text; blank = '', excluded from scoring
]

// ── Score sense (per-role, eventual shape) ────────────────────────────────────
// Chris (seller) = value-sense (higher surplus above reservation = better).
// Kelly (buyer)  = cost-sense  (lower price below reservation = better).

export const graysScoreSense: Record<string, 'value' | 'cost'> = {
  chris: 'value',
  kelly: 'cost',
}

// ── Scoring formulas (STUB — Part 3 supplies the real math + conformance vector) ─
// Placeholder surplus model: raw_score is surplus vs. each role's reservation.
//   chris (seller): value_or_cost = price;  raw_score = price − chris_reservation
//   kelly (buyer):  value_or_cost = price;  raw_score = kelly_reservation − price
// Walk-away (null outcome): value_or_cost = reservation, raw_score = 0.

const CHRIS_RESERVATION_DEFAULT = 100_000  // placeholder seller floor
const KELLY_RESERVATION_DEFAULT = 200_000  // placeholder buyer ceiling

function readReservation(configData: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = configData?.[key]
  return (typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isInteger(v)) ? v : fallback
}

export function computeScoreBreakdown(
  roleKey: string,
  outcome: Outcome | null,
  configData?: Record<string, unknown>,
): { value_or_cost: number; raw_score: number } {
  const chrisRes = readReservation(configData, 'chris_reservation_price', CHRIS_RESERVATION_DEFAULT)
  const kellyRes = readReservation(configData, 'kelly_reservation_price', KELLY_RESERVATION_DEFAULT)

  if (outcome === null) {
    const res = roleKey === 'chris' ? chrisRes : kellyRes
    return { value_or_cost: res, raw_score: 0 }
  }

  const price = outcome['price'] as number

  if (roleKey === 'chris') {
    return { value_or_cost: price, raw_score: price - chrisRes }
  } else {
    return { value_or_cost: price, raw_score: kellyRes - price }
  }
}

export function computeRawScore(roleKey: string, outcome: Outcome | null, configData?: Record<string, unknown>): number {
  return computeScoreBreakdown(roleKey, outcome, configData).raw_score
}

// ── GameDefinition (full contract for game-server factories) ─────────────────

export const graysGameDef: GameDefinition = {
  game_id: 'grays2',
  roles:   graysConfig,
  scoreSense: graysScoreSense,
  composition: { chris: 1, kelly: 1 },  // symmetric, one student per role
  outcomeSchema: graysSchema,
  computeRawScore,
  computeScoreBreakdown,
  reservations: { chris: CHRIS_RESERVATION_DEFAULT, kelly: KELLY_RESERVATION_DEFAULT },
  corsOrigins: ['https://grays2.mygames.live'],
  classroom: { callbackSecretId: 'CLASSROOM_CALLBACK_SECRET' },
  // Latecomer auto-placement (spec §3.1). Joinable = group not yet negotiating.
  isJoinable: negotiationIsJoinable,
  // perRoleCap omitted → factory uses eligible.length (no cap, place every extra).
  // deadlockThreshold omitted → factory defaults to 5.

  // Settings page config fields — role names, reservation prices, info links (all STUB defaults).
  configFields: [
    { key: 'chris_role_name',        kind: 'string',      default: 'Chris'  },
    { key: 'kelly_role_name',        kind: 'string',      default: 'Kelly'  },
    { key: 'chris_reservation_price', kind: 'positiveInt', default: CHRIS_RESERVATION_DEFAULT },
    { key: 'kelly_reservation_price', kind: 'positiveInt', default: KELLY_RESERVATION_DEFAULT },
    { key: 'chris_sheet_url',        kind: 'url',         default: '/role-info/chris.pdf' },
    { key: 'kelly_sheet_url',        kind: 'url',         default: '/role-info/kelly.pdf' },
    // ── Online mode (Part 2) ──────────────────────────────────────────────────
    // clock_mode: 'on' = classroom (attendance code + match-on-the-spot), 'off' = online
    // (pre-grouped pairs, auto-start on per-role presence). The student UI's only way to
    // learn the mode (config/main is server-only readable) — recordLogin hands it back.
    { key: 'clock_mode',       kind: 'string', default: 'on' },
    // Instructor email for the "I can't reach my group" mailto. A MANUAL override that
    // WINS over the course-owner address synced at roster sync (Online_Matching_Spec §4.6).
    { key: 'instructor_email', kind: 'string', default: '' },
  ],

  // Info page links — keys match configFields above (STUB targets).
  roleInfoLinks: [
    { roleKey: 'chris', links: [
      { key: 'chris_sheet_url', label: 'Role sheet' },
    ]},
    { roleKey: 'kelly', links: [
      { key: 'kelly_sheet_url', label: 'Role sheet' },
    ]},
  ],

  prepDefaults: [
    // ── Q1: Role-identification gate (system, one per role) — STUB text ──────────
    {
      field: 'kc_gate_chris', type: 'mc', system: true,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'assigned_role', role_target: 'chris',
      prompt: '[Placeholder] What is your role in this negotiation?',
      placeholder: '', order: 0, hidden: false, deletable: false,
      options: [
        { value: 'chris', label: 'Chris — the seller' },
        { value: 'kelly', label: 'Kelly — the buyer' },
      ],
      explanation: 'You are Chris, the seller and lead in this negotiation.',
    },
    {
      field: 'kc_gate_kelly', type: 'mc', system: true,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'assigned_role', role_target: 'kelly',
      prompt: '[Placeholder] What is your role in this negotiation?',
      placeholder: '', order: 0, hidden: false, deletable: false,
      options: [
        { value: 'chris', label: 'Chris — the seller' },
        { value: 'kelly', label: 'Kelly — the buyer' },
      ],
      explanation: 'You are Kelly, the buyer in this negotiation.',
    },

    // ── Q2: one graded MC per role (STUB — Part 2 supplies real KC content) ──────
    {
      field: 'kc_chris_stub', type: 'mc', system: false,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'static', correct_value: 'a', role_target: 'chris',
      prompt: '[Placeholder graded question — Chris] Choose the correct option.',
      placeholder: '', order: 10, hidden: false, deletable: false,
      options: [
        { value: 'a', label: '[Placeholder] Correct answer' },
        { value: 'b', label: '[Placeholder] Distractor B' },
        { value: 'c', label: '[Placeholder] Distractor C' },
      ],
      explanation: '[Placeholder] Replace with the real explanation in Part 2.',
    },
    {
      field: 'kc_kelly_stub', type: 'mc', system: false,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'static', correct_value: 'a', role_target: 'kelly',
      prompt: '[Placeholder graded question — Kelly] Choose the correct option.',
      placeholder: '', order: 10, hidden: false, deletable: false,
      options: [
        { value: 'a', label: '[Placeholder] Correct answer' },
        { value: 'b', label: '[Placeholder] Distractor B' },
        { value: 'c', label: '[Placeholder] Distractor C' },
      ],
      explanation: '[Placeholder] Replace with the real explanation in Part 2.',
    },

    // ── Free-text questions — one Tier-2 report tile PER question (STUB text) ─────
    // Asked to BOTH roles (role_target 'all'); Part 2 fills the real prompts.
    {
      field: 'prep_first_topic', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: '[Placeholder] What is the first topic you plan to raise?',
      placeholder: '', order: 20, hidden: false, deletable: true,
    },
    {
      field: 'prep_question_other_side', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: '[Placeholder] What is one question you want to ask the other side?',
      placeholder: '', order: 21, hidden: false, deletable: true,
    },
    {
      field: 'prep_reason_for_number', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: '[Placeholder] What is the reason behind your opening number?',
      placeholder: '', order: 22, hidden: false, deletable: true,
    },
    {
      field: 'debrief_first_price', type: 'text', system: false,
      category: 'debrief', format: 'text', role_target: 'all',
      prompt: '[Placeholder] What was the first price proposed, and who proposed it?',
      placeholder: '', order: 30, hidden: false, deletable: true,
    },
  ],

  // BU-phase: content fields not used by backend factories; populated in Part 2.
  content: {
    infoPDFs:      {} as Record<string, { private: string; public?: string }>,
    kcQuestions:   [],
    prepQuestions: [],
    scenarioText:  {},
  },
}
