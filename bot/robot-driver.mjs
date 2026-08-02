// ═══════════════════════════════════════════════════════════════════════════════
// GRAYS 2.0 — ROBOT MODE (the launcher's "simulation" button).
//
// Fills N seats of a live grays2 instance with robots that PLAY THROUGH THE REAL UI in
// headed, tiled Chromium windows an instructor can watch. Per seat the driver:
//   1. drives login → knowledge check (random) → prep (random) → attendance → ready
//      through the EXISTING launcher (POST /api/student-url {mode:'ready'}) — nothing
//      reimplemented here;
//   2. opens a tiled headed window at the ?token= game URL;
//   3. reacts to whatever negotiation screen is up until the game finishes.
//
// The SHELL (windows, tiling, drive-to-ready, the launcher button) is copied verbatim
// from infoshare's robot-driver.mjs. What differs is the ACT path: grays2 is a
// bilateral NEGOTIATION, not a per-round stage loop, so a seat clicks through a fixed
// sequence — group reveal → off-platform → (lead) enter a price & submit / (partner)
// confirm → results — reacting to whichever screen it is shown. The driver does NOT need
// to know its role a priori: it clicks whatever the shared UI presents (a price form ⇒
// it is the lead; a Confirm button ⇒ it is the partner).
//
// ⚠ CLICK, NEVER CALL. Actions go THROUGH THE UI — the button a student presses. The
// harness suite already proves the server; the ONLY thing this runner tests that nothing
// else does is that the buttons are wired.
//
// Prereq: `npm install` at the grays2 repo root (Playwright), the launcher running, and
// an instructor on the dashboard who generates the attendance code and clicks Match Now
// (classroom) — the robots fill and play the seats; the instructor still runs the room.
//
// Usage: node robot-driver.mjs --instance <id> [--seats 2] [--pace watch|fast]
//                              [--launcher http://localhost:5180] [--screen 1920x1080]
// ═══════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module'

// Playwright resolves from the grays2 repo root node_modules (installed for the
// playthrough harness); the bot directory has none of its own.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) a[k.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
  }
  return a
}
const args = parseArgs(process.argv.slice(2))
const INSTANCE = args.instance
/** TWO SEATS BY DEFAULT — a grays2 group is one Chris + one Kelly. Filling BOTH is what
 *  makes a full negotiation run unattended; one robot alone just waits for a partner. */
const GROUP_SIZE = 2
const SEATS = Math.max(1, Math.min(16, Number(args.seats) || GROUP_SIZE))
const PACE = String(args.pace || 'watch')
const LAUNCHER = String(args.launcher || 'http://localhost:5180').replace(/\/$/, '')
const [SCREEN_W, SCREEN_H] = String(args.screen || '1920x1080').split('x').map(Number)

if (!INSTANCE || INSTANCE === true) { console.error('ERROR: --instance <gameInstanceId> is required.'); process.exit(1) }
if (SEATS % GROUP_SIZE !== 0) {
  console.warn(`WARNING: --seats ${SEATS} is not a multiple of the group size (${GROUP_SIZE}).\n` +
    '         At least one group will be short a seat and will not finish on its own.')
}

// 'watch' = human-watchable pauses; 'fast' = quick smoke. Neither affects the outcome.
const THINK = PACE === 'watch' ? { min: 2500, max: 6000 } : { min: 500, max: 1200 }
const POLL_MS = 1500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const think = () => sleep(THINK.min + Math.random() * (THINK.max - THINK.min))

/** The seat's random "decision": a price that leaves surplus on both sides (Chris'
 *  placeholder reservation 100k, Kelly's 200k), so a deal is always reachable. */
const randomPrice = () => 100_000 + Math.floor(Math.random() * 100_000)

// ── window tiling (shared) ─────────────────────────────────────────────────────
function tile(index, total) {
  const cols = Math.ceil(Math.sqrt(total))
  const w = Math.floor(SCREEN_W / cols)
  const h = Math.floor(SCREEN_H / Math.ceil(total / cols))
  return { x: (index % cols) * w, y: Math.floor(index / cols) * h, width: w, height: h }
}

// ── drive one seat to the game screen, via the launcher (shared) ───────────────
async function readyUrlFor(seatIndex) {
  const res = await fetch(`${LAUNCHER}/api/student-url`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // ⚠ `game_instance_id`, NOT `instance` — the launcher 400s on anything else.
    body: JSON.stringify({ game_instance_id: INSTANCE, index: seatIndex, mode: 'ready' }),
  })
  if (!res.ok) throw new Error(`launcher /api/student-url failed: ${res.status} ${await res.text()}`)
  return (await res.json()).url
}

