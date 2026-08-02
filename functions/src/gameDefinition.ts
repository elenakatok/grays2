import type { Outcome, OutcomeSchema, RoleConfig } from '@mygames/game-engine'
import type { GameDefinition } from '@mygames/game-server'
// Shared latecomer joinability (Latecomer_Placement_Spec_v1 §3.1) — one predicate for all negotiation games.
import { negotiationIsJoinable } from '@mygames/game-server'

// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — bilateral negotiation over the sale of the domain name Grays.com.
// Content ported from Grays_com_Game_Specification_v1 (Part 3). Two roles, one student
// each: CHRIS (seller, LEAD in every group) and KELLY (buyer). ZOPA $25,000–$475,000.
//
// Reservation prices are CONFIG DEFAULTS the instructor can change; scoring MUST read
// them from game_config, never hardcode (spec Appendix B "critical implementation note").
// ═══════════════════════════════════════════════════════════════════════════════

// ── Role config ───────────────────────────────────────────────────────────────
// Chris = seller and LEAD (first role key). Kelly = buyer.

export const graysConfig: RoleConfig = {
  roles: [
    { key: 'chris', label: 'Chris', short: 'C' },  // first key → lead
    { key: 'kelly', label: 'Kelly', short: 'K' },
  ],
}

// ── Outcome schema — a single agreed price (spec §2 Phase 2 Step 6) ────────────

export const graysSchema: OutcomeSchema = [
  { key: 'price', type: 'integer', min: 0, max: 10_000_000 },
]

// ── Score sense ───────────────────────────────────────────────────────────────
// raw_score IS the surplus (net profit) for BOTH roles — Chris' surplus rises with the
// price, Kelly's falls with it, but each role's stored raw is already oriented so higher
// = better. So both are value-sense (no sign flip in normalization). Matches winemaster.

export const graysScoreSense: Record<string, 'value' | 'cost'> = {
  chris: 'value',
  kelly: 'value',
}

// ── Scoring (spec §4 Finalize, §5, Appendix B) ────────────────────────────────
// Chris raw = final_price − reservation_price_chris   (seller surplus above his floor)
// Kelly raw = reservation_price_kelly − final_price   (buyer surplus below her ceiling)
// Walk-away (null outcome) raw = configured walk-away value (default 0), IN the pool.
// Reservation + walk-away values are READ FROM CONFIG (Appendix B), never hardcoded.

const CHRIS_RESERVATION_DEFAULT = 25_000    // seller's floor: cost to switch domains
const KELLY_RESERVATION_DEFAULT = 475_000   // buyer's ceiling: 1% of first-year ticket sales
const WALKAWAY_DEFAULT = 0

function readReservation(config: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = config?.[key]
  return (typeof v === 'number' && Number.isFinite(v) && v > 0 && Number.isInteger(v)) ? v : fallback
}
function readWalkaway(config: Record<string, unknown> | undefined, key: string): number {
  const v = config?.[key]
  return (typeof v === 'number' && Number.isFinite(v)) ? v : WALKAWAY_DEFAULT
}

export function computeScoreBreakdown(
  roleKey: string,
  outcome: Outcome | null,
  configData?: Record<string, unknown>,
): { value_or_cost: number; raw_score: number } {
  const resChris = readReservation(configData, 'reservation_price_chris', CHRIS_RESERVATION_DEFAULT)
  const resKelly = readReservation(configData, 'reservation_price_kelly', KELLY_RESERVATION_DEFAULT)

  if (outcome === null) {
    // Walk-away: raw = configured walk-away value; value_or_cost carries no price.
    const wa = roleKey === 'chris'
      ? readWalkaway(configData, 'walkaway_raw_chris')
      : readWalkaway(configData, 'walkaway_raw_kelly')
    return { value_or_cost: 0, raw_score: wa }
  }

  const price = outcome['price'] as number
  // value_or_cost = the agreed price (the transaction value); raw_score = the surplus.
  if (roleKey === 'chris') return { value_or_cost: price, raw_score: price - resChris }
  return { value_or_cost: price, raw_score: resKelly - price }
}

