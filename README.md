# Grays 2.0

Bilateral negotiation, two roles, one student per role:

- **Chris** — seller, and the **lead** in every group.
- **Kelly** — buyer.
- Composition: `{ chris: 1, kelly: 1 }` (symmetric, 1 per role — same shape as Winemaster).

Spawned **from Winemaster** (the canonical 2-role negotiation reference) per
`Game_Scaffold_Spec_v1.md` **Part 1**. The existing `grays-com` game is a **separate,
frozen** game and is not related to this codebase.

## Build status — Part 1 (blank canvas) + Part 2 (online mode)

**Part 1** wired everything to the shared libraries with **placeholder content** (stub
KC/prep/debrief text, a single stub `price` outcome field, a placeholder surplus scoring
formula) and a full **classroom** play-through. Part 3 supplies the real contract-form
fields and per-role scoring formula. Content is still placeholder.

**Part 2 adds the instructor-toggled ONLINE mode** (Online_Matching_Spec_v1 + the grays
role-at-grouping design):

- **Mode switch** (Classroom / Online) on the dashboard; `clock_mode` config field.
- **Roles assigned AT grouping** — the instructor pre-groups the roster into Chris/Kelly
  pairs (first seat → Chris/lead, second → Kelly). Grays is the first negotiation
  consumer of the shared `makeNegotiationGroupAdapter`.
- **Per-ROLE auto-start** — a group opens the moment ≥1 Chris AND ≥1 Kelly are present
  (never a seat headcount; a 2-Chris/0-Kelly group can never start).
- **Incomplete-group advisory** — a roll-up + per-group missing-role notice (⚠ No Kelly /
  ⚠ No Chris). INFORM, never block. Doubling-up (2 Chris + 1 Kelly) is legal and silent.
- **"I can't reach my group"** flag (mailto only) + the assignment-status report (§6).
- **Lock at first play** — a started group is frozen for moves (the shared per-group lock).
- **NO bots** — a bot cannot hold a role's private information and negotiate.

Classroom mode (Part 1) is byte-behavior-identical; the mode switch is the only addition.
The move/ungroup panel is the shared `GroupsControlPanel` (mounted in online mode only).

## Shared library pins

| Package | Pin | Consumed as |
|---|---|---|
| `@mygames/game-server` | `v0.28.0` (git tag) | functions dependency |
| `@mygames/game-engine` | `v0.5.0` (git tag) | functions + frontend dependency |
| `@mygames/game-ui` | `0.34.0` (file: symlink) | frontend dependency |

## Reports (Reports_Contract_v1)

- **Tier 1** — Contract Outcomes roster (shared `SortableTable` + `ReportBoard`).
- **Tier 2** — one tile **per free-text question** (`prep_first_topic`,
  `prep_question_other_side`, `prep_reason_for_number`, `debrief_first_price`),
  driven by the question config.
- **Tier 3** — game-specific price-distribution chart — **stub** (Part 3).

## Local dev (emulator)

Emulator ports are grays-2-specific: functions 5015, firestore 8092, database 9012,
auth 9111, hosting 5016, UI 4012.

```
cd functions && npm run build && firebase emulators:start
# in another shell: cd frontend && npm run dev
```

Emulator play-through test: `node functions/test/matchIntegration.cjs` (emulator up).
