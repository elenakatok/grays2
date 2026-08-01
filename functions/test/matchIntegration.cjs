/* eslint-disable */
'use strict'

// GRAYS 2.0 — emulator play-through.
// Exercises the winemaster-identical wiring end-to-end against the emulator:
//   matching (1C+1K forms a valid group — the {chris:1,kelly:1} composition),
//   REMATCH (clear + re-run → students re-paired),
//   outcome (lead reports → counterparty confirms → group completes),
//   finalize + push (scoreAndRecord).
//
// Run (from functions/) with the emulator up:
//   node test/matchIntegration.cjs

const PROJECT = 'grays2-mygames-live'
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8092'
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9012'

const admin = require('firebase-admin')
admin.initializeApp({
  projectId: PROJECT,
  databaseURL: `http://localhost:9012?ns=${PROJECT}`,
})
const db = admin.firestore()

const BASE = `http://localhost:5015/${PROJECT}/us-central1`

let passed = 0, failed = 0
const ok = (label, cond) => {
  if (cond) { console.log(`  [PASS] ${label}`); passed++ }
  else      { console.log(`  [FAIL] ${label}`); failed++ }
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: body }),
  })
  const json = await r.json()
  if (json.result !== undefined) return json.result
  if (json.error !== undefined) {
    const errMsg = typeof json.error === 'string' ? json.error : (json.error.message ?? JSON.stringify(json.error))
    return { ok: false, error: errMsg }
  }
  return json // onRequest (seed*) returns flat JSON
}

function makeParticipants(nC, nK) {
  const ps = []
  for (let i = 0; i < nC; i++) ps.push({ id: `c${i + 1}`, role: 'chris' })
  for (let i = 0; i < nK; i++) ps.push({ id: `k${i + 1}`, role: 'kelly' })
  return ps
}

async function readGroupsAndParticipants(gameId) {
  const [groupsSnap, psSnap] = await Promise.all([
    db.collection('game_instances').doc(gameId).collection('groups').get(),
    db.collection('game_instances').doc(gameId).collection('participants').get(),
  ])
  return { groups: groupsSnap.docs.map(d => d.data()), participants: psSnap.docs.map(d => d.data()) }
}

// Winemaster-identical matching contract (perRoleCap omitted → "place every extra"):
//   - group count = min(nC, nK) after dividing each role pool by its per-group count (1).
//   - every seeded participant lands in exactly one group; no one is dropped.
//   - each group has ≥1 chris and ≥1 kelly; extras of the majority role are distributed
//     into existing groups (a lopsided group is legal — the no-cap design).
//   - the lead of every group is one of that group's chris; outcome null; status matched.
function verifyMatch(label, gameId, nC, nK, expectGroups, groups, participants) {
  const errors = []
  const allPids = [
    ...Array.from({ length: nC }, (_, i) => `c${i + 1}`),
    ...Array.from({ length: nK }, (_, i) => `k${i + 1}`),
  ]
  const pidToGroup = {}
  let totalChris = 0, totalKelly = 0
  for (const g of groups) {
    const cs = g.chris_participants || [], ks = g.kelly_participants || []
    totalChris += cs.length; totalKelly += ks.length
    for (const pid of [...cs, ...ks]) {
      if (pidToGroup[pid]) errors.push(`${pid} appears in multiple groups`)
      pidToGroup[pid] = g.group_id
    }
    if (cs.length < 1) errors.push(`Group ${g.group_id} has no chris`)
    if (ks.length < 1) errors.push(`Group ${g.group_id} has no kelly`)
    if (!cs.includes(g.lead_participant_id)) errors.push(`Group ${g.group_id} lead is not a chris`)
    if (g.outcome !== null) errors.push(`Group ${g.group_id} outcome !== null`)
    if (g.status !== 'matched') errors.push(`Group ${g.group_id} status !== matched`)
  }
  for (const pid of allPids) if (!pidToGroup[pid]) errors.push(`${pid} not placed in any group`)
  if (totalChris !== nC) errors.push(`chris total ${totalChris} !== ${nC} (someone dropped)`)
  if (totalKelly !== nK) errors.push(`kelly total ${totalKelly} !== ${nK} (someone dropped)`)
  if (groups.length !== expectGroups) errors.push(`expected ${expectGroups} group(s), got ${groups.length}`)
  // is_lead is set on a chris and never on a kelly.
  for (const p of participants) {
    if (p.group_id && p.role === 'kelly' && p.is_lead === true) errors.push(`kelly ${p.participant_id} marked lead`)
  }
  const status = errors.length === 0 ? 'PASS' : 'FAIL'
  console.log(`  [${status}] ${label}: ${nC}C+${nK}K → ${groups.length} group(s)`)
  errors.forEach(e => console.log(`         ✗ ${e}`))
  if (errors.length === 0) passed++; else failed++
  return errors.length === 0
}

async function matchCase(label, nC, nK, expectGroups) {
  const gameId = `m_${label}_${Date.now()}`
  const seed = await post('/seedMatchTest', { game_instance_id: gameId, participants: makeParticipants(nC, nK) })
  if (!seed.ok) { console.log(`  [FAIL] ${label}: seed failed`, seed); failed++; return }
  const trig = await post('/triggerMatching', { _dev: { game_instance_id: gameId } })
  if (!trig.ok) { console.log(`  [FAIL] ${label}: triggerMatching failed`, trig); failed++; return }
  const { groups, participants } = await readGroupsAndParticipants(gameId)
  verifyMatch(label, gameId, nC, nK, expectGroups, groups, participants)
}

