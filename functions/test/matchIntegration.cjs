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

// ── The 2026-10-05 matching fixes (game-server v0.30.0) ─────────────────────────
// The live class: 5 Chris + 5 Kelly all entered the code, one Kelly's phone was
// mid-reload at the click, and the class matched as 4 pairs + a group of three.
async function matchingFixesCase() {
  const rtdb = admin.database()
  const inst = (gameId) => db.collection('game_instances').doc(gameId)
  const counts = (groups) => groups.map(g => `${g.chris_participants.length}C+${g.kelly_participants.length}K`).sort().join(' ')

  console.log('\n── CODE = MATCHED (a confirmed student who is not connected is still matched) ──')
  const g1 = `fix_offline_${Date.now()}`
  await post('/seedMatchTest', { game_instance_id: g1, participants: makeParticipants(5, 5) })
  // k5's phone is mid-reload. The functions emulator writes RTDB under the
  // `<project>-default-rtdb` namespace, this script's default app under `<project>`.
  await rtdb.ref(`presence/${g1}/k5`).remove()
  const fnRtdb = admin.initializeApp({ projectId: PROJECT, databaseURL: `http://localhost:9012?ns=${PROJECT}-default-rtdb` }, 'fn-ns').database()
  await fnRtdb.ref(`presence/${g1}/k5`).remove()

  const pv = await post('/triggerMatching', { _dev: { game_instance_id: g1 }, preview: true })
  ok('preview ok and reports 10 confirmed (5 Chris, 5 Kelly)', pv.ok === true && pv.preview?.confirmed === 10 && pv.preview.by_role.chris === 5 && pv.preview.by_role.kelly === 5)
  ok('preview: 5 complete groups, no extras', pv.preview?.groups === 5 && pv.preview.extras_by_role.chris === 0 && pv.preview.extras_by_role.kelly === 0)
  ok('preview NAMES the not-connected student (k5)', pv.preview?.not_connected?.length === 1 && pv.preview.not_connected[0].participant_id === 'k5')
  let st = await readGroupsAndParticipants(g1)
  ok('preview wrote NOTHING (no groups, nobody assigned)', st.groups.length === 0 && st.participants.every(p => p.group_id == null))

  const t = await post('/triggerMatching', { _dev: { game_instance_id: g1 } })
  st = await readGroupsAndParticipants(g1)
  ok('match → FIVE clean pairs (was 4 pairs + a three)', t.ok === true && st.groups.length === 5 && counts(st.groups) === '1C+1K 1C+1K 1C+1K 1C+1K 1C+1K')
  ok('the not-connected student is in a group', st.participants.find(p => p.participant_id === 'k5')?.group_id != null)

  console.log('\n── RE-MATCH (flag; only until the first group starts) ──')
  const before = new Set(st.groups.map(g => g.group_id))
  const rpv = await post('/triggerMatching', { _dev: { game_instance_id: g1 }, rematch: true, preview: true })
  ok('re-match preview ok, still writes nothing', rpv.ok === true && rpv.preview?.groups === 5 &&
    (await readGroupsAndParticipants(g1)).groups.every(g => before.has(g.group_id)))
  const r1 = await post('/triggerMatching', { _dev: { game_instance_id: g1 }, rematch: true })
  st = await readGroupsAndParticipants(g1)
  ok('re-match → 5 NEW groups, old ones gone', r1.ok === true && st.groups.length === 5 && st.groups.every(g => !before.has(g.group_id)))
  const gids = new Set(st.groups.map(g => g.group_id))
  ok('every student points at a group that exists; exactly one lead per group',
    st.participants.every(p => gids.has(p.group_id)) && st.participants.filter(p => p.is_lead).length === 5)
  // one group starts → re-match is refused, nothing changes
  await inst(g1).collection('groups').doc(st.groups[0].group_id).update({ status: 'negotiating' })
  const r2 = await post('/triggerMatching', { _dev: { game_instance_id: g1 }, rematch: true })
  const after = await readGroupsAndParticipants(g1)
  ok(`re-match REFUSED once a group has started (${r2.ok === false ? r2.error : 'UNEXPECTED OK'})`, r2.ok === false)
  ok('refused re-match left the groups untouched', after.groups.length === 5 && after.groups.every(g => gids.has(g.group_id)))

  console.log('\n── RE-MATCH releases a student the new match cannot place ──')
  const g3 = `fix_release_${Date.now()}`
  await post('/seedMatchTest', { game_instance_id: g3, participants: makeParticipants(2, 2) })
  await post('/triggerMatching', { _dev: { game_instance_id: g3 } })
  // k2's code entry is withdrawn, so the re-match has 2 Chris + 1 Kelly to work with.
  await inst(g3).collection('participants').doc('k2').update({ attendance_confirmed_at: null })
  const r3 = await post('/triggerMatching', { _dev: { game_instance_id: g3 }, rematch: true })
  st = await readGroupsAndParticipants(g3)
  ok('re-match with one Kelly gone → one group 2C+1K', r3.ok === true && st.groups.length === 1 && counts(st.groups) === '2C+1K')
  ok('the unplaced student is released (group_id null), not left on a deleted group', st.participants.find(p => p.participant_id === 'k2')?.group_id == null)

  console.log('\n── LATE STUDENT pairs with the SPARE (code entered after matching) ──')
  const g2 = `fix_late_${Date.now()}`
  // 5 Chris + 4 Kelly entered the code; the 5th Kelly (k5) is in the room but has not.
  await post('/seedMatchTest', { game_instance_id: g2, participants: makeParticipants(5, 5) })
  await inst(g2).collection('participants').doc('k5').update({ attendance_confirmed_at: admin.firestore.FieldValue.delete() })
  await inst(g2).collection('attendance_code').doc('current').set({ code: 'ABCDE' })
  const m = await post('/triggerMatching', { _dev: { game_instance_id: g2 } })
  st = await readGroupsAndParticipants(g2)
  ok('5C+4K → 4 groups, one of them 2C+1K', m.ok === true && st.groups.length === 4 && counts(st.groups) === '1C+1K 1C+1K 1C+1K 2C+1K')
  const three = st.groups.find(g => g.chris_participants.length === 2)
  const spare = three.chris_participants.find(id => id !== three.lead_participant_id)

  const v = await post('/verifyAttendanceCode', { _test: { participant_id: 'k5', game_instance_id: g2 }, code: 'ABCDE' })
  st = await readGroupsAndParticipants(g2)
  ok('late Kelly enters the code', v.ok === true)
  ok('→ FIVE clean pairs; the group of three is a pair again', st.groups.length === 5 && counts(st.groups) === '1C+1K 1C+1K 1C+1K 1C+1K 1C+1K')
  const k5 = st.participants.find(p => p.participant_id === 'k5')
  const sp = st.participants.find(p => p.participant_id === spare)
  const ng = st.groups.find(g => g.group_id === k5.group_id)
  ok('the late Kelly and the spare Chris are in the SAME new group', k5.group_id != null && sp.group_id === k5.group_id && ng.chris_participants[0] === spare && ng.kelly_participants[0] === 'k5')
  ok('the spare Chris leads the new pair; new group is "matched"', ng.lead_participant_id === spare && sp.is_lead === true && k5.is_lead === false && ng.status === 'matched')
  const old = st.groups.find(g => g.group_id === three.group_id)
  ok('the old group kept its lead and its Kelly', old.lead_participant_id === three.lead_participant_id && old.kelly_participants.length === 1)

  console.log('\n── LATE STUDENT, but the group of three has already STARTED ──')
  const g4 = `fix_late_started_${Date.now()}`
  await post('/seedMatchTest', { game_instance_id: g4, participants: makeParticipants(3, 3) })
  await inst(g4).collection('participants').doc('k3').update({ attendance_confirmed_at: admin.firestore.FieldValue.delete() })
  await inst(g4).collection('attendance_code').doc('current').set({ code: 'ABCDE' })
  await post('/triggerMatching', { _dev: { game_instance_id: g4 } })
  st = await readGroupsAndParticipants(g4)
  const three4 = st.groups.find(g => g.chris_participants.length === 2)
  await inst(g4).collection('groups').doc(three4.group_id).update({ status: 'negotiating' })
  await post('/verifyAttendanceCode', { _test: { participant_id: 'k3', game_instance_id: g4 }, code: 'ABCDE' })
  st = await readGroupsAndParticipants(g4)
  const started = st.groups.find(g => g.group_id === three4.group_id)
  ok('the running group of three is untouched', started.chris_participants.length === 2 && started.kelly_participants.length === 1)
  ok('the late Kelly joins the other, not-started group (ordinary placement)', st.groups.length === 2 &&
    st.participants.find(p => p.participant_id === 'k3')?.group_id === st.groups.find(g => g.group_id !== three4.group_id).group_id)
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
    outcome: { price: 150_000 },
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
  // Real reservations: Chris 25k, Kelly 475k. price 150k → Chris 125k, Kelly 325k.
  ok('chris raw_score = price − 25k reservation (125k)', cDoc.raw_score === 125_000)
  ok('kelly raw_score = 475k reservation − price (325k)', kDoc.raw_score === 325_000)
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
  await matchingFixesCase()
  await outcomeCase()

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
