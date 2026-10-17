import { describe, it, expect } from 'vitest'
import { aspectOf, cover, fitRect, matRect, mountRect, resolveSize } from '../../src/core/geometry'
import { TEMPLATES, getTemplate } from '../../src/core/templates'
import { matSumCeiling } from '../../src/core/limits'

/**
 * 无照片's rectangle: the mount's own box inside a canvas of the template's shape.
 *
 * This is what the mode delivers — a 1000×1000 poster whose photograph and border
 * measure 800×800 is written at 800×800 — so the claim here is a claim about the
 * *file*: the box is inside the canvas it was measured in, it is the frame grown by
 * the mat, and it is what the mat's own ceilings already promised would fit.
 */
describe('mountRect', () => {
  const photo = { width: 1600, height: 1200 }

  it('is the frame grown by its mat, and nothing else', () => {
    const t = getTemplate('polaroid')!
    const size = resolveSize(t.canvas.ratio, 1440)
    const aspect = aspectOf(t.canvas.ratio, photo)
    const frame = fitRect(size, aspect, t.frame.scale, 0, 0)
    const card = mountRect(size, aspect, t.frame)
    // Three sides by `mat`, the bottom by `mat + matBottom` — the same arithmetic
    // `render` lays the mount out with, because it is the same `matRect`.
    expect(card).toEqual(matRect(frame, t.frame.mat, t.frame.matBottom, 1))
    expect(card.w).toBeCloseTo(frame.w + t.frame.mat * 2, 9)
    expect(card.h).toBeCloseTo(frame.h + t.frame.mat * 2 + t.frame.matBottom, 9)
  })

  it('sits inside its canvas on every built-in — that is what the mode delivers', () => {
    for (const t of TEMPLATES) {
      const size = resolveSize(t.canvas.ratio, 1440)
      const card = mountRect(size, aspectOf(t.canvas.ratio, photo), t.frame)
      expect(card.x, t.id).toBeGreaterThanOrEqual(0)
      expect(card.y, t.id).toBeGreaterThanOrEqual(0)
      expect(card.x + card.w, t.id).toBeLessThanOrEqual(size.W)
      expect(card.y + card.h, t.id).toBeLessThanOrEqual(size.H)
      // ...and it is smaller than the canvas, or 无照片 would be a mode that did
      // nothing: the field the crop removes has to be there to remove.
      expect(card.w, t.id).toBeLessThan(size.W)
      expect(card.h, t.id).toBeLessThan(size.H)
    }
  })

  it('follows the offsets a record carries, so a crop never cuts the photograph', () => {
    const t = getTemplate('classic')!
    const size = resolveSize(t.canvas.ratio, 1440)
    const aspect = aspectOf(t.canvas.ratio, photo)
    const moved = { ...t.frame, ox: 4, oy: -3 }
    const card = mountRect(size, aspect, moved)
    // A record made in another mode is still a record: its photograph is where its
    // numbers say it is, and the window has to go there.
    expect(card.x).toBeGreaterThan(mountRect(size, aspect, t.frame).x)
    expect(card.y).toBeLessThan(mountRect(size, aspect, t.frame).y)
    expect(card.w).toBeCloseTo(mountRect(size, aspect, t.frame).w, 9)
  })

  it('agrees with the ceiling that put the mat inside the canvas', () => {
    // The deepest mat the panel offers, on the smallest canvas this app draws: the
    // card still fits, which is the promise `matSumCeiling` makes and the one a crop
    // would break loudly by cutting the card's edge off.
    const t = getTemplate('spec-sheet')!
    const size = resolveSize(t.canvas.ratio, 1440)
    const deepest = Math.floor(matSumCeiling(size, t.frame.scale) - t.frame.matBottom)
    const card = mountRect(size, aspectOf(t.canvas.ratio, photo), { ...t.frame, mat: deepest })
    expect(card.y).toBeGreaterThanOrEqual(0)
    expect(card.y + card.h).toBeLessThanOrEqual(size.H)
  })
})

describe('resolveSize', () => {
  it('puts the long edge on width for landscape ratios', () => {
    expect(resolveSize('3:2', 1440)).toEqual({ W: 1440, H: 960 })
  })

  it('puts the long edge on height for portrait ratios', () => {
    expect(resolveSize('4:5', 1440)).toEqual({ W: 1152, H: 1440 })
  })

  it('handles square', () => {
    expect(resolveSize('1:1', 1080)).toEqual({ W: 1080, H: 1080 })
  })

  it('uses the photo aspect for orig', () => {
    expect(resolveSize('orig', 1000, { width: 4000, height: 3000 })).toEqual({ W: 1000, H: 750 })
    expect(resolveSize('orig', 1000, { width: 3000, height: 4000 })).toEqual({ W: 750, H: 1000 })
  })

  it('falls back to 4:5 for orig with no photo', () => {
    expect(resolveSize('orig', 1000)).toEqual({ W: 800, H: 1000 })
  })
})

describe('cover', () => {
  it('fills a box wider than the source', () => {
    const r = cover(3000, 1000, 800, 1000)
    expect(r.w).toBeGreaterThanOrEqual(800)
    expect(r.h).toBeGreaterThanOrEqual(1000)
  })

  it('fills a box taller than the source', () => {
    const r = cover(1000, 3000, 800, 1000)
    expect(r.w).toBeGreaterThanOrEqual(800)
    expect(r.h).toBeGreaterThanOrEqual(1000)
  })

  it('preserves the source aspect ratio', () => {
    const r = cover(4000, 3000, 800, 1000)
    expect(r.w / r.h).toBeCloseTo(4000 / 3000, 6)
  })

  it('applies zoom multiplicatively', () => {
    const base = cover(4000, 3000, 800, 1000)
    const zoomed = cover(4000, 3000, 800, 1000, 2)
    expect(zoomed.w).toBeCloseTo(base.w * 2, 6)
  })
})

