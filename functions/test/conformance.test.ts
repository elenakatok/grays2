import { describe, it, expect } from 'vitest'
import { computeScoreBreakdown, computeRawScore, graysGameDef, CONFORMANCE_VECTOR } from '../src/gameDefinition'

// Grays.com scoring (spec §4 / Appendix B):
//   chris raw = final_price − reservation_price_chris
//   kelly raw = reservation_price_kelly − final_price
//   walk-away raw = configured walk-away value (default 0), in the pool
//   reservation + walk-away values READ FROM CONFIG, never hardcoded.

describe('grays.com scoring — conformance vector (default reservations 25k / 475k)', () => {
  for (const c of CONFORMANCE_VECTOR) {
    it(c.label, () => {
      expect(computeRawScore('chris', c.outcome)).toBe(c.expectedChris)
      expect(computeRawScore('kelly', c.outcome)).toBe(c.expectedKelly)
    })
  }

  it('the spec worked example: final 287,500 → Chris 262,500, Kelly 187,500', () => {
    expect(computeRawScore('chris', { price: 287_500 })).toBe(262_500)
    expect(computeRawScore('kelly', { price: 287_500 })).toBe(187_500)
  })
})

describe('grays.com scoring — config-driven (Appendix B: never hardcode)', () => {
  it('changing the reservation prices changes the scores', () => {
    const cfg = { reservation_price_chris: 50_000, reservation_price_kelly: 500_000 }
    expect(computeRawScore('chris', { price: 300_000 }, cfg)).toBe(250_000) // 300k − 50k
    expect(computeRawScore('kelly', { price: 300_000 }, cfg)).toBe(200_000) // 500k − 300k
  })

  it('walk-away uses the configured walk-away value (default 0)', () => {
    expect(computeRawScore('chris', null)).toBe(0)
    expect(computeRawScore('kelly', null)).toBe(0)
    const cfg = { walkaway_raw_chris: -5_000, walkaway_raw_kelly: -5_000 }
    expect(computeRawScore('chris', null, cfg)).toBe(-5_000)
    expect(computeRawScore('kelly', null, cfg)).toBe(-5_000)
  })

  it('value_or_cost = the agreed price on a deal; both roles are value-sense', () => {
    expect(computeScoreBreakdown('chris', { price: 287_500 }).value_or_cost).toBe(287_500)
    expect(computeScoreBreakdown('kelly', { price: 287_500 }).value_or_cost).toBe(287_500)
    expect(graysGameDef.scoreSense).toEqual({ chris: 'value', kelly: 'value' })
  })
})

describe('grays.com game definition shape', () => {
  it('2 roles chris/kelly, symmetric 1-per-role, single price outcome', () => {
    expect(graysGameDef.roles.roles.map(r => r.key)).toEqual(['chris', 'kelly'])
    expect(graysGameDef.composition).toEqual({ chris: 1, kelly: 1 })
    expect(graysGameDef.outcomeSchema.map(f => f.key)).toEqual(['price'])
    expect(graysGameDef.reservations).toEqual({ chris: 25_000, kelly: 475_000 })
  })
})
