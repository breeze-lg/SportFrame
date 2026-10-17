import { describe, it, expect } from 'vitest'
import { blurWidth } from '../../src/core/mat'

/**
 * 白边's blur amount, from the border it fills.
 *
 * Pure arithmetic, so it lives here rather than behind a canvas: what the pixel
 * specs can see is "the border is no longer white", and what they cannot see is
 * *how* soft it is — a value that scaled to nothing on a hairline border would pass
 * there and look like a mat that failed to fill.
 */
describe('blurWidth', () => {
  it('scales with the border it is filling', () => {
    expect(blurWidth(100, 0, 1)).toBeCloseTo(80, 9)
    // ...from the widest side: a 拍立得 card is 16px around and 104px below, and the
    // border has to be soft by the same amount on all four.
    expect(blurWidth(16, 104, 1)).toBeCloseTo(83.2, 9)
  })

  it('keeps a floor, so a hairline border is still a blur', () => {
    // Below ~12px a blur is invisible at all, and a 1px border would otherwise get a
    // 1.6px blur — a mat that reads as a hard edge with a colour in it, which is the
    // one thing this mode is not.
    expect(blurWidth(1, 0, 1)).toBe(12)
    expect(blurWidth(0, 6, 1)).toBe(12)
    expect(blurWidth(0, 0, 1)).toBe(12)
  })

  it('scales with the canvas, like every other absolute measure', () => {
    // Blur is in device pixels: the same poster exported at 2× is twice the size and
    // has to be twice as soft, or the border would crisp up as the file grew.
    expect(blurWidth(16, 104, 2)).toBeCloseTo(blurWidth(16, 104, 1) * 2, 9)
  })
})
