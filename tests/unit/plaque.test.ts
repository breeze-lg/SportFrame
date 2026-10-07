import { describe, it, expect } from 'vitest'
import { plaqueText } from '../../src/ui/plaque'
import { TEMPLATES } from '../../src/core/templates'

const premium = TEMPLATES.find((t) => t.premium)!
const free = TEMPLATES.find((t) => !t.premium)!

/**
 * The plaque's rule, in all four states — including the two v1 never reaches.
 * The locked branch is the whole point of the plaque and the branch payments
 * will exercise, so it is asserted here rather than left to be discovered.
 */
describe('the premium plaque', () => {
  it('names the pack for a premium template that is locked', () => {
    expect(plaqueText(premium, false)).toBe(`${premium.name} · 铜角装裱`)
    expect(plaqueText(premium, false)).toBe('样张 · 铜角装裱')
  })

  it('says nothing for a premium template in v1, where nothing is gated', () => {
    expect(plaqueText(premium, true)).toBe('')
  })

  it('says nothing for a free template, locked or not', () => {
    expect(plaqueText(free, false)).toBe('')
    expect(plaqueText(free, true)).toBe('')
  })
})
