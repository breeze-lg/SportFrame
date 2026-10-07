import { test, expect, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

const CFG = {
  anchor: 'bottom' as const,
  slots: [{ id: 'title' as const, size: 34, weight: 700, color: '#ffffff' }],
}

test('a short title renders and stays inside the canvas', async ({ page }) => {
  // CFG is passed as an evaluate argument: page.evaluate serialises the
  // callback, so a free variable from this module's scope is not in the page.
  const hasInk = await page.evaluate((cfg) => {
    const f = (window as any).__frame
    f.setSize(600, 600)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 600, 600)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 600, 600)
    const { drawText } = (window as any).__frameCore
    drawText(ctx, { W: 600, H: 600 }, cfg, { title: 'Hello' }, { x: 0, y: 0, w: 600, h: 600 }, 1)
    return f.sample(0, 0, 600, 600).some((v: number, i: number) => i % 4 !== 3 && v > 200)
  }, CFG)
  expect(hasInk).toBe(true)
})

test('[RF-3] an overlong title shrinks and never crosses its max width', async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = (window as any).__frame
    const { measureToFit, frameFont } = (window as any).__frameCore
    const ctx = f.ctx()
    const long = '光落在该落的地方光落在该落的地方光落在该落的地方光落在该落的地方'
    const maxWidth = 300

    const fitted = measureToFit(ctx, long, maxWidth, (s: number) => frameFont(s, 700), 34)
    ctx.font = frameFont(fitted, 700)
    const width = ctx.measureText(long).width

    return { fitted, width, maxWidth, original: 34 }
  })

  expect(result.fitted).toBeLessThan(result.original)
  expect(result.width).toBeLessThanOrEqual(result.maxWidth + 0.5)
})

// ---------------------------------------------------------------------------
// [RF-3] The same invariant, pinned on rendered pixels.
//
// The test above proves `measureToFit` returns a size that fits. It does not
// prove `drawText` *renders* at that size: the caller is free to measure with
// one font and render with another, and that is the classic way this helper
// silently breaks. These tests call `drawText` itself, then scan the canvas,
// so what is asserted is the end of the invariant — no ink past the band —
// rather than the helper that is supposed to guarantee it.
//
// `drawText` promises a band `W * 0.86 * k` wide, centred on `W / 2`
// (textAlign 'center'), so the allowed x range is
// [ (W - allowed) / 2 , (W + allowed) / 2 ].
// ---------------------------------------------------------------------------

/**
 * `size` in a slot is a scale input, not px: `drawText` turns it into
 * `(size / 100) * H * 0.20 * k`. On a 600px canvas, 400 therefore asks for a
 * 480px font, at which these two strings measure 15 360px (CJK) and 10 060px
 * (Latin) — 20-30x the 516px band, so `drawText` genuinely has to shrink them.
 * A string that only just overflowed would prove nothing.
 */
const OVERLONG = {
  cjk: '光落在该落的地方光落在该落的地方光落在该落的地方光落在该落的地方',
  // Latin resolves through -apple-system (SF Pro — a variable font here) and
  // its advance widths *do* change with weight: 712.57px at 400 vs 731.99px at
  // 700 for this string at 34px. The CJK fallback does not — it measures
  // 1088px at every weight from 300 to 800. That makes the Latin case the only
  // one below that can see a measure-at-one-weight / render-at-another bug.
  latin: 'The quick brown fox jumps over the lazy dog',
}

const OVERLONG_CFG = {
  anchor: 'bottom' as const,
  slots: [{ id: 'title' as const, size: 400, weight: 700, color: '#ffffff' }],
}

/**
 * ±1px absorbs antialiasing at the glyph edge. Measured on this machine, the
 * band is [42, 558] and the ink lands at [42, 557] (CJK) and [42, 556]
 * (Latin) — so the slack is 1px of real headroom on `minX`, not room to
 * spare. Do not widen it: a 1px overshoot is a real overshoot, and the
 * invariant is "never", not "usually".
 */
function expectInsideBand(r: { minX: number; maxX: number; W: number; allowed: number }): void {
  expect(r.maxX, 'drawText drew no ink at all — the test would pass vacuously').toBeGreaterThanOrEqual(0)
  expect(r.minX).toBeGreaterThanOrEqual(Math.floor((r.W - r.allowed) / 2) - 1)
  expect(r.maxX).toBeLessThanOrEqual(Math.ceil((r.W + r.allowed) / 2) + 1)
}

