import { describe, it, expect } from 'vitest'
import { fitRect, matRect, resolveSize } from '../../src/core/geometry'
import {
  frameFits,
  matCeiling,
  matSumCeiling,
  offsetBounds,
  scaleCeiling,
  settleFrame,
  type FrameGeometry,
} from '../../src/core/limits'
import { TEMPLATES } from '../../src/core/templates'
import type { Ratio, Size } from '../../src/core/types'

/**
 * The 画面 ceilings, against the layout they claim to describe.
 *
 * `limits.ts` derives three closed forms — how large a photograph may be, how
 * deep a mat may go, how far off centre a mount may sit — from the arithmetic
 * in `fitRect` and `matRect`. A closed form that is merely written down is a
 * second opinion about the geometry, and the whole reason the built-in set has
 * a 样张 story to tell is that two opinions about the same numbers can disagree
 * for months. So nothing here trusts the algebra: every claim about fitting is
 * checked by laying the poster out with the same two functions `render` calls.
 */

const LONG_EDGE = 1440

/** Float arithmetic, not a slack budget — see the same constant in `limits.ts`
 *  and the same reasoning in `templates.test.ts`. */
const EPS = 1e-9

/**
 * How far the mat hangs off the canvas, in device pixels, at worst: the
 * expression `templates.test.ts` already uses to pin the invariant for the
 * built-ins. Imported logic, restated geometry — a copy of the *arithmetic*
 * here could drift from the implementation, so there is none.
 */
function matOverflow(size: Size, aspect: number, g: FrameGeometry, k: number): number {
  const box = { W: size.W * k, H: size.H * k }
  const frame = fitRect(box, aspect, g.scale, 0, 0)
  const mat = matRect(frame, g.mat, g.matBottom, k)
  return Math.max(-mat.x, -mat.y, mat.x + mat.w - box.W, mat.y + mat.h - box.H)
}

/**
 * The aspects a photograph can arrive with. Two of them are load-bearing:
 * the canvas's own (`size.W / size.H`), which is the one that leaves the least
 * room and is therefore where the closed form has to be exactly right; and the
 * sample fixture's 640/1074, which is the photograph every pixel spec loads and
 * is narrower than any canvas in the set.
 */
const ASPECTS = [0.35, 0.596, 0.68, 0.8, 1, 1.5, 2.5]

const GEOMETRIES: FrameGeometry[] = [
  { scale: 20, mat: 0, matBottom: 0 },
  { scale: 44, mat: 0, matBottom: 0 },
  { scale: 56, mat: 12, matBottom: 0 },
  { scale: 64, mat: 16, matBottom: 104 },
  { scale: 72, mat: 0, matBottom: 0 },
  { scale: 72, mat: 60, matBottom: 0 },
  { scale: 66, mat: 86, matBottom: 150 },
  { scale: 88, mat: 4, matBottom: 20 },
  { scale: 100, mat: 0, matBottom: 0 },
  { scale: 84, mat: 120, matBottom: 0 },
]

