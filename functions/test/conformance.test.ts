import { describe, it, expect } from 'vitest'
import { computeScoreBreakdown, computeRawScore, graysGameDef } from '../src/gameDefinition'

// STUB scoring conformance (Part 1). Placeholder surplus model:
//   chris (seller, value): raw = price − chris_reservation (default 100_000)
//   kelly (buyer,  cost):  raw = kelly_reservation − price (default 200_000)
//   walk-away (null):      value_or_cost = reservation, raw = 0
// Part 3 replaces this with the real formula + a spreadsheet-frozen vector.

describe('grays 2.0 stub scoring', () => {
  it('chris (seller) surplus = price − reservation', () => {
    const b = computeScoreBreakdown('chris', { price: 150_000 })
    expect(b.value_or_cost).toBe(150_000)
    expect(b.raw_score).toBe(50_000) // 150k − 100k
  })

  it('kelly (buyer) surplus = reservation − price', () => {
    const b = computeScoreBreakdown('kelly', { price: 150_000 })
    expect(b.value_or_cost).toBe(150_000)
    expect(b.raw_score).toBe(50_000) // 200k − 150k
  })

  it('walk-away (null outcome) → raw 0, value_or_cost = reservation', () => {
    expect(computeScoreBreakdown('chris', null)).toEqual({ value_or_cost: 100_000, raw_score: 0 })
    expect(computeScoreBreakdown('kelly', null)).toEqual({ value_or_cost: 200_000, raw_score: 0 })
  })

  it('config reservation overrides defaults', () => {
    const cfg = { chris_reservation_price: 120_000, kelly_reservation_price: 250_000 }
    expect(computeRawScore('chris', { price: 200_000 }, cfg)).toBe(80_000)  // 200k − 120k
    expect(computeRawScore('kelly', { price: 200_000 }, cfg)).toBe(50_000)  // 250k − 200k
  })

  it('game definition shape: 2 roles, symmetric 1-per-role composition, lead = chris', () => {
    expect(graysGameDef.roles.roles.map(r => r.key)).toEqual(['chris', 'kelly'])
    expect(graysGameDef.composition).toEqual({ chris: 1, kelly: 1 })
    expect(graysGameDef.scoreSense).toEqual({ chris: 'value', kelly: 'cost' })
  })
})