// ── act helpers (THROUGH THE UI) ───────────────────────────────────────────────
async function clickable(page, name, opts = {}) {
  const btn = page.getByRole('button', { name, ...opts })
  if (await btn.count() === 0) return null
  const first = btn.first()
  if (!(await first.isVisible().catch(() => false))) return null
  if (await first.isDisabled().catch(() => true)) return null
  return first
}
async function visibleText(page, text) {
  const loc = page.getByText(text, { exact: false })
  return (await loc.count()) > 0 && (await loc.first().isVisible().catch(() => false))
}

// ── the negotiation loop (grays2-specific ACT path) ────────────────────────────
//
// Reactive: each poll, click whatever this seat is being shown. The shared UI drives the
// branching (a price form ⇒ lead; a Confirm button ⇒ partner), so one loop serves both.
async function runSeat(page, label) {
  let acted = 0, idle = 0
  const DONE_IDLE = 30            // ~45s of no actionable control (after acting) ⇒ done
  const MAX_POLLS = 400          // hard stop so a stuck seat never hangs forever

  for (let poll = 0; poll < MAX_POLLS; poll++) {
    // Terminal: results screen is up.
    if (await visibleText(page, 'Negotiation results') || await visibleText(page, "You're all done") ||
        await visibleText(page, 'Outcome locked')) {
      console.log(`[${label}] ✓ reached results — ${acted} action(s) taken`)
      return
    }

    // 1. Group reveal → Start negotiation.
    let b = await clickable(page, 'Start negotiation')
    // 2. Off-platform → report the outcome.
    if (!b) b = await clickable(page, /report our outcome/i)
    // 3. Lead review dialog → confirm submission.
    if (!b) b = await clickable(page, 'Yes, submit')
    // 4. Partner → confirm the reported outcome (exact, so it never matches "Confirm no deal").
    if (!b) b = await clickable(page, 'Confirm', { exact: true })

    if (b) {
      await think()
      await b.click().catch(() => {})
      acted++; idle = 0
      console.log(`[${label}] clicked (${acted})`)
      await sleep(POLL_MS)
      continue
    }

    // 5. Lead entry form: a price input + "Review & submit". Fill a random price, submit.
    const priceInput = page.locator('input[type="number"]').first()
    const reviewBtn = await clickable(page, /Review .* submit/i)
    if (reviewBtn && (await priceInput.count()) > 0 && (await priceInput.isVisible().catch(() => false))) {
      const price = randomPrice()
      await think()
      await priceInput.fill(String(price)).catch(() => {})
      await reviewBtn.click().catch(() => {})
      acted++; idle = 0
      console.log(`[${label}] entered price ${price.toLocaleString()} & submitted for review`)
      await sleep(POLL_MS)
      continue
    }

    // Nothing to do this poll: waiting for the instructor to Match, or for the partner.
    idle++
    if (acted > 0 && idle >= DONE_IDLE) {
      console.log(`[${label}] no controls for ${idle} polls after acting — treating as finished`)
      return
    }
    await sleep(POLL_MS)
  }
  console.warn(`[${label}] ⚠ hit MAX_POLLS — leaving the window open for inspection`)
}

// ── main (shared) ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`Robot mode: ${SEATS} seat(s) on grays2 instance ${INSTANCE} (pace=${PACE}) — ` +
    `${Math.floor(SEATS / GROUP_SIZE)} full group(s).`)
  console.log('Reminder: on the dashboard, generate the attendance code and click Match Now (classroom) — ' +
    'the robots fill and play the seats.')
  const browsers = [], runs = []
  for (let i = 0; i < SEATS; i++) {
    const box = tile(i, SEATS)
    const browser = await chromium.launch({
      headless: false,
      args: [`--window-position=${box.x},${box.y}`, `--window-size=${box.width},${box.height}`],
    })
    browsers.push(browser)
    const page = await browser.newPage({ viewport: { width: box.width, height: box.height - 90 } })
    const url = await readyUrlFor(i)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    runs.push(runSeat(page, `seat ${i}`).catch((e) => console.error(`[seat ${i}]`, e.message)))
  }
  await Promise.all(runs)
  console.log('All seats finished. Windows left open — close them when you are done.')
  void browsers
}

main().catch((e) => { console.error(e); process.exit(1) })
