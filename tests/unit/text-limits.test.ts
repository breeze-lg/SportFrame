import { describe, expect, it } from 'vitest'
import { fitRect } from '../../src/core/geometry'
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  sizeCeiling,
  settleText,
  textOffsetBounds,
  textRoom,
  textScaleCeiling,
} from '../../src/core/limits'
import { TEXT_FIT, blockTop, textBoxHeight, textSpan } from '../../src/core/text'
import type { Size, TextConfig } from '../../src/core/types'

/**
 * 文字's ceilings, and the one thing they have to be: derived from the layout the
 * renderer actually uses. `limits.ts` computes them from `textSpan`/`blockTop` —
 * the same two functions `drawText` lays the block out with — so what these tests
 * check is that the closed forms hold against the layout, not that they were
 * written a particular way.
 *
 * The canvas is the app's own: 1152×1440, a 4:5 poster at `longEdge` 1440.
 */
const SIZE: Size = { W: 1152, H: 1440 }
const FRAME = fitRect(SIZE, 0.596, 66, 0, 0) // 样张's frame, for a 640×1074 photograph
const BARE = fitRect(SIZE, 0.596, 72, 0, 0) // 经典's, no mat

const classic: TextConfig = {
  anchor: 'bottom',
  slots: [
    { id: 'sub', size: 14, weight: 500, color: '#fff' },
    { id: 'title', size: 34, weight: 700, color: '#fff' },
  ],
}

const specSheet: TextConfig = {
  anchor: 'mat',
  slots: [{ id: 'title', size: 24, weight: 400, color: '#000' }],
}

describe('textSpan', () => {
  it('is the advance of the taller line at each step, as `drawText` stacks them', () => {
    const span = textSpan(classic, SIZE, 1)
    const sub = (14 / 100) * SIZE.H * 0.2
    const title = (34 / 100) * SIZE.H * 0.2
    expect(span).toBeCloseTo(Math.max(sub, title) * 1.15, 6)
  })

  it('counts a repeated id once, the way one slot is one line', () => {
    const twice: TextConfig = { ...classic, slots: [...classic.slots, classic.slots[1]!] }
    expect(textSpan(twice, SIZE, 1)).toBe(textSpan(classic, SIZE, 1))
  })

  it('scales with k, because every size in the layout does', () => {
    expect(textSpan(classic, SIZE, 2)).toBeCloseTo(textSpan(classic, SIZE, 1) * 2, 6)
  })
})

describe('blockTop', () => {
  it('hangs the block down from the top margin', () => {
    expect(blockTop({ ...classic, anchor: 'top' }, SIZE, 100, BARE, 1)).toBe(144)
  })

  it('grows the block up from the bottom margin', () => {
    expect(blockTop({ ...classic, anchor: 'bottom' }, SIZE, 100, BARE, 1)).toBe(1440 * 0.9 - 100)
  })

  it('centres the block on the canvas, by its own extent', () => {
    expect(blockTop({ ...classic, anchor: 'center' }, SIZE, 100, BARE, 1)).toBe(720 - 50)
  })

  it('starts 62% into the white band under the photograph', () => {
    const y = blockTop(specSheet, SIZE, 0, FRAME, 1, 150)
    expect(y).toBeCloseTo(FRAME.y + FRAME.h + 150 * 0.62, 6)
  })

  it('falls through to the bottom on a template with no band to speak of', () => {
    const nearlyMatless: TextConfig = { ...classic, anchor: 'mat' }
    const withNoBand = blockTop(nearlyMatless, SIZE, 100, BARE, 1, 0)
    const bottom = blockTop({ ...classic, anchor: 'bottom' }, SIZE, 100, BARE, 1)
    expect(withNoBand).toBe(bottom)
  })
})

describe('textRoom', () => {
  it('leaves a tenth of the canvas at each end for the three whole-canvas anchors', () => {
    for (const anchor of ['top', 'center', 'bottom'] as const) {
      expect(textRoom(SIZE, anchor, BARE, 0), anchor).toBeCloseTo(SIZE.H * 0.9, 6)
    }
  })

  it('is the band\'s own remaining depth for the mat anchor', () => {
    const room = textRoom(SIZE, 'mat', FRAME, 150)
    const expected = SIZE.H - (FRAME.y + FRAME.h + 150 * 0.62)
    expect(room).toBeCloseTo(expected, 6)
    // 样张's band is the shallowest room in the product, which is the interesting
    // case: the ceiling there is a real constraint and not a formality
    expect(room).toBeLessThan(SIZE.H * 0.2)
  })
})

