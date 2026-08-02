/* eslint-disable */
'use strict'

// GRAYS 2.0 — ONLINE MODE emulator integration.
// Exercises the negotiation online wiring end-to-end:
//   pre-grouping (roles assigned AT grouping: 1 Chris + 1 Kelly per pair, Chris lead),
//   move/ungroup (missing-role case + doubling-up allowed),
//   per-ROLE auto-open (both roles present opens; 2-Chris/0-Kelly NEVER opens),
//   lock-at-first-play (started group frozen for moves + flag stale),
//   flagGroup mailto facts, getOnlineReport.
//
// Run (from functions/, emulator up):  node test/onlineIntegration.cjs

const PROJECT = 'grays2-mygames-live'
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8092'
process.env.FIREBASE_DATABASE_EMULATOR_HOST = 'localhost:9012'

const admin = require('firebase-admin')
// RTDB reads (attendingOf) must target the SAME namespace the FUNCTIONS runtime writes to.
// The functions' admin.initializeApp() (no databaseURL) defaults to `<project>-default-rtdb`
// under the emulator — matching production, where there is one default database. The test
// admin must use that ns too, or it reads an empty sibling namespace.
admin.initializeApp({ projectId: PROJECT, databaseURL: `http://localhost:9012?ns=${PROJECT}-default-rtdb` })
const db = admin.firestore()
const BASE = `http://localhost:5015/${PROJECT}/us-central1`

let passed = 0, failed = 0
const ok = (label, cond) => { if (cond) { console.log(`  [PASS] ${label}`); passed++ } else { console.log(`  [FAIL] ${label}`); failed++ } }

async function call(path, body) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: body }),
  })
  const j = await r.json()
  if (j.result !== undefined) return j.result
  if (j.error !== undefined) return { ok: false, error: (j.error.message ?? JSON.stringify(j.error)) }
  return j
}
const dev = (gid, extra = {}) => ({ _dev: { game_instance_id: gid }, ...extra })
const stu = (pid, gid, extra = {}) => ({ _test: { participant_id: pid, game_instance_id: gid }, ...extra })

async function seedRoster(gid, people) {
  const inst = db.collection('game_instances').doc(gid)
  for (const col of ['participants', 'groups']) {
    const s = await inst.collection(col).get(); const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit()
  }
  await inst.collection('config').doc('main').set({ clock_mode: 'off', instructor_email: 'prof@example.edu' })
  const b = db.batch()
  for (const p of people) {
    b.set(inst.collection('participants').doc(p.id), {
      participant_id: p.id, game_instance_id: gid, is_bot: false,
      display_name: p.name, email: p.email, prep_status: 'complete',
    })
  }
  await b.commit()
}
const attendingOf = async (gid, pid) => (await admin.database().ref(`attending/${gid}/${pid}`).get()).val()
const group = async (gid, groupId) => (await db.collection('game_instances').doc(gid).collection('groups').doc(groupId).get()).data()
const groupsOf = async (gid) => (await db.collection('game_instances').doc(gid).collection('groups').get()).docs.map(d => ({ id: d.id, ...d.data() }))
const partOf = async (gid, pid) => (await db.collection('game_instances').doc(gid).collection('participants').doc(pid).get()).data()