export function computeRawScore(roleKey: string, outcome: Outcome | null, configData?: Record<string, unknown>): number {
  return computeScoreBreakdown(roleKey, outcome, configData).raw_score
}

// ── GameDefinition ────────────────────────────────────────────────────────────

export const graysGameDef: GameDefinition = {
  game_id: 'grays2',
  roles:   graysConfig,
  scoreSense: graysScoreSense,
  composition: { chris: 1, kelly: 1 },
  outcomeSchema: graysSchema,
  computeRawScore,
  computeScoreBreakdown,
  reservations: { chris: CHRIS_RESERVATION_DEFAULT, kelly: KELLY_RESERVATION_DEFAULT },
  corsOrigins: ['https://grays2.mygames.live'],
  classroom: { callbackSecretId: 'CLASSROOM_CALLBACK_SECRET' },
  isJoinable: negotiationIsJoinable,

  // Settings-page config fields.
  configFields: [
    { key: 'chris_role_name',         kind: 'string',      default: 'Chris'   },
    { key: 'kelly_role_name',         kind: 'string',      default: 'Kelly'   },
    // Reservation prices (spec Appendix B) — scoring reads these, not constants.
    { key: 'reservation_price_chris', kind: 'positiveInt', default: CHRIS_RESERVATION_DEFAULT },
    { key: 'reservation_price_kelly', kind: 'positiveInt', default: KELLY_RESERVATION_DEFAULT },
    // Walk-away raw score per role (spec §4/§6) — USD assigned to walk-aways in the pool.
    { key: 'walkaway_raw_chris',      kind: 'decimal',     default: 0, min: 0 },
    { key: 'walkaway_raw_kelly',      kind: 'decimal',     default: 0, min: 0 },
    // Info documents (spec §2 Steps 2–3). Chris = seller sheet, Kelly = buyer sheet, plus
    // the shared public sheet shown to both (publicInfoLinkKey below).
    { key: 'chris_sheet_url',         kind: 'url',         default: '/role-info/seller.pdf' },
    { key: 'kelly_sheet_url',         kind: 'url',         default: '/role-info/buyer.pdf'  },
    { key: 'public_url',              kind: 'url',         default: '/role-info/public.pdf' },
    // Online mode (Part 2).
    { key: 'clock_mode',              kind: 'string',      default: 'on' },
    { key: 'instructor_email',        kind: 'string',      default: '' },
  ],

  // Public information sheet — served to BOTH roles by getInfoUrls (spec §2 Step 2).
  publicInfoLinkKey: 'public_url',

  // Private (role-secured) information sheets — getInfoUrls returns ONLY the caller's own
  // role links, so one role can never fetch the other's private page (spec §2 Step 3).
  roleInfoLinks: [
    { roleKey: 'chris', links: [
      { key: 'chris_sheet_url', label: 'Your confidential role information (Chris — Seller)' },
    ]},
    { roleKey: 'kelly', links: [
      { key: 'kelly_sheet_url', label: 'Your confidential role information (Kelly — Buyer)' },
    ]},
  ],

  prepDefaults: [
    // ── Knowledge check — role identity gate, one per role (spec §2 Step 4) ─────
    // Correct answer = the student's assigned role; wrong → retry, cannot proceed.
    // KC score = 1.0 on passing the gate (shared zero-static short-circuit).
    {
      field: 'kc_gate_chris', type: 'mc', system: true,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'assigned_role', role_target: 'chris',
      prompt: 'What is your role in the negotiation?',
      placeholder: '', order: 0, hidden: false, deletable: false,
      options: [
        { value: 'chris', label: 'Chris Gray, the seller' },
        { value: 'kelly', label: 'Kelly Kaplan, the buyer' },
      ],
      explanation: "That's not right. Please review your role information and try again.",
    },
    {
      field: 'kc_gate_kelly', type: 'mc', system: true,
      category: 'knowledge_check', format: 'multiple_choice',
      grading: 'assigned_role', role_target: 'kelly',
      prompt: 'What is your role in the negotiation?',
      placeholder: '', order: 0, hidden: false, deletable: false,
      options: [
        { value: 'chris', label: 'Chris Gray, the seller' },
        { value: 'kelly', label: 'Kelly Kaplan, the buyer' },
      ],
      explanation: "That's not right. Please review your role information and try again.",
    },

    // ── Preparation questions — the FIVE (spec §2 Step 5), asked to both roles ──
    {
      field: 'prep_first_topic', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: 'When you sit down to talk, what is the first topic you will bring up with the other side?',
      placeholder: '', order: 10, hidden: false, deletable: true,
    },
    {
      field: 'prep_estimated_other_price', type: 'number', system: false,
      category: 'preparation', format: 'number', role_target: 'all',
      prompt: "What is your best guess of the other side's walk-away value (reservation price)?",
      placeholder: 'Enter an amount in US dollars', order: 11, hidden: false, deletable: false,
    },
    {
      field: 'prep_question_for_other', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: 'What question would you most like to ask the other side? Why?',
      placeholder: '', order: 12, hidden: false, deletable: true,
    },
    {
      field: 'prep_planned_first_offer', type: 'number', system: false,
      category: 'preparation', format: 'number', role_target: 'all',
      prompt: 'Assuming you make the first offer, what number do you think you will put on the table? This is non-binding.',
      placeholder: 'Enter an amount in US dollars', order: 13, hidden: false, deletable: false,
    },
    {
      field: 'prep_planned_offer_reason', type: 'text', system: false,
      category: 'preparation', format: 'text', role_target: 'all',
      prompt: 'What is the reason for the number you gave?',
      placeholder: '', order: 14, hidden: false, deletable: true,
    },

    // ── Debrief — the single fixed question (spec §2 Step 7; Elena: only this one) ─
    // Free text, per side, non-reconciling (mismatches allowed). Drives the Tier-2 tile.
    {
      field: 'debrief_first_price', type: 'text', system: false,
      category: 'debrief', format: 'text', role_target: 'all',
      prompt: 'What was the first price proposed in the negotiation, and who proposed it?',
      placeholder: '', order: 20, hidden: false, deletable: true,
    },
    // Numeric opening offer — the x-axis of the "final price vs. initial offer" regression
    // (grays.com report parity). Captured via the shared debrief text field (a plain
    // textarea) and parsed to a number server-side in getReportData, so no shared-package
    // change is needed. format:'number' keeps it OUT of the free-text Tier-2 tiles.
    {
      field: 'debrief_initial_offer', type: 'number', system: false,
      category: 'debrief', format: 'number', role_target: 'all',
      prompt: 'As a number, what was the first price (in US dollars) put on the table? Enter digits only — for example, 150000.',
      placeholder: 'e.g. 150000', order: 21, hidden: false, deletable: false,
    },
  ],

  content: {
    infoPDFs:      {} as Record<string, { private: string; public?: string }>,
    kcQuestions:   [],
    prepQuestions: [],
    scenarioText:  {},
  },
}

// ── Frozen conformance vector (spec-derived; used by the scoring test) ─────────

export type ConformanceCase = {
  label: string
  outcome: Outcome | null
  expectedChris: number
  expectedKelly: number
}

// Defaults: reservation_price_chris = 25_000, reservation_price_kelly = 475_000.
export const CONFORMANCE_VECTOR: ConformanceCase[] = [
  { label: 'Mid deal $287,500',        outcome: { price: 287_500 }, expectedChris: 262_500, expectedKelly: 187_500 },
  { label: 'Chris-favorable $475,000', outcome: { price: 475_000 }, expectedChris: 450_000, expectedKelly: 0 },
  { label: 'Kelly-favorable $25,000',  outcome: { price: 25_000 },  expectedChris: 0,       expectedKelly: 450_000 },
  { label: 'Walk-away (no deal)',      outcome: null,               expectedChris: 0,       expectedKelly: 0 },
]