describe('sizeCeiling', () => {
  it('is the size at which the block, scaled uniformly, fills the room it has', () => {
    const factor = textScaleCeiling(SIZE, classic, BARE, 0)
    // the product's own cap is the other half of the answer: a block's ceiling is
    // the smaller of "what the layout leaves" and "what is still a caption"
    const wanted = Math.round(Math.min(MAX_TEXT_SIZE, 14 * factor) * 100) / 100
    expect(sizeCeiling(SIZE, classic, BARE, 0, 0)).toBeCloseTo(wanted, 2)
  })

  it('leaves every line inside the canvas when dragged to the top of its range', () => {
    for (const index of [0, 1]) {
      const at = classic.slots[index]!.size
      const max = sizeCeiling(SIZE, classic, BARE, 0, index)
      const grown: TextConfig = {
        ...classic,
        slots: classic.slots.map((s, i) => (i === index ? { ...s, size: max } : s)),
      }
      const span = textSpan(grown, SIZE, 1)
      const y0 = blockTop(grown, SIZE, span, BARE, 1)
      expect(y0, `slot ${index} ran off the top`).toBeGreaterThanOrEqual(0)
      expect(y0 + span, `slot ${index} ran off the bottom`).toBeLessThanOrEqual(SIZE.H)
      expect(max, `slot ${index} did not even reach its authored size`).toBeGreaterThanOrEqual(at)
    }
  })

  it('never offers more than the product allows, or less than legibility', () => {
    const tiny: TextConfig = { ...classic, slots: [{ id: 'title', size: 1, weight: 700, color: '#fff' }] }
    const huge: TextConfig = { ...classic, slots: [{ id: 'title', size: 500, weight: 700, color: '#fff' }] }
    expect(sizeCeiling(SIZE, tiny, BARE, 0, 0)).toBeGreaterThanOrEqual(MIN_TEXT_SIZE)
    expect(sizeCeiling(SIZE, huge, BARE, 0, 0)).toBeLessThanOrEqual(MAX_TEXT_SIZE)
  })
})

describe('textOffsetBounds', () => {
  it('gives a horizontal range of what the fit rule leaves either side', () => {
    const b = textOffsetBounds(SIZE, classic, BARE, 0)
    expect(b.x.max).toBeCloseTo(50 * (1 - TEXT_FIT), 6)
    expect(b.x.min).toBeCloseTo(-50 * (1 - TEXT_FIT), 6)
  })

  it('lets the block move until its own box meets an edge, and no further', () => {
    const b = textOffsetBounds(SIZE, classic, BARE, 0)
    for (const at of [b.y.min, b.y.max]) {
      const span = textSpan(classic, SIZE, 1)
      const y0 = blockTop(classic, SIZE, span, BARE, 1) + (at / 100) * SIZE.H
      const first = (14 / 100) * SIZE.H * 0.2
      const last = (34 / 100) * SIZE.H * 0.2
      expect(y0 - first * 0.9, `at ${at} the block left the top`).toBeGreaterThanOrEqual(-1e-6)
      expect(y0 + span + last * 0.3, `at ${at} the block left the bottom`).toBeLessThanOrEqual(
        SIZE.H + 1e-6,
      )
    }
  })

  it('is never inverted, even for a block already against an edge', () => {
    const b = textOffsetBounds(SIZE, { ...classic, anchor: 'top' }, BARE, 0)
    expect(b.y.min).toBeLessThanOrEqual(0)
    expect(b.y.max).toBeGreaterThanOrEqual(0)
    expect(b.x.min).toBeLessThanOrEqual(0)
    expect(b.x.max).toBeGreaterThanOrEqual(0)
  })

  it('rounds, because these numbers go straight into a slider', () => {
    const b = textOffsetBounds(SIZE, classic, BARE, 0)
    for (const v of [b.x.min, b.x.max, b.y.min, b.y.max]) {
      expect(String(v), `${v} is not a slider value`).toBe(String(Number(v.toFixed(2))))
    }
  })
})

describe('settleText', () => {
  it('returns the record it was handed when nothing needs to change', () => {
    expect(settleText(SIZE, classic, BARE, 0)).toBe(classic)
  })

  it('shrinks a block whose sizes cannot fit the room it has', () => {
    // Four lines at the product's own maximum: the box is 2142px of a 1296px room,
    // so it has to come down by roughly half
    const tooBig: TextConfig = {
      anchor: 'bottom',
      slots: [
        { id: 'sub', size: MAX_TEXT_SIZE, weight: 500, color: '#fff' },
        { id: 'title', size: MAX_TEXT_SIZE, weight: 700, color: '#fff' },
        { id: 'sign', size: MAX_TEXT_SIZE, weight: 400, color: '#fff' },
        { id: 'sub', size: MAX_TEXT_SIZE, weight: 500, color: '#fff' },
      ],
    }
    const settled = settleText(SIZE, tooBig, BARE, 0)
    expect(settled).not.toBe(tooBig)
    expect(textBoxHeight(settled, SIZE, 1)).toBeLessThanOrEqual(SIZE.H * 0.9 + 1e-6)
    // uniformly: the authored relationship between the lines survives
    const before = tooBig.slots[1]!.size / tooBig.slots[0]!.size
    const after = settled.slots[1]!.size / settled.slots[0]!.size
    expect(after).toBeCloseTo(before, 6)
  })

  it('pulls an offset that has been driven out of the canvas back inside', () => {
    const wild: TextConfig = { ...classic, dx: 40, dy: -90 }
    const settled = settleText(SIZE, wild, BARE, 0)
    const bounds = textOffsetBounds(SIZE, settled, BARE, 0)
    expect(settled.dx!).toBeGreaterThanOrEqual(bounds.x.min)
    expect(settled.dx!).toBeLessThanOrEqual(bounds.x.max)
    expect(settled.dy!).toBeGreaterThanOrEqual(bounds.y.min)
    expect(settled.dy!).toBeLessThanOrEqual(bounds.y.max)
  })
})
