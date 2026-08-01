import { describe, it, expect } from 'vitest'
import { validateKCGate } from '@mygames/game-server'
import { graysGameDef } from '../src/gameDefinition'

// The KC role-identification gate must cover every role, or index.ts throws at cold start.
describe('grays 2.0 KC gate', () => {
  it('validates: a gate exists for every role (chris, kelly)', () => {
    const err = validateKCGate(
      graysGameDef.roles.roles.map(r => r.key),
      graysGameDef.prepDefaults ?? [],
    )
    expect(err).toBeNull()
  })

  it('has exactly 4 free-text questions → 4 Tier-2 report tiles', () => {
    const text = (graysGameDef.prepDefaults ?? []).filter(q => q.format === 'text' && !q.hidden)
    expect(text.map(q => q.field)).toEqual([
      'prep_first_topic',
      'prep_question_other_side',
      'prep_reason_for_number',
      'debrief_first_price',
    ])
  })
})