describe('a geometry that fits by the closed form fits on the canvas', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: every fitted geometry lays the mat inside the canvas`, () => {
      const size = resolveSize(t.canvas.ratio, LONG_EDGE)
      for (const g of GEOMETRIES) {
        if (!frameFits(size, g)) continue
        // k = 2 as well as 1: the arithmetic is scale-free today, and the export
        // is the artifact nobody looks at twice — a per-scale rounding would
        // crop there first (the same reason `templates.test.ts` checks both).
        for (const k of [1, 2]) {
          for (const aspect of ASPECTS) {
            const over = matOverflow(size, aspect, g, k)
            expect(
              over,
              `${t.id} at k=${k} aspect=${aspect}: scale ${g.scale} + mat ${g.mat} + ` +
                `matBottom ${g.matBottom} fits by the closed form but hangs ${over.toFixed(1)}px off the canvas`,
            ).toBeLessThanOrEqual(EPS)
          }
        }
      }
    })
  }
})

describe('and a geometry that does not fit really does not fit', () => {
  // The converse, which is what makes the closed forms exact rather than merely
  // safe: at the canvas's own aspect — the worst case, where the frame is at
  // its largest on both axes — a refused geometry has to overflow the canvas.
  // Without this, `scaleCeiling` could have been `0` and the suite above would
  // still pass.
  it('a mat past the ceiling hangs off the canvas at the canvas own aspect', () => {
    const size = resolveSize('4:5', LONG_EDGE)
    const aspect = size.W / size.H
    const ceiling = matCeiling(size, 72)
    const just = { scale: 72, mat: ceiling, matBottom: 0 }
    const past = { scale: 72, mat: ceiling + 40, matBottom: 0 }

    expect(frameFits(size, just)).toBe(true)
    expect(matOverflow(size, aspect, just, 1)).toBeLessThanOrEqual(EPS)
    expect(frameFits(size, past)).toBe(false)
    expect(matOverflow(size, aspect, past, 1)).toBeGreaterThan(0)
  })

  it('a scale past the ceiling hangs the mat off the canvas at the canvas own aspect', () => {
    const size = resolveSize('4:5', LONG_EDGE)
    const aspect = size.W / size.H
    const cap = scaleCeiling(size, 86, 150)
    const just = { scale: cap, mat: 86, matBottom: 150 }
    const past = { scale: Math.min(cap + 12, 100), mat: 86, matBottom: 150 }

    expect(frameFits(size, just)).toBe(true)
    expect(matOverflow(size, aspect, just, 1)).toBeLessThanOrEqual(EPS)
    expect(frameFits(size, past)).toBe(false)
    expect(matOverflow(size, aspect, past, 1)).toBeGreaterThan(0)
  })
})

describe('the ceilings and the scale are inverses', () => {
  // A slider asks "what is the largest scale?" and "how deep a mat may I have?"
  // about the same poster, so the two answers have to be the same line. If they
  // are not, a user can be given a maximum that is immediately refused.
  for (const ratio of ['4:5', '1:1', '3:2', '16:9', '9:16'] as Ratio[]) {
    it(`${ratio}: matCeiling is the exact inverse of scaleCeiling`, () => {
      const size = resolveSize(ratio, LONG_EDGE)
      for (const scale of [20, 33, 50, 66, 72, 88, 100]) {
        expect(scaleCeiling(size, matCeiling(size, scale), 0), `scale ${scale}`).toBeCloseTo(scale, 9)
      }
      for (const scale of [20, 50, 72, 100]) {
        expect(scaleCeiling(size, 0, matSumCeiling(size, scale)), `scale ${scale}`).toBeCloseTo(scale, 9)
      }
    })
  }
})

describe('the built-in templates sit inside their own ceilings', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: authored geometry is within the limits the panel offers`, () => {
      const size = resolveSize(t.canvas.ratio, LONG_EDGE)
      const { scale, mat, matBottom } = t.frame
      expect(mat, `${t.id} mat`).toBeLessThanOrEqual(matCeiling(size, scale) + EPS)
      expect(mat + matBottom, `${t.id} mat + matBottom`).toBeLessThanOrEqual(
        matSumCeiling(size, scale) + EPS,
      )
      expect(scale, `${t.id} scale`).toBeLessThanOrEqual(scaleCeiling(size, mat, matBottom) + EPS)
      expect(frameFits(size, t.frame), `${t.id} must fit`).toBe(true)
    })
  }
})

