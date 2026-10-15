import { describe, expect, it } from 'vitest'
import { TEMPLATES, validateTemplate } from '../../src/core/templates'

/**
 * The line under the poster — the reference editor's title block, in this app's
 * own words.
 *
 * It is copy rather than configuration, and that is exactly why it needs a
 * test: nothing renders from it, so nothing else in the suite would notice a
 * missing or broken one. The rack's chips are pictures, and without this line a
 * first-time visitor is choosing between nine pictures with no words on them.
 */
describe('taglines', () => {
  it('every built-in says in one line what it does', () => {
    for (const t of TEMPLATES) {
      expect(t.tagline, `${t.id} has no tagline`).toBeTruthy()
      expect(t.tagline!.length, `${t.id}'s tagline is a paragraph`).toBeLessThan(30)
    }
  })

  it('they are all different, because nine styles are nine answers', () => {
    const lines = TEMPLATES.map((t) => t.tagline)
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('a record with no tagline still validates — every copy saved before it existed', () => {
    const { tagline, ...bare } = TEMPLATES[0]!
    expect(tagline).toBeTruthy()
    const verdict = validateTemplate(bare)
    expect(verdict.ok).toBe(true)
  })

  it('refuses a tagline that is not a string', () => {
    const bad = { ...TEMPLATES[0]!, tagline: 42 }
    const verdict = validateTemplate(bad)
    expect(verdict.ok).toBe(false)
  })
})
