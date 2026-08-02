import { describe, it, expect } from 'vitest'
import { parseMoney } from '../src/getReportData'

// The numeric debrief opening-offer is captured through the shared *text* debrief field,
// so getReportData converts it to a number in code. These pin the lenient parse.
describe('parseMoney — debrief opening-offer text → number', () => {
  it('plain digits', () => expect(parseMoney('150000')).toBe(150_000))
  it('currency formatting ($ and commas)', () => {
    expect(parseMoney('$150,000')).toBe(150_000)
    expect(parseMoney('$1,234,567')).toBe(1_234_567)
  })
  it('k / m suffixes', () => {
    expect(parseMoney('150k')).toBe(150_000)
    expect(parseMoney('1.2m')).toBe(1_200_000)
    expect(parseMoney('$300K')).toBe(300_000)
  })
  it('already a number', () => expect(parseMoney(287_500)).toBe(287_500))
  it('non-numeric / empty / non-positive → null', () => {
    expect(parseMoney('around 150k')).toBeNull()   // stray words → NaN
    expect(parseMoney('  ')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
    expect(parseMoney(0)).toBeNull()
    expect(parseMoney(null)).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
  })
})
