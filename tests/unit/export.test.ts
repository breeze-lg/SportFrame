import { describe, it, expect } from 'vitest'
import { fitsCanvas, stamp, MAX_CANVAS_EDGE } from '../../src/ui/export'

describe('fitsCanvas', () => {
  it('accepts sizes well inside the limit', () => {
    expect(fitsCanvas({ W: 1440, H: 1800 }, 2)).toBe(true)
  })

  it('[RF-5] rejects a 2x export past the maximum edge', () => {
    expect(fitsCanvas({ W: 12000, H: 4000 }, 2)).toBe(false)
  })

  it('accepts the same size at 1x', () => {
    expect(fitsCanvas({ W: 12000, H: 4000 }, 1)).toBe(true)
  })

  it('uses the documented maximum', () => {
    expect(MAX_CANVAS_EDGE).toBe(16384)
    expect(fitsCanvas({ W: 8192, H: 100 }, 1)).toBe(true)
    expect(fitsCanvas({ W: 8193, H: 100 }, 2)).toBe(false)
  })
})

describe('stamp', () => {
  it('formats as YYYY-MM-DD-HH-mm-ss in local time', () => {
    expect(stamp(new Date(2026, 9, 7, 15, 4, 9))).toBe('2026-10-07-15-04-09')
  })
})