describe('settleFrame', () => {
  const size = resolveSize('4:5', LONG_EDGE)

  it('lowers the scale and nothing else', () => {
    const before = { scale: 96, mat: 86, matBottom: 150 }
    const after = settleFrame(size, before)
    expect(after.scale).toBeLessThan(before.scale)
    expect(after.mat).toBe(before.mat)
    expect(after.matBottom).toBe(before.matBottom)
    expect(frameFits(size, after)).toBe(true)
  })

  it('is the identity when the geometry already fits', () => {
    const g = { scale: 64, mat: 16, matBottom: 104 }
    expect(frameFits(size, g)).toBe(true)
    // By reference, not by value: `settleTemplate` and `setControl` use this
    // answer to tell "the user moved something" from "the app re-derived the
    // same record", and the 已调整 marker rides on it.
    expect(settleFrame(size, g)).toBe(g)
  })

  it('is idempotent, and one pass is enough', () => {
    const once = settleFrame(size, { scale: 100, mat: 200, matBottom: 0 })
    expect(settleFrame(size, once)).toBe(once)
    expect(frameFits(size, once)).toBe(true)
  })

  it('accepts a geometry it cannot make fit rather than moving backwards', () => {
    // A mat deeper than half the canvas can never fit at any scale, and the
    // honest answer is a scale of 0 — not a raised scale, and not a throw.
    const g = settleFrame(size, { scale: 72, mat: 900, matBottom: 0 })
    expect(g.scale).toBe(0)
    expect(g.mat).toBe(900)
  })
})

describe('offsetBounds', () => {
  it('is symmetric horizontally and biased upward by matBottom', () => {
    const size = resolveSize('4:5', LONG_EDGE)
    const frame = fitRect(size, size.W / size.H, 64, 0, 0)
    const flat = offsetBounds(size, frame, 0, 0)
    expect(flat.x.min).toBeCloseTo(-flat.x.max, 9)
    expect(flat.y.min).toBeCloseTo(-flat.y.max, 9)

    // With a card under it the mount has less room in every direction — the mat
    // eats the walls on all four sides — and the range is no longer symmetric:
    // the bottom is deeper by `matBottom`, so the frame has to sit higher, and
    // the midpoint of the range sinks below zero (a negative offset moves the
    // mount up).
    const banded = offsetBounds(size, frame, 16, 104)
    expect(banded.x.min).toBeGreaterThan(flat.x.min)
    expect(banded.y.min).toBeGreaterThan(flat.y.min)
    expect(banded.y.max).toBeLessThan(flat.y.max)
    expect(banded.y.min + banded.y.max).toBeLessThan(0)
  })

  it('a mount at either bound still lies inside the canvas', () => {
    for (const t of TEMPLATES) {
      const size = resolveSize(t.canvas.ratio, LONG_EDGE)
      const aspect = size.W / size.H
      const frame = fitRect(size, aspect, t.frame.scale, 0, 0)
      const b = offsetBounds(size, frame, t.frame.mat, t.frame.matBottom)
      for (const k of [1, 2]) {
        const box = { W: size.W * k, H: size.H * k }
        for (const [ox, oy] of [
          [b.x.min, 0],
          [b.x.max, 0],
          [0, b.y.min],
          [0, b.y.max],
          [b.x.min, b.y.min],
          [b.x.max, b.y.max],
        ]) {
          const shifted = fitRect(box, aspect, t.frame.scale, ox!, oy!)
          const mat = matRect(shifted, t.frame.mat, t.frame.matBottom, k)
          const over = Math.max(
            -mat.x,
            -mat.y,
            mat.x + mat.w - box.W,
            mat.y + mat.h - box.H,
          )
          expect(
            over,
            `${t.id} at k=${k} offset (${ox},${oy}): the mat hangs ${over.toFixed(1)}px off the canvas`,
          ).toBeLessThanOrEqual(EPS)
        }
      }
    }
  })

  it('an offset past the bound hangs the mat off the canvas', () => {
    // The converse again: the bound has to be tight, or the sliders would
    // refuse movement the renderer would have been happy with.
    const size = resolveSize('4:5', LONG_EDGE)
    const aspect = size.W / size.H
    const frame = fitRect(size, aspect, 72, 0, 0)
    const b = offsetBounds(size, frame, 0, 0)
    const far = fitRect(size, aspect, 72, b.x.max * 1.6, 0)
    const mat = matRect(far, 0, 0, 1)
    const over = Math.max(-mat.x, mat.x + mat.w - size.W)
    // with no mat the *photograph* is what leaves the canvas at this scale
    const frameOver = Math.max(-far.x, far.x + far.w - size.W)
    expect(Math.max(over, frameOver)).toBeGreaterThan(0)
  })
})
