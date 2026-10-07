import { describe, it, expect } from 'vitest'
import { fitsCanvas, stamp, MAX_CANVAS_AREA, MAX_CANVAS_EDGE } from '../../src/ui/export'

describe('fitsCanvas', () => {
  it('accepts the exports this app actually produces at 2x', () => {
    // the default 4:5 canvas is 1152×1440 logical; the brief's framing of the
    // same 1440 long edge is 1440×1800 — both 2× forms are well inside
    expect(fitsCanvas({ W: 1152, H: 1440 }, 2)).toBe(true)
    expect(fitsCanvas({ W: 1440, H: 1800 }, 2)).toBe(true)
  })

  it('[RF-5] rejects the 4x premium tier, whose edges are all legal', () => {
    // 4608×5760 = 26.5 MP and 5760×7200 = 41.5 MP: every edge is far under
    // MAX_CANVAS_EDGE, so only the area budget catches these
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

describe('stamp', () => {
  it('formats as YYYY-MM-DD-HH-mm-ss in local time', () => {
    expect(stamp(new Date(2026, 9, 7, 15, 4, 9))).toBe('2026-10-07-15-04-09')
  })
})