async function errorCase(label, nC, nK) {
  const gameId = `err_${label}_${Date.now()}`
  await post('/seedMatchTest', { game_instance_id: gameId, participants: makeParticipants(nC, nK) })
  const r = await post('/triggerMatching', { _dev: { game_instance_id: gameId } })
  ok(`${label}: ${nC}C+${nK}K → rejected (${r.ok === false ? r.error : 'UNEXPECTED OK'})`, r.ok === false)
}

async function rematchCase() {
  console.log('\n── REMATCH (re-run matching → students re-paired) ──')
  const gameId = `rematch_${Date.now()}`
  await post('/seedMatchTest', { game_instance_id: gameId, participants: makeParticipants(1, 1) })

  const t1 = await post('/triggerMatching', { _dev: { game_instance_id: gameId } })
  ok('initial match ok', t1.ok === true)
  const first = await readGroupsAndParticipants(gameId)
  const firstGid = first.groups[0]?.group_id
  ok('1C+1K → one group, chris lead', first.groups.length === 1 && first.groups[0].chris_participants[0] === first.groups[0].lead_participant_id)

  // Re-running as-is is idempotent (winemaster-identical): same group, no duplicate.
  const t2 = await post('/triggerMatching', { _dev: { game_instance_id: gameId } })
  ok('re-run is idempotent (alreadyMatched)', t2.ok === true && t2.alreadyMatched === true)
  const afterIdem = await readGroupsAndParticipants(gameId)
  ok('idempotent re-run left the single group intact', afterIdem.groups.length === 1 && afterIdem.groups[0].group_id === firstGid)

  // REMATCH proper: instructor clears groups + resets assignment, then re-runs → re-paired.
  const instanceRef = db.collection('game_instances').doc(gameId)
  const gs = await instanceRef.collection('groups').get()
  const ps = await instanceRef.collection('participants').get()
  const clr = db.batch()
  gs.docs.forEach(d => clr.delete(d.ref))
  ps.docs.forEach(d => clr.update(d.ref, { group_id: admin.firestore.FieldValue.delete(), is_lead: admin.firestore.FieldValue.delete() }))
  await clr.commit()

  const t3 = await post('/triggerMatching', { _dev: { game_instance_id: gameId } })
  ok('rematch ok after clear', t3.ok === true && t3.alreadyMatched !== true)
  const second = await readGroupsAndParticipants(gameId)
  const bothPaired = second.groups.length === 1 &&
    second.groups[0].chris_participants[0] === 'c1' &&
    second.groups[0].kelly_participants[0] === 'k1'
  ok('same two students re-paired into a fresh group', bothPaired && second.groups[0].group_id !== firstGid)
}

async function outcomeCase() {
  console.log('\n── OUTCOME → FINALIZE + PUSH ──')
  const gameId = `outcome_${Date.now()}`
  const C1 = 'c1', K1 = 'k1'
  await post('/seedGroupForTest', {
    game_instance_id: gameId, group_id: 'grp1', lead_id: C1,
    chris_participants: [C1], kelly_participants: [K1],
  })

  // Lead (chris) reports a deal.
  const lead = await post('/submitLeadOutcome', {
    _test: { participant_id: C1, game_instance_id: gameId },
    outcome: { price: 150_000, notes: 'stub deal' },
  })
  ok('lead (chris) submits outcome', lead.ok === true)
  let g = (await db.collection('game_instances').doc(gameId).collection('groups').doc('grp1').get()).data()
  ok('group → reporting', g.status === 'reporting')

  // Counterparty (kelly) confirms → group completes.
  const conf = await post('/submitConfirmation', {
    _test: { participant_id: K1, game_instance_id: gameId },
    confirmed: true,
  })
  ok('counterparty (kelly) confirms', conf.ok === true)
  g = (await db.collection('game_instances').doc(gameId).collection('groups').doc('grp1').get()).data()
  ok('group → completed', g.status === 'completed')

  // Finalize + push (scoreAndRecord — no precondition, always re-runnable).
  const score = await post('/scoreAndRecord', { _dev: { game_instance_id: gameId } })
  ok('scoreAndRecord ok', score.ok === true)
  ok('scored both participants', score.scored === 2)

  // Verify per-role stub scoring landed (chris surplus 50k, kelly surplus 50k; z=0 each single-member pool).
  const cDoc = (await db.collection('game_instances').doc(gameId).collection('participants').doc(C1).get()).data()
  const kDoc = (await db.collection('game_instances').doc(gameId).collection('participants').doc(K1).get()).data()
  ok('chris raw_score = price − reservation (50k)', cDoc.raw_score === 50_000)
  ok('kelly raw_score = reservation − price (50k)', kDoc.raw_score === 50_000)
  ok('both finalized', cDoc.finalized_at != null && kDoc.finalized_at != null)
  console.log(`         push summary: ${JSON.stringify(score.push)} (classroom emulator not required for scoring)`)
}

async function main() {
  console.log('\n═══ GRAYS 2.0 emulator play-through ═══')
  console.log('\n── Matching (composition {chris:1, kelly:1}) ──')
  await matchCase('1C+1K', 1, 1, 1)   // the grays difference: 1+1 is a valid group
  await matchCase('2C+2K', 2, 2, 2)
  await matchCase('3C+3K', 3, 3, 3)
  await matchCase('3C+2K', 3, 2, 2)   // limited by kelly
  await matchCase('2C+3K', 2, 3, 2)   // limited by chris
  console.log('\n── Error cases (missing a role) ──')
  await errorCase('1C+0K', 1, 0)
  await errorCase('0C+1K', 0, 1)
  await rematchCase()
  await outcomeCase()

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
