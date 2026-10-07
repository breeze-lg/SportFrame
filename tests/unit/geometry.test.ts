import { describe, it, expect } from 'vitest'
import { resolveSize, cover, fitRect, matRect } from '../../src/core/geometry'

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

import { aspectOf } from '../../src/core/geometry'

describe('[RF-1] extreme aspect ratios never letterbox', () => {
  it('covers a 4:5 frame from a 3:1 panorama', () => {
    const size = resolveSize('4:5', 1440)
    const fr = fitRect(size, aspectOf('orig', { width: 3000, height: 1000 }), 72, 0, 0)
    const c = cover(3000, 1000, fr.w, fr.h, 1)
    expect(c.w).toBeGreaterThanOrEqual(fr.w - 1e-9)
    expect(c.h).toBeGreaterThanOrEqual(fr.h - 1e-9)
  })

  it('covers a 16:9 frame from a 1:3 portrait', () => {
    const size = resolveSize('16:9', 1440)
    const fr = fitRect(size, aspectOf('orig', { width: 1000, height: 3000 }), 72, 0, 0)
    const c = cover(1000, 3000, fr.w, fr.h, 1)
    expect(c.w).toBeGreaterThanOrEqual(fr.w - 1e-9)
    expect(c.h).toBeGreaterThanOrEqual(fr.h - 1e-9)
  })
})
