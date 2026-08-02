/* eslint-disable */
'use strict'
// GRAYS 2.0 — getReportData chart-inputs (grays.com report parity).
// Seeds 3 groups (2 deals + 1 walk-away) with prep numbers + a TEXT debrief opening-offer
// (in varied formats), then asserts getReportData returns:
//   • groups[]  with final_price + group_initial_price = avg of members' PARSED offers
//   • participants[] with role + prep_planned_first_offer + prep_estimated_other_price + reflection
//
// Run (emulator up):  node test/reportChartsIntegration.cjs

const PROJECT = 'grays2-mygames-live'
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8092'
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9012'
const admin = require('firebase-admin')
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://localhost:9012?ns=${PROJECT}-default-rtdb` })
const db = admin.firestore()
const { Timestamp } = require('firebase-admin/firestore')
const BASE = `http://localhost:5015/${PROJECT}/us-central1`

let passed = 0, failed = 0
const ok = (label, cond) => { if (cond) { console.log(`  [PASS] ${label}`); passed++ } else { console.log(`  [FAIL] ${label}`); failed++ } }

async function call(path, body) {
  const r = await fetch(`${BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }) })
  const j = await r.json()
  return j.result ?? (j.error ? { ok: false, error: j.error.message } : j)
}

async function main() {
  console.log('\n═══ GRAYS 2.0 getReportData chart inputs ═══')
  const gid = `charts_${Date.now()}`
  const inst = db.collection('game_instances').doc(gid)
  const now = Timestamp.now()
  await inst.collection('config').doc('main').set({ reservation_price_chris: 25000, reservation_price_kelly: 475000 })

  const groups = [
    { id: 'g1', price: 275000, agreement: true },
    { id: 'g2', price: 150000, agreement: true },
    { id: 'g3', price: null,   agreement: false },
  ]
  // debrief offers in varied TEXT formats to exercise the parser.
  const parts = [
    { id: 'c1', role: 'chris', g: 'g1', offer: '$300,000', est: 150000, first: 250000, refl: 'Went higher than I planned.' },
    { id: 'k1', role: 'kelly', g: 'g1', offer: '250000',   est: 100000, first: 120000, refl: 'Chris opened aggressively.' },
    { id: 'c2', role: 'chris', g: 'g2', offer: '200k',     est: 175000, first: 300000, refl: 'Closed fast.' },
    { id: 'k2', role: 'kelly', g: 'g2', offer: '100000',   est: 90000,  first: 110000, refl: 'Happy with the price.' },
    { id: 'c3', role: 'chris', g: 'g3', offer: 'no idea',  est: 200000, first: 400000, refl: 'No deal.' },   // unparseable → dropped
    { id: 'k3', role: 'kelly', g: 'g3', offer: '',         est: 80000,  first: 100000, refl: 'Walked away.' },
  ]
  const b = db.batch()
  for (const g of groups) {
    const cs = parts.filter(p => p.g === g.id && p.role === 'chris').map(p => p.id)
    const ks = parts.filter(p => p.g === g.id && p.role === 'kelly').map(p => p.id)
    b.set(inst.collection('groups').doc(g.id), {
      group_id: g.id, game_instance_id: gid, chris_participants: cs, kelly_participants: ks,
      lead_participant_id: cs[0], status: 'completed',
      outcome: g.agreement ? { price: g.price } : null, agreement_reached: g.agreement, matched_at: now,
    })
  }
  for (const p of parts) {
    b.set(inst.collection('participants').doc(p.id), {
      participant_id: p.id, game_instance_id: gid, role: p.role, group_id: p.g,
      display_name: `${p.role} ${p.id}`, knowledge_check_score: 1.0, finalized_at: now, raw_score: 1,
      prep_estimated_other_price: p.est, prep_planned_first_offer: p.first,
      debrief_initial_offer: p.offer, debrief_reflection: p.refl,
    })
  }
  await b.commit()

  const r = await call('getReportData', { _dev: { game_instance_id: gid } })
  ok('getReportData ok', r.ok === true)
  ok('returns groups[] (3) + participants[] (6)', Array.isArray(r.groups) && r.groups.length === 3 && Array.isArray(r.participants) && r.participants.length === 6)

  const gById = Object.fromEntries(r.groups.map(g => [g.group_id, g]))
  ok('g1 final_price 275000', gById.g1.final_price === 275000)
  ok('g1 group_initial_price = avg($300,000, 250000) = 275000', gById.g1.group_initial_price === 275000)
  ok('g2 group_initial_price = avg(200k, 100000) = 150000', gById.g2.group_initial_price === 150000)
  ok('g3 walk-away: final_price null, no parseable offers → group_initial_price null',
    gById.g3.final_price === null && gById.g3.group_initial_price === null)
  ok('g3 agreement_reached false', gById.g3.agreement_reached === false)

  const pById = Object.fromEntries(r.participants.map(p => [p.participant_id, p]))
  ok('c1 role chris + prep numbers surfaced', pById.c1.role === 'chris' && pById.c1.prep_planned_first_offer === 250000 && pById.c1.prep_estimated_other_price === 150000)
  ok('k2 role kelly + reflection surfaced', pById.k2.role === 'kelly' && pById.k2.debrief_reflection === 'Happy with the price.')

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