// ── 1. Pre-grouping assigns roles at grouping ──────────────────────────────────
async function testPreGroup() {
  console.log('\n1. Pre-grouping → 1 Chris + 1 Kelly per pair (roles at grouping)')
  const gid = `og_pregroup_${Date.now()}`
  await seedRoster(gid, [
    { id: 'p1', name: 'Ann', email: 'ann@x.edu' }, { id: 'p2', name: 'Bo', email: 'bo@x.edu' },
    { id: 'p3', name: 'Cy', email: 'cy@x.edu' }, { id: 'p4', name: 'Di', email: 'di@x.edu' },
  ])
  const r = await call('groupParticipantsOnline', dev(gid))
  ok('grouped 4 → 2 pairs', r.ok === true && r.groups === 2 && r.full_pairs === 2)
  const gs = await groupsOf(gid)
  const everyPairValid = gs.every(g =>
    (g.chris_participants || []).length === 1 && (g.kelly_participants || []).length === 1 &&
    g.chris_participants[0] === g.lead_participant_id &&        // Chris leads
    Array.isArray(g.members) && g.members.length === 2 &&      // denormalised for the reveal
    Array.isArray(g.arrived) && g.arrived.length === 0 &&      // presence set initialised
    g.status === 'matched')
  ok('each pair: 1 Chris (lead) + 1 Kelly, members[] + arrived[] present', everyPairValid)
  const roleStamped = (await Promise.all(['p1','p2','p3','p4'].map(id => partOf(gid, id))))
    .every(p => (p.role === 'chris' || p.role === 'kelly') && p.role_assigned_at != null)
  ok('every participant stamped with a role at grouping', roleStamped)
  return gid
}

// ── 2. Per-ROLE auto-open (both present opens; single role does not) ───────────
async function testAutoOpen() {
  console.log('\n2. Auto-open on per-ROLE presence')
  const gid = `og_open_${Date.now()}`
  await seedRoster(gid, [{ id: 'a', name: 'A', email: 'a@x.edu' }, { id: 'b', name: 'B', email: 'b@x.edu' }])
  await call('groupParticipantsOnline', dev(gid))
  const [g] = await groupsOf(gid)
  const chris = g.chris_participants[0], kelly = g.kelly_participants[0]

  const r1 = await call('recordOnlineArrival', stu(chris, gid))
  ok('one role present → NOT opened', r1.ok === true && r1.opened === false && r1.status === 'matched')
  const r2 = await call('recordOnlineArrival', stu(kelly, gid))
  ok('both roles present → auto-opened (negotiating)', r2.ok === true && r2.opened === true && r2.status === 'negotiating')
  const gf = await group(gid, g.group_id)
  ok('group doc: status negotiating + negotiation_started_at set', gf.status === 'negotiating' && gf.negotiation_started_at != null)
}

