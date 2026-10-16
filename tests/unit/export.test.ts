import { describe, it, expect } from 'vitest'
import {
  areaBudget,
  deliverySize,
  fitsCanvas,
  stamp,
  MAX_CANVAS_AREA,
  MAX_CANVAS_EDGE,
  PREMIUM_CANVAS_AREA,
} from '../../src/ui/export'
import { aspectOf, mountRect, resolveSize } from '../../src/core/geometry'
import { TEMPLATES, getTemplate } from '../../src/core/templates'
import type { Photo } from '../../src/core/types'

/**
 * The size the file will be.
 *
 * 无照片 is the whole reason this function exists: the mode has no canvas, so the
 * delivery is the mount's own box — the 800×800 a 1000×1000 poster crops down to.
 * Everything that budgets, draws or reports a size asks it, so the claim worth
 * pinning is that they cannot disagree.
 */
describe('deliverySize', () => {
  const photo = { width: 1600, height: 1200 } as Photo

  it('is the whole canvas for every mode that has one', () => {
    const t = getTemplate('classic')!
    const size = resolveSize(t.canvas.ratio, 1440)
    const template = { ...t, background: { ...t.background, mode: 'blur' as const } }
    expect(deliverySize(size, template, photo)).toEqual(size)
  })

  it('is the mount’s own box in 无照片, rounded to whole pixels', () => {
    const t = getTemplate('polaroid')!
    const size = resolveSize(t.canvas.ratio, 1440)
    const card = mountRect(size, aspectOf(t.canvas.ratio, photo), t.frame)
    const delivery = deliverySize(size, { ...t, background: { mode: 'mount' } }, photo)
    // Rounded because a canvas has whole pixels and the card's box is a division's
    // remainder; the size the poster *is* has to be a size a file can be.
    expect(delivery).toEqual({ W: Math.round(card.w), H: Math.round(card.h) })
    // ...and it is the crop the mode promises: smaller than the canvas it was
    // measured in, which is the field a 无照片 file does not carry.
    expect(delivery.W).toBeLessThan(size.W)
    expect(delivery.H).toBeLessThan(size.H)
  })

  it('gives the export ladder the room the crop frees, on every built-in', () => {
    for (const t of TEMPLATES) {
      const size = resolveSize(t.canvas.ratio, 1440)
      const mounted = { ...t, background: { ...t.background, mode: 'mount' as const } }
      const delivery = deliverySize(size, mounted, photo)
      // The budget is about the canvas the file is drawn on, so a poster delivered
      // as its card must be measured as its card — otherwise the ladder refuses a
      // 4× that would have fit, which is a downgrade the user pays for and never
      // sees.
      expect(fitsCanvas(delivery, 4, areaBudget(4)), t.id).toBe(true)
      expect(fitsCanvas(size, 4, areaBudget(4)) && delivery.W < size.W, t.id).toBe(true)
    }
  })

  it('answers without a photograph, because a canvas can be drawn before one arrives', () => {
    const t = getTemplate('classic')!
    const size = resolveSize(t.canvas.ratio, 1440)
    expect(deliverySize(size, t, null)).toEqual(size)
    // 无照片 with no photograph has no mount to measure, and `render` draws no
    // mount: the canvas is the answer rather than a zero.
    expect(deliverySize(size, { ...t, background: { mode: 'mount' } }, null)).toEqual(size)
  })
})