/** Renders `text` through `drawText` over a black canvas and returns the
 *  horizontal extent of anything lit up. */
async function inkExtent(page: Page, text: string) {
  return page.evaluate(
    ({ s, cfg }) => {
      const f = (window as any).__frame
      const { drawText } = (window as any).__frameCore
      const W = 600
      const H = 600

      f.setSize(W, H)
      const ctx = f.ctx()
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)

      drawText(ctx, { W, H }, cfg, { title: s }, { x: 0, y: 0, w: W, h: H }, 1)

      let minX = W
      let maxX = -1
      for (let y = 0; y < H; y++) {
        const row = f.sample(0, y, W, 1)
        for (let x = 0; x < W; x++) {
          // > 40 treats "more than ~15% coverage" as ink, so the scan is
          // slightly generous at the glyph edge: it fails early, never late.
          if (row[x * 4] > 40) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }
      }
      return { minX, maxX, W, allowed: W * 0.86 }
    },
    { s: text, cfg: OVERLONG_CFG },
  )
}

test('[RF-3] an overlong CJK title draws no ink outside its allowed band', async ({ page }) => {
  expectInsideBand(await inkExtent(page, OVERLONG.cjk))
})

test('[RF-3] an overlong Latin title draws no ink outside its allowed band', async ({ page }) => {
  expectInsideBand(await inkExtent(page, OVERLONG.latin))
})

/**
 * Guards the teeth of the Latin test above. If the Latin fixture ever stopped
 * discriminating — a font swap, a stack change in `frameFont` — that test would
 * go quietly unable to see a weight mismatch, so this pins the property it
 * depends on and reports failure rather than letting the guard decay. If this
 * fails, re-derive a discriminating string and weight pair; do not delete it.
 */
test('[RF-3] the Latin fixture discriminates weights, so a mismatch is detectable', async ({ page }) => {
  const m = await page.evaluate(() => {
    const f = (window as any).__frame
    const { measureToFit, frameFont } = (window as any).__frameCore
    const W = 600
    const H = 600
    f.setSize(W, H)
    const ctx = f.ctx()

    const s = 'The quick brown fox jumps over the lazy dog'
    const maxW = W * 0.86
    const base = (400 / 100) * H * 0.20 // the size `drawText` passes in

    ctx.font = frameFont(base, 400)
    const w400 = ctx.measureText(s).width
    ctx.font = frameFont(base, 700)
    const w700 = ctx.measureText(s).width

    // What a drawText that measured at 400 and rendered at 700 would draw.
    const fittedAt400 = measureToFit(ctx, s, maxW, (n: number) => frameFont(n, 400), base)
    ctx.font = frameFont(fittedAt400, 700)
    const mismatchedWidth = ctx.measureText(s).width

    // What the real one draws: measured and rendered at the same weight.
    const fittedAt700 = measureToFit(ctx, s, maxW, (n: number) => frameFont(n, 700), base)
    ctx.font = frameFont(fittedAt700, 700)
    const matchedWidth = ctx.measureText(s).width

    return { w400, w700, maxW, base, fittedAt400, fittedAt700, mismatchedWidth, matchedWidth }
  })

  // Same string, same size, different weight: the advances must differ at all.
  expect(m.w700, 'Latin advances no longer vary with weight — the guard is toothless').toBeGreaterThan(m.w400)
  // The lighter measurement therefore shrinks less, and the heavier render
  // spends that: 24.62px fitted at 400, rendered at 700, instead of 23.97px.
  expect(m.fittedAt400).toBeGreaterThan(m.fittedAt700)
  // And they must differ enough to be visible to the pixel scan above, whose
  // slack is ±1px: the mismatch overflows by ~14px, ~7px past each edge.
  expect(m.mismatchedWidth - m.maxW).toBeGreaterThan(4)
  // The matched path is the one the real drawText takes, and it fits.
  expect(m.matchedWidth).toBeLessThanOrEqual(m.maxW + 0.5)
  expect(m.mismatchedWidth).toBeGreaterThan(m.matchedWidth)
})