// ── 3. 2-Chris / 0-Kelly can NEVER auto-open (per-role, not seat count) ────────
async function testDoubleChrisNeverOpens() {
  console.log('\n3. 2-Chris / 0-Kelly never opens (predicate is per-ROLE, not headcount)')
  const gid = `og_double_${Date.now()}`
  await seedRoster(gid, [
    { id: 'c1', name: 'C1', email: 'c1@x.edu' }, { id: 'k1', name: 'K1', email: 'k1@x.edu' },
    { id: 'c2', name: 'C2', email: 'c2@x.edu' }, { id: 'k2', name: 'K2', email: 'k2@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const gs = await groupsOf(gid)
  const g1 = gs[0], g2 = gs[1]
  const c1 = g1.chris_participants[0], k1 = g1.kelly_participants[0]
  const c2 = g2.chris_participants[0]

  // Ungroup Kelly from g1, then move g2's Chris into g1 → g1 = 2 Chris, 0 Kelly.
  await call('moveSeat', dev(gid, { participant_id: k1, target_group_id: '' }))
  const mv = await call('moveSeat', dev(gid, { participant_id: c2, target_group_id: g1.group_id }))
  ok('move a 2nd Chris in is allowed (doubling-up)', mv.ok === true && mv.moved === true)
  const g1b = await group(gid, g1.group_id)
  ok('g1 now holds 2 Chris + 0 Kelly', (g1b.chris_participants || []).length === 2 && (g1b.kelly_participants || []).length === 0)

  const ra = await call('recordOnlineArrival', stu(c1, gid))
  const rb = await call('recordOnlineArrival', stu(c2, gid))
  ok('both present but same role → NEVER opens', ra.opened === false && rb.opened === false)
  const g1c = await group(gid, g1.group_id)
  ok('g1 stays matched (idle, not started)', g1c.status === 'matched' && g1c.negotiation_started_at == null)
}

// ── 4. Doubling-up (2 Chris + 1 Kelly) is complete + startable ─────────────────
async function testDoublingUpStartable() {
  console.log('\n4. 2 Chris + 1 Kelly is complete (both roles) → startable')
  const gid = `og_dbl2_${Date.now()}`
  await seedRoster(gid, [
    { id: 'c1', name: 'C1', email: 'c1@x.edu' }, { id: 'k1', name: 'K1', email: 'k1@x.edu' },
    { id: 'c2', name: 'C2', email: 'c2@x.edu' }, { id: 'k2', name: 'K2', email: 'k2@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const gs = await groupsOf(gid)
  const g1 = gs[0], g2 = gs[1]
  const c1 = g1.chris_participants[0], k1 = g1.kelly_participants[0], c2 = g2.chris_participants[0]
  await call('moveSeat', dev(gid, { participant_id: c2, target_group_id: g1.group_id }))  // g1 = 2C+1K
  const g1b = await group(gid, g1.group_id)
  ok('g1 = 2 Chris + 1 Kelly (both roles present)', (g1b.chris_participants||[]).length === 2 && (g1b.kelly_participants||[]).length === 1)
  await call('recordOnlineArrival', stu(c1, gid))
  const r = await call('recordOnlineArrival', stu(k1, gid))
  ok('opens on per-role presence despite doubling-up', r.opened === true && r.status === 'negotiating')
}

// ── 5. Merge a half-pair: move Kelly into a Chris-only group → completes it ─────
async function testMergeCompletes() {
  console.log('\n5. Missing-role merge: move a Kelly into a Chris-only group → complete')
  const gid = `og_merge_${Date.now()}`
  await seedRoster(gid, [
    { id: 'c1', name: 'C1', email: 'c1@x.edu' }, { id: 'k1', name: 'K1', email: 'k1@x.edu' },
    { id: 'c2', name: 'C2', email: 'c2@x.edu' }, { id: 'k2', name: 'K2', email: 'k2@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const gs = await groupsOf(gid)
  const g1 = gs[0], g2 = gs[1]
  const k1 = g1.kelly_participants[0], c2 = g2.chris_participants[0], k2 = g2.kelly_participants[0]
  // Break g2 down to Chris-only, then move g1's Kelly into it → g2 = 1C + 1K (valid).
  await call('moveSeat', dev(gid, { participant_id: k2, target_group_id: '' }))
  const g2mid = await group(gid, g2.group_id)
  ok('g2 is Chris-only after ungrouping its Kelly (missing-role → badge)', (g2mid.kelly_participants||[]).length === 0 && (g2mid.chris_participants||[]).length === 1)
  await call('moveSeat', dev(gid, { participant_id: k1, target_group_id: g2.group_id }))
  const g2b = await group(gid, g2.group_id)
  ok('g2 now complete: 1 Chris + 1 Kelly', (g2b.chris_participants||[]).length === 1 && (g2b.kelly_participants||[]).length === 1)
}

// ── 6. Lock at first play: started group frozen + flag stale ───────────────────
async function testLockAndFlag() {
  console.log('\n6. Lock-at-first-play + flag')
  const gid = `og_lock_${Date.now()}`
  await seedRoster(gid, [
    { id: 'c1', name: 'C1', email: 'c1@x.edu' }, { id: 'k1', name: 'K1', email: 'k1@x.edu' },
    { id: 'c2', name: 'C2', email: 'c2@x.edu' }, { id: 'k2', name: 'K2', email: 'k2@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const gs = await groupsOf(gid)
  const g1 = gs[0], g2 = gs[1]
  const c1 = g1.chris_participants[0], k1 = g1.kelly_participants[0]

  // Flag BEFORE start (only c1 present) — passive flag written, mailto facts returned.
  await call('recordOnlineArrival', stu(c1, gid))
  const flag = await call('flagGroup', stu(c1, gid))
  ok('flag returns group number + instructor email', flag.ok === true && flag.group_number >= 1 && flag.instructor_email === 'prof@example.edu')
  const g1flagged = await group(gid, g1.group_id)
  ok('passive flag written to the group doc', g1flagged.flag != null && g1flagged.flag.reported_by === c1)
  const flag2 = await call('flagGroup', stu(k1, gid))
  ok('flag is idempotent (first stands)', flag2.already_flagged === true)

  // Open g1 (both present) → started.
  await call('recordOnlineArrival', stu(k1, gid))
  const g1open = await group(gid, g1.group_id)
  ok('g1 started (negotiating)', g1open.status === 'negotiating')

  // Now moves in/out of g1 are refused (per-group lock).
  const c2 = g2.chris_participants[0]
  const badMove = await call('moveSeat', dev(gid, { participant_id: c2, target_group_id: g1.group_id }))
  ok('move INTO a started group is refused', badMove.ok === false)
  const badOut = await call('moveSeat', dev(gid, { participant_id: c1, target_group_id: '' }))
  ok('move OUT of a started group is refused', badOut.ok === false)

  // A new flag on the started group is refused; the report marks the old one stale.
  const flag3 = await call('flagGroup', stu(c1, gid))
  ok('flag on a started group is refused (stale)', flag3.ok === false)
}

// ── 7. Assignment-status report ────────────────────────────────────────────────
async function testReport() {
  console.log('\n7. getOnlineReport')
  const gid = `og_report_${Date.now()}`
  await seedRoster(gid, [
    { id: 'c1', name: 'C1', email: 'c1@x.edu' }, { id: 'k1', name: 'K1', email: 'k1@x.edu' },
    { id: 'c2', name: 'C2', email: 'c2@x.edu' }, { id: 'k2', name: 'K2', email: 'k2@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const gs = await groupsOf(gid)
  await call('recordOnlineArrival', stu(gs[0].chris_participants[0], gid))
  const rep = await call('getOnlineReport', dev(gid))
  ok('report ok + arrival data present', rep.ok === true && rep.arrival_data_present === true)
  ok('report lists 2 groups + 4 students', rep.groups.length === 2 && rep.students.length === 4)
  ok('one student marked arrived, others not', rep.students.filter(s => s.arrived === true).length === 1)
}

// ── 8. Name overlay: online grouping seeds RTDB `attending` (fixes partner-shows-id) ──
// In online mode the classroom attendance step never runs, yet the shared group-member
// panel resolves names ONLY from RTDB `attending`. Grouping + arrival must seed it, or a
// partner shows as a raw participant-id code.
async function testAttendingOverlay() {
  console.log('\n8. RTDB `attending` name overlay (online partner shows a real name, not an id)')
  const gid = `og_attend_${Date.now()}`
  await seedRoster(gid, [
    { id: 'p1', name: 'Ann Adams', email: 'ann@x.edu' }, { id: 'p2', name: 'Bo Baker', email: 'bo@x.edu' },
  ])
  await call('groupParticipantsOnline', dev(gid))
  const [a1, a2] = await Promise.all([attendingOf(gid, 'p1'), attendingOf(gid, 'p2')])
  ok('grouping seeds attending[p1].display_name = "Ann Adams"', a1 && a1.display_name === 'Ann Adams')
  ok('grouping seeds attending[p2].display_name = "Bo Baker"', a2 && a2.display_name === 'Bo Baker')
  // Arrival re-hydrates the overlay for BOTH members (mirrors members[]).
  const [g] = await groupsOf(gid)
  const chris = g.chris_participants[0]
  await call('recordOnlineArrival', stu(chris, gid))
  const after = await attendingOf(gid, chris)
  ok('arrival keeps a real display_name (never the participant-id)',
    after && typeof after.display_name === 'string' && after.display_name !== chris && after.display_name.length > 0)
}

async function main() {
  console.log('\n═══ GRAYS 2.0 ONLINE-MODE integration ═══')
  await testPreGroup()
  await testAutoOpen()
  await testDoubleChrisNeverOpens()
  await testDoublingUpStartable()
  await testMergeCompletes()
  await testLockAndFlag()
  await testReport()
  await testAttendingOverlay()
  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