describe('fitsCanvas', () => {
  it('accepts the exports this app actually produces at 2x', () => {
    // the default 4:5 canvas is 1152×1440 logical; the brief's framing of the
    // same 1440 long edge is 1440×1800 — both 2× forms are well inside
    expect(fitsCanvas({ W: 1152, H: 1440 }, 2)).toBe(true)
    expect(fitsCanvas({ W: 1440, H: 1800 }, 2)).toBe(true)
  })

  it('[RF-5] holds both 4x shapes to the floor every device honours', () => {
    // 4608×5760 = 26.5 MP and 5760×7200 = 41.5 MP: every edge is far under
    // MAX_CANVAS_EDGE, so only the area budget catches these. This is the
    // default budget — the one that needs no device-tier bet behind it.
    expect(fitsCanvas({ W: 1152, H: 1440 }, 4)).toBe(false)
    expect(fitsCanvas({ W: 1440, H: 1800 }, 4)).toBe(false)
  })

  it('[RF-5] rejects a request past the area budget with both edges legal', () => {
    expect(fitsCanvas({ W: 4096, H: 4097 }, 1)).toBe(false)
    expect(fitsCanvas({ W: 4096, H: 4096 }, 1)).toBe(true)
    expect(fitsCanvas({ W: 6000, H: 6000 }, 1)).toBe(false)
  })

  it('[RF-5] rejects a 2x export past the maximum edge', () => {
    expect(fitsCanvas({ W: 12000, H: 4000 }, 2)).toBe(false)
  })

  it('rejects at 2x the size it accepts at 1x', () => {
    // 4096² is exactly the area budget: legal doubled nowhere, legal at 1×
    expect(fitsCanvas({ W: 4096, H: 4096 }, 1)).toBe(true)
    expect(fitsCanvas({ W: 4096, H: 4096 }, 2)).toBe(false)
  })

  it('uses the documented maxima', () => {
    expect(MAX_CANVAS_EDGE).toBe(16384)
    expect(MAX_CANVAS_AREA).toBe(16_777_216)
    expect(fitsCanvas({ W: 8192, H: 100 }, 1)).toBe(true)
    expect(fitsCanvas({ W: 8193, H: 100 }, 2)).toBe(false)
  })
})

/**
 * Task 17's decision, as numbers. The 4× tier is §10's premium unlock, and for
 * it to be sellable the export has to be able to *produce* it — Task 9 left it
 * downgraded on every platform, desktop included, because one conservative
 * constant answered for every device. The refinement is a second budget for the
 * one rung that is the tier, and these are the bounds it has to satisfy.
 */
describe('the export budgets', () => {
  it('spends the every-device floor on every rung but the premium one', () => {
    expect(areaBudget(1)).toBe(MAX_CANVAS_AREA)
    expect(areaBudget(2)).toBe(MAX_CANVAS_AREA)
    expect(areaBudget(4)).toBe(PREMIUM_CANVAS_AREA)
    // WebKit's raised iOS cap: 8192². The raised one, not a raised one.
    expect(PREMIUM_CANVAS_AREA).toBe(67_108_864)
  })

  it("makes the app's default 4× deliverable, and only under the premium budget", () => {
    const size = resolveSize('4:5', 1440)
    expect([size.W, size.H]).toEqual([1152, 1440])
    expect(size.W * 4 * (size.H * 4)).toBe(26_542_080)
    expect(fitsCanvas(size, 4)).toBe(false)
    expect(fitsCanvas(size, 4, areaBudget(4))).toBe(true)
  })

  it('admits 4× for every template this app ships, at the shipping long edge', () => {
    // The premium promise as an arithmetic fact rather than a hope: every
    // built-in ratio at the app's 1440 long edge, at 4×, with both edges legal
    // and the area inside the raised cap. A template that outgrew this box
    // would not be sellable at 4×, and this test is where that would surface.
    for (const t of TEMPLATES) {
      const size = resolveSize(t.canvas.ratio, 1440)
      expect(
        fitsCanvas(size, 4, areaBudget(4)),
        `${t.id} at 4× is ${size.W * 4}×${size.H * 4}`,
      ).toBe(true)
    }
  })

  it('bounds the premium budget too, on the area term alone', () => {
    // 6400×8000 = 51.2 MP fits the raised cap; 9600×12000 = 115 MP does not,
    // and both have legal edges — so only the area term refuses the second.
    expect(fitsCanvas({ W: 1600, H: 2000 }, 4, areaBudget(4))).toBe(true)
    expect(fitsCanvas({ W: 2400, H: 3000 }, 4, areaBudget(4))).toBe(false)
  })
})

describe('stamp', () => {
  it('formats as YYYY-MM-DD-HH-mm-ss in local time', () => {
    expect(stamp(new Date(2026, 9, 7, 15, 4, 9))).toBe('2026-10-07-15-04-09')
  })
})
