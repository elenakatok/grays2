/* eslint-disable */
'use strict'

// GRAYS 2.0 — what a STUDENT may write, under the REAL firestore.rules.
//
// Why this exists (2026-10-05, the first live class): the numeric debrief question
// saved to `debrief_initial_offer`, a field name sitting in the rules' protected list
// (inherited from grays-com). The shared Results screen writes the whole debrief in ONE
// update, so every student who filled in the number had the ENTIRE debrief refused with
// "Missing or insufficient permissions". Every earlier check had written its data with
// the Admin SDK — which BYPASSES rules — so nothing caught it before a class did.
//
// So this suite signs in AS A STUDENT with the client SDK and does exactly what the
// student's page does. It is driven by the game definition: every question a student
// answers by direct write (preparation + debrief; knowledge-check answers go through a
// callable) must be writable, so a future question whose field name collides with a
// protected one fails HERE.
//
// Run (from games/grays2, after `npm run build` in functions/):
//   firebase emulators:exec --only firestore,auth --project grays2-mygames-live \
//     "node functions/test/studentWritesRules.cjs"

const PROJECT = 'grays2-mygames-live'
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8092'
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9111'

const path = require('path')
const admin = require('firebase-admin')
// The CLIENT SDK — the one the student's page uses — lives with the frontend.
const clientSdk = (m) => require(path.join(__dirname, '../../frontend/node_modules/firebase', m))
const { initializeApp } = clientSdk('app')
const { getAuth, connectAuthEmulator, signInWithCustomToken } = clientSdk('auth')
const { getFirestore, connectFirestoreEmulator, doc, updateDoc, getDoc, serverTimestamp } = clientSdk('firestore')
const { graysGameDef } = require('../lib/gameDefinition.js')

admin.initializeApp({ projectId: PROJECT })
const adminDb = admin.firestore()

let passed = 0, failed = 0
const ok = (label, cond, extra) => {
  if (cond) { console.log(`  [PASS] ${label}`); passed++ }
  else      { console.log(`  [FAIL] ${label}${extra ? ` — ${extra}` : ''}`); failed++ }
}

const GID = `rules_${Date.now()}`
const ME = 'stu_me', OTHER = 'stu_other'
const pPath = (pid) => `game_instances/${GID}/participants/${pid}`

// Questions the student's page saves by a direct Firestore write.
const studentWritten = (graysGameDef.prepDefaults ?? [])
  .filter(q => q.category === 'preparation' || q.category === 'debrief')
const sampleAnswer = (q) => (q.type === 'number' ? '150000' : 'An answer.')

async function main() {
  console.log('\n═══ GRAYS 2.0 student writes under firestore.rules ═══')

  const seed = { game_instance_id: GID, role: 'chris', group_id: 'g1', is_lead: true, raw_score: 5, normalized_score: 0, prep_status: 'in_progress' }
  await adminDb.doc(pPath(ME)).set({ participant_id: ME, ...seed })
  await adminDb.doc(pPath(OTHER)).set({ participant_id: OTHER, ...seed })

  const app = initializeApp({ projectId: PROJECT, apiKey: 'emulator' })
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://localhost:9111', { disableWarnings: true })
  const db = getFirestore(app); connectFirestoreEmulator(db, 'localhost', 8092)
  await signInWithCustomToken(auth, await admin.auth().createCustomToken(ME))
  const mine = doc(db, pPath(ME))

  const write = async (ref, data) => { try { await updateDoc(ref, data); return null } catch (e) { return e.code || String(e) } }

  console.log('\n── Every student-answered question saves (one write per question, as the prep screen does) ──')
  ok('the definition declares student-answered questions', studentWritten.length > 0)
  for (const q of studentWritten) {
    const err = await write(mine, { [q.field]: sampleAnswer(q) })
    ok(`${q.category}: ${q.field}`, err === null, err)
  }

  console.log('\n── The debrief saves in ONE write, as the Results screen sends it ──')
  const debrief = { debrief_reflection: 'We anchored high and it held.', debrief_submitted_at: serverTimestamp() }
  for (const q of studentWritten.filter(q => q.category === 'debrief')) debrief[q.field] = sampleAnswer(q)
  const dErr = await write(mine, debrief)
  ok(`whole debrief (${Object.keys(debrief).join(', ')})`, dErr === null, dErr)
  const stored = (await adminDb.doc(pPath(ME)).get()).data()
  ok('reflection and every debrief answer are stored', stored.debrief_reflection != null && stored.debrief_submitted_at != null &&
    studentWritten.filter(q => q.category === 'debrief').every(q => stored[q.field] != null))
  ok('the numeric opening offer is stored (the 2026-10-05 field)', stored.debrief_initial_offer === '150000')

  console.log('\n── What a student must NOT be able to change is still refused ──')
  const forbidden = {
    role: 'kelly', group_id: 'g2', is_lead: false, raw_score: 999999, normalized_score: 3,
    knowledge_check_score: 1, prep_status: 'complete', finalized_at: serverTimestamp(),
    attendance_confirmed_at: serverTimestamp(), confirmed_ready_at: serverTimestamp(),
  }
  for (const [field, value] of Object.entries(forbidden)) {
    const err = await write(mine, { [field]: value })
    ok(`${field} refused`, err === 'permission-denied', err === null ? 'WRITE WAS ALLOWED' : err)
  }
  const smuggle = await write(mine, { debrief_reflection: 'x', raw_score: 999999 })
  ok('a protected field smuggled in beside an answer is refused', smuggle === 'permission-denied', smuggle === null ? 'WRITE WAS ALLOWED' : smuggle)
  const after = (await adminDb.doc(pPath(ME)).get()).data()
  ok('protected values are unchanged', after.role === 'chris' && after.group_id === 'g1' && after.raw_score === 5 && after.prep_status === 'in_progress')

  console.log('\n── Another student\'s record is closed ──')
  const theirs = doc(db, pPath(OTHER))
  const wErr = await write(theirs, { debrief_reflection: 'not mine' })
  ok('cannot write another student\'s answers', wErr === 'permission-denied', wErr === null ? 'WRITE WAS ALLOWED' : wErr)
  let rErr = null
  try { await getDoc(theirs) } catch (e) { rErr = e.code }
  ok('cannot read another student\'s record', rErr === 'permission-denied', rErr === null ? 'READ WAS ALLOWED' : rErr)

  console.log(`\n═══ ${passed}/${passed + failed} checks passed ═══\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => { console.error('FATAL', err); process.exit(1) })
