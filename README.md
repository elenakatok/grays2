# Grays 2.0

Bilateral negotiation, two roles, one student per role:

- **Chris** — seller, and the **lead** in every group.
- **Kelly** — buyer.
- Composition: `{ chris: 1, kelly: 1 }` (symmetric, 1 per role — same shape as Winemaster).

Spawned **from Winemaster** (the canonical 2-role negotiation reference) per
`Game_Scaffold_Spec_v1.md` **Part 1**. The existing `grays-com` game is a **separate,
frozen** game and is not related to this codebase.

## Build status — Part 1 (blank canvas)

This is the **Part 1 blank canvas**: everything is wired to the shared libraries and a
full **classroom** play-through works end-to-end, but **all content is placeholder**
(stub KC/prep/debrief text, a single stub `price` outcome field, a placeholder surplus
scoring formula). Part 2 drops the easy data (real role names, reservation prices, info
docs, KC); Part 3 supplies the real contract-form fields and per-role scoring formula.

**Classroom-only.** No online mode, no Classroom/Online toggle, no Groups panel / move
+ ungroup mount — those are Part 2. The move/ungroup substrate is already inherited from
the pinned shared packages (`game-server v0.28.0`, `game-ui 0.34.0` which exports
`GroupsControlPanel`); Part 2 just mounts it.

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
