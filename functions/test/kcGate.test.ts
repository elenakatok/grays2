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

  it('has exactly 4 free-text questions → 4 Tier-2 report tiles (3 prep + 1 debrief)', () => {
    const text = (graysGameDef.prepDefaults ?? []).filter(q => q.format === 'text' && !q.hidden)
    expect(text.map(q => q.field)).toEqual([
      'prep_first_topic',
      'prep_question_for_other',
      'prep_planned_offer_reason',
      'debrief_first_price',
    ])
  })

  it('has the two number prep questions (spec §2 Step 5, Q2 & Q4)', () => {
    const nums = (graysGameDef.prepDefaults ?? []).filter(q => q.format === 'number' && q.category === 'preparation')
    expect(nums.map(q => q.field)).toEqual([
      'prep_estimated_other_price',
      'prep_planned_first_offer',
    ])
  })

  it('has the numeric debrief opening-offer (regression x-axis; grays.com parity)', () => {
    const debrief = (graysGameDef.prepDefaults ?? []).filter(q => q.category === 'debrief')
    expect(debrief.map(q => q.field)).toEqual(['debrief_first_price', 'debrief_initial_offer'])
    const offer = debrief.find(q => q.field === 'debrief_initial_offer')
    expect(offer?.format).toBe('number')
    expect(offer?.hidden).toBe(false)
  })
})
