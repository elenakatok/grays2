/* eslint-disable */
'use strict'
// GRAYS 2.0 — scoring + push-details verification (spec §4 normalization, §5 details).
// Seeds 2 groups (a deal + a deal, plus a walk-away group) with prep/debrief answers,
// runs scoreAndRecord, and checks: config-driven raw scores, per-role z-normalization,
// walk-away in-pool (raw 0), and the exact §5 `details` block on each participant.
//
// Run (emulator up): node test/scoringDetails.cjs

const PROJECT = 'grays2-mygames-live'
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8092'
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9012'
const admin = require('firebase-admin')
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://localhost:9012?ns=${PROJECT}` })
const db = admin.firestore()
const BASE = `http://localhost:5015/${PROJECT}/us-central1`
const { Timestamp } = require('firebase-admin/firestore')

let passed = 0, failed = 0
const ok = (label, cond) => { if (cond) { console.log(`  [PASS] ${label}`); passed++ } else { console.log(`  [FAIL] ${label}`); failed++ } }
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

async function call(path, body) {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }) })
  const j = await r.json()
  return j.result ?? (j.error ? { ok: false, error: j.error.message } : j)
}

async function main() {
  console.log('\n═══ GRAYS 2.0 scoring + §5 details ═══')
  const gid = `score_${Date.now()}`
  const inst = db.collection('game_instances').doc(gid)
  const now = Timestamp.now()

  // Config: explicit reservations (proves config-driven).
  await inst.collection('config').doc('main').set({ reservation_price_chris: 25000, reservation_price_kelly: 475000 })

  // Two deal groups (for a per-role pool of 2) + one walk-away group.
  const groups = [
    { id: 'g1', price: 287500, agreement: true },
    { id: 'g2', price: 100000, agreement: true },
    { id: 'g3', price: null,   agreement: false },
  ]
  const parts = [
    { id: 'c1', role: 'chris', g: 'g1', lead: true,  name: 'Chris One',  debrief: 'Kelly opened at 200k', est: 150000, offer: 250000 },
    { id: 'k1', role: 'kelly', g: 'g1', lead: false, name: 'Kelly One',  debrief: 'I opened at 200k',     est: 100000, offer: 120000 },
    { id: 'c2', role: 'chris', g: 'g2', lead: true,  name: 'Chris Two',  debrief: 'I opened at 300k',     est: 175000, offer: 300000 },
    { id: 'k2', role: 'kelly', g: 'g2', lead: false, name: 'Kelly Two',  debrief: 'Chris opened at 300k', est: 90000,  offer: 110000 },
    { id: 'c3', role: 'chris', g: 'g3', lead: true,  name: 'Chris Wa',   debrief: 'No offers agreed',     est: 200000, offer: 400000 },
    { id: 'k3', role: 'kelly', g: 'g3', lead: false, name: 'Kelly Wa',   debrief: 'No deal',              est: 80000,  offer: 100000 },
  ]
  const gb = db.batch()
  for (const g of groups) {
    const cs = parts.filter(p => p.g === g.id && p.role === 'chris').map(p => p.id)
    const ks = parts.filter(p => p.g === g.id && p.role === 'kelly').map(p => p.id)
    gb.set(inst.collection('groups').doc(g.id), {
      group_id: g.id, game_instance_id: gid, chris_participants: cs, kelly_participants: ks,
      lead_participant_id: cs[0], status: g.agreement ? 'completed' : 'completed',
      outcome: g.agreement ? { price: g.price } : null, agreement_reached: g.agreement, matched_at: now,
    })
  }
  for (const p of parts) {
    gb.set(inst.collection('participants').doc(p.id), {
      participant_id: p.id, game_instance_id: gid, role: p.role, group_id: p.g, is_lead: p.lead,
      display_name: p.name, knowledge_check_score: 1.0, attendance_confirmed_at: now,
      debrief_first_price: p.debrief, prep_estimated_other_price: p.est, prep_planned_first_offer: p.offer,
    })
  }
  await gb.commit()

  const score = await call('scoreAndRecord', { _dev: { game_instance_id: gid } })
  ok('scoreAndRecord ok, scored 6', score.ok === true && score.scored === 6)

  const read = async id => (await inst.collection('participants').doc(id).get()).data()
  const [c1, k1, c2, k2, c3, k3] = await Promise.all(['c1','k1','c2','k2','c3','k3'].map(read))

  // ── raw scores (config-driven) ──
  ok('c1 raw = 287500−25000 = 262500', c1.raw_score === 262500)
  ok('k1 raw = 475000−287500 = 187500', k1.raw_score === 187500)
  ok('c2 raw = 100000−25000 = 75000',  c2.raw_score === 75000)
  ok('k2 raw = 475000−100000 = 375000', k2.raw_score === 375000)
  ok('c3 walk-away raw = 0 (in pool)', c3.raw_score === 0)
  ok('k3 walk-away raw = 0 (in pool)', k3.raw_score === 0)

  // ── per-role z-normalization (pool = the 3 of each role: 262500,75000,0 for chris) ──
  // mean_chris = 112500; sample sd over {262500,75000,0}. z should be finite + centered.
  const zc = [c1, c2, c3].map(p => p.normalized_score)
  const zk = [k1, k2, k3].map(p => p.normalized_score)
  ok('chris z-scores centre ≈ 0 (per-role pool)', near(zc.reduce((a,b)=>a+b,0), 0, 0.001))
  ok('kelly z-scores centre ≈ 0 (per-role pool)', near(zk.reduce((a,b)=>a+b,0), 0, 0.001))
  ok('highest chris surplus → highest chris z (c1 > c3)', c1.normalized_score > c3.normalized_score)
  ok('highest kelly surplus → highest kelly z (k2 > k1)', k2.normalized_score > k1.normalized_score)

  // ── §5 details block (field-for-field) ──
  const d = c1.details
  const keys = ['display_name','agreement_reached','final_price','surplus','debrief_initial_price','group_id','group_composition','is_lead','prep_estimated_other_price','prep_planned_first_offer']
  ok('details has all 10 §5 fields', keys.every(k => k in d))
  ok('details.display_name = "Chris One"', d.display_name === 'Chris One')
  ok('details.agreement_reached = true', d.agreement_reached === true)
  ok('details.final_price = 287500', d.final_price === 287500)
  ok('details.surplus = raw (262500)', d.surplus === 262500)
  ok('details.debrief_initial_price = the debrief text', d.debrief_initial_price === 'Kelly opened at 200k')
  ok('details.group_composition = "1C+1K"', d.group_composition === '1C+1K')
  ok('details.is_lead = true', d.is_lead === true)
  ok('details.prep_estimated_other_price = 150000', d.prep_estimated_other_price === 150000)
  ok('details.prep_planned_first_offer = 250000', d.prep_planned_first_offer === 250000)
  const dw = c3.details
  ok('walk-away details: agreement_reached false, final_price null, surplus 0', dw.agreement_reached === false && dw.final_price === null && dw.surplus === 0)

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