describe('fitRect', () => {
  it('centres a frame in the canvas at the given scale', () => {
    const r = fitRect({ W: 1000, H: 1000 }, 1, 50, 0, 0)
    expect(r.w).toBe(500)
    expect(r.h).toBe(500)
    expect(r.x).toBe(250)
    expect(r.y).toBe(250)
  })

  it('shrinks to fit when the photo is wider than the box', () => {
    const r = fitRect({ W: 1000, H: 1000 }, 2, 80, 0, 0)
    expect(r.w).toBe(800)
    expect(r.h).toBe(400)
  })
})

describe('matRect', () => {
  it('extends the frame evenly by mat, plus matBottom below', () => {
    const r = matRect({ x: 100, y: 100, w: 400, h: 500 }, 20, 60, 1)
    expect(r.x).toBe(80)
    expect(r.y).toBe(80)
    expect(r.w).toBe(440)
    expect(r.h).toBe(500 + 20 * 2 + 60)
  })

  it('scales the mat by k', () => {
    const r = matRect({ x: 0, y: 0, w: 10, h: 10 }, 5, 5, 2)
    expect(r.w).toBe(10 + 20)
    expect(r.h).toBe(10 + 20 + 10)
  })
})

describe('[RF-1] cover never letterboxes, for any source and any box', () => {
  it('covers a 4:5 frame from a 3:1 panorama', () => {
    const size = resolveSize('4:5', 1440)
    const fr = fitRect(size, aspectOf('orig', { width: 3000, height: 1000 }), 72, 0, 0)
    const c = cover(3000, 1000, fr.w, fr.h, 1)
    expect(c.w).toBeGreaterThanOrEqual(fr.w - 1e-9)
    expect(c.h).toBeGreaterThanOrEqual(fr.h - 1e-9)
    expect(c.w / c.h).toBeCloseTo(3000 / 1000, 9)
  })

  // Coverage is a property of `cover` alone: for any source and any box, the
  // rect it returns must be at least the box on both axes, so the photo
  // overflows and gets cropped rather than letterboxed.
  //
  // This has to be probed with deliberately *mismatched* aspects. `fitRect`
  // returns a rect whose aspect equals the aspect it was handed, so feeding
  // `cover` a source of that same aspect makes both margins exactly zero for
  // arithmetic reasons that cannot go wrong — an assertion that cannot fail.
  // Pairing unrelated aspects is the only thing that exercises the crop.
  const SOURCE_ASPECTS = [3, 1, 0.5, 1 / 3, 0.75, 1.6]
  const BOX_ASPECTS = [4 / 5, 1, 16 / 9, 9 / 16, 1.5]

  for (const srcAspect of SOURCE_ASPECTS) {
    for (const boxAspect of BOX_ASPECTS) {
      it(`covers a ${boxAspect.toFixed(3)} box from a ${srcAspect.toFixed(3)} source`, () => {
        const iw = 1000
        const ih = Math.round(iw / srcAspect)
        const boxW = 800
        const boxH = Math.round(boxW / boxAspect)

        const c = cover(iw, ih, boxW, boxH, 1)

        expect(c.w).toBeGreaterThanOrEqual(boxW - 1e-9)
        expect(c.h).toBeGreaterThanOrEqual(boxH - 1e-9)
        // the source aspect is preserved, so nothing is distorted
        expect(c.w / c.h).toBeCloseTo(iw / ih, 9)
      })
    }
  }
})

describe('[RF-1] zoom below 1 is an explicit opt-out of coverage', () => {
  // `cover` computes s = max(boxW/iw, boxH/ih) * zoom. The max is what makes
  // the rect cover at zoom 1 (equality on the binding axis, overflow on the
  // other). Any zoom < 1 scales that cover scale down, so the binding axis
  // lands at boxDim * zoom — strictly inside the box. Coverage therefore
  // cannot hold below zoom 1 for any input, and it does not: the photo is
  // deliberately under-filled, and a caller wanting edge-to-edge coverage
  // must pass zoom >= 1. That is the only way it is used: the plan's render
  // spine derives zoom from `background.zoom` (a percentage defaulting to 100,
  // set to 118-148 by every built-in template) to keep the blurred backdrop
  // oversized so the blur never reveals a bare canvas edge. The assertions
  // below pin that truth rather than pretending coverage still holds.
  it('covers exactly at zoom 1, and under-fills by exactly the zoom below it', () => {
    const atOne = cover(3000, 1000, 800, 1000, 1)
    expect(atOne.w).toBeGreaterThanOrEqual(800 - 1e-9)
    expect(atOne.h).toBeGreaterThanOrEqual(1000 - 1e-9)

    // source 3:1 into an 800x1000 box: the box height is the binding axis
    const zoomed = cover(3000, 1000, 800, 1000, 0.5)
    expect(zoomed.h).toBeCloseTo(1000 * 0.5, 9)
    expect(zoomed.h).toBeLessThan(1000) // under-filled: a letterbox, not a cover
    expect(zoomed.w).toBeGreaterThanOrEqual(800) // the free axis still overflows
    expect(zoomed.w / zoomed.h).toBeCloseTo(3, 9) // still undistorted
  })
})
