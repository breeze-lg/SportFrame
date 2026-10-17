import { describe, expect, it } from 'vitest'
import {
  FONT_CHOICES,
  SYSTEM_STACK,
  isUserFont,
  labelOfFont,
  stackOf,
  userFontId,
  userFontName,
} from '../../src/core/fonts'

/**
 * The typeface table.
 *
 * What matters here is not the list but the *fallback*: these are system
 * families, so a template rendered on a machine that has none of them must land
 * on the app's own stack rather than on whatever the browser calls `cursive`.
 * Every stack therefore ends with `SYSTEM_STACK` — an invariant, not a
 * convention, because a poster is a photograph with words on it and printing them
 * in Times New Roman is a worse answer than printing them in the app's face.
 */
describe('the stack table', () => {
  it('ends every choice in the app\'s own stack', () => {
    for (const f of FONT_CHOICES) {
      expect(f.stack.endsWith(SYSTEM_STACK), `${f.id}: ${f.stack}`).toBe(true)
      expect(f.label.length, `${f.id} has no label`).toBeGreaterThan(0)
      expect(f.stack.indexOf(f.id === 'default' ? SYSTEM_STACK : ''), f.id).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives every choice an id of its own', () => {
    const ids = FONT_CHOICES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('offers the two groups the picker groups by', () => {
    const groups = new Set(FONT_CHOICES.map((f) => f.group))
    expect([...groups].sort()).toEqual(['latin', 'zh'])
    // the request that built this: handwriting and script
    expect(FONT_CHOICES.map((f) => f.label).join(' ')).toMatch(/手写/)
    expect(FONT_CHOICES.map((f) => f.label).join(' ')).toMatch(/花体/)
  })

  it('answers the system stack for an id it does not know', () => {
    expect(stackOf('nonesuch')).toBe(SYSTEM_STACK)
    expect(stackOf(undefined)).toBe(SYSTEM_STACK)
    expect(stackOf('')).toBe(SYSTEM_STACK)
  })
})

describe('the fonts a user loads', () => {
  it('round-trips a name through its id', () => {
    const id = userFontId('字魂手写')
    expect(isUserFont(id)).toBe(true)
    expect(userFontName(id)).toBe('字魂手写')
    expect(labelOfFont(id)).toBe('字魂手写')
  })

  it('quotes the name and falls back to the app\'s stack behind it', () => {
    const stack = stackOf(userFontId('My Hand'))
    expect(stack.startsWith('"My Hand"')).toBe(true)
    expect(stack.endsWith(SYSTEM_STACK)).toBe(true)
  })

  it('cannot be used to break out of the quoted family', () => {
    // A name comes from a file name, which a user controls. A quote in it would
    // end the family early and turn the rest of the string into CSS — so the name
    // is stripped and the whole of it stays inside one pair of quotes.
    const stack = stackOf(userFontId('evil",serif'))
    expect(stack.startsWith('"evil,serif"')).toBe(true)
    expect(stack.slice('"evil,serif"'.length).startsWith(',')).toBe(true)
    expect(stack.endsWith(SYSTEM_STACK)).toBe(true)
  })

  it('is not a preset, and a preset is not one of these', () => {
    expect(isUserFont('kaiti')).toBe(false)
    expect(isUserFont(undefined)).toBe(false)
    expect(stackOf('kaiti')).not.toBe(SYSTEM_STACK)
    expect(labelOfFont('kaiti')).toBe('楷体')
  })
})
