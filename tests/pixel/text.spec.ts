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
//
// That promise is two claims, and they are asserted as two claims so that a
// red run says which one broke:
//
//   (a) the render honoured the size the fit chose — the ink lies inside the
//       advance box `ctx.measureText` reports for the fitted string, in this
//       browser, with this font. Comparing the render against the current
//       environment's *own* measurement is what makes this half
//       font-independent: a metrics change moves both sides together, instead
//       of turning the test red for a defect that is not there.
//   (b) the fit itself succeeded — that measured box lies inside the band.
//       No rasterisation is involved in this half at all.
//
// Neither half is compared against a width hard-coded from a measurement made
// on one particular machine. The old single assertion compared the ink
// directly against the band, which left 0.08px of physical margin per edge
// (the fit shrinks to *exactly* the band) and made a rasteriser or font
// metrics change look like a regression.
// ---------------------------------------------------------------------------

/**
 * `size` in a slot is a scale input, not px: `drawText` turns it into
 * `(size / 100) * H * 0.20 * k`. On a 600px canvas, 400 therefore asks for a
 * 480px font, at which these two strings measure 15 360px (CJK) and 10 334px
 * (Latin) — 29.8x and 20.0x the 516px band, so `drawText` genuinely has to
 * shrink them. A string that only just overflowed would prove nothing, so
 * `expectGenuinelyOverflows` below re-checks that property on every run
 * rather than trusting this comment to stay true.
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
 * What one `drawText` call did, harvested from the page.
 *
 * `minX`/`maxX` are the *ink*: the horizontal extent of the pixels the render
 * lit up. `boxLeft`/`boxRight` are the *measured* advance box of the fitted
 * string — `ctx.measureText` at the size the fit returned, with the font
 * `drawText` builds from that size. These are deliberately different
 * quantities, and the assertions below keep them apart: ink outside a good box
 * means the render ignored the fit; a box outside the band means the fit
 * itself was wrong.
 */
type TextProbe = {
  /** leftmost lit pixel column, or `W` if nothing was drawn */
  minX: number
  /** rightmost lit pixel column, or -1 if nothing was drawn */
  maxX: number
  W: number
  /** the width `drawText` may use: `W * 0.86 * k` */
  allowed: number
  /** the unfitted font size `drawText` starts from: `(slot.size / 100) * H * 0.20 * k` */
  base: number
  /** the size `measureToFit` returned for this string */
  fitted: number
  /** what the string wants at `base`, before any shrinking */
  unfittedWidth: number
  /** what the string measures at `fitted`, i.e. after shrinking */
  fittedWidth: number
  /** left edge of that advance box, centred on `W / 2` by textAlign 'center' */
  boxLeft: number
  /** right edge of that advance box */
  boxRight: number
}

/** Renders `text` through `drawText` over a black canvas, scans the pixels it
 *  lit, and measures the same string the same way `drawText` measures it. */
async function probeText(page: Page, text: string): Promise<TextProbe> {
  return page.evaluate(
    ({ s, cfg }) => {
      const f = (window as any).__frame
      const { drawText, measureToFit, frameFont } = (window as any).__frameCore
      const W = 600
      const H = 600
      const k = 1
      const allowed = W * 0.86 * k
      // OVERLONG_CFG has exactly one slot, so these reads are non-null.
      const { size, weight } = cfg.slots[0]!
      const base = (size / 100) * H * 0.20 * k

      f.setSize(W, H)
      const ctx = f.ctx()
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)

      drawText(ctx, { W, H }, cfg, { title: s }, { x: 0, y: 0, w: W, h: H }, k)

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

      // Measure with the very font `drawText` is contracted to render with:
      // the same helper, the same arguments, the same weight. Nothing here is
      // read back from the drawn canvas, and nothing is hard-coded.
      ctx.font = frameFont(base, weight)
      const unfittedWidth = ctx.measureText(s).width
      const fitted = measureToFit(ctx, s, allowed, (n: number) => frameFont(n, weight), base)
      ctx.font = frameFont(fitted, weight)
      const fittedWidth = ctx.measureText(s).width
      const cx = W * 0.5 * k // textAlign 'center', so the box straddles `cx`

      return {
        minX,
        maxX,
        W,
        allowed,
        base,
        fitted,
        unfittedWidth,
        fittedWidth,
        boxLeft: cx - fittedWidth / 2,
        boxRight: cx + fittedWidth / 2,
      }
    },
    { s: text, cfg: OVERLONG_CFG },
  )
}

/**
 * "Something was drawn at all" — asserted before anything about *where*, since
 * on an empty canvas every "inside" claim below is vacuously true. `maxX`
 * starts at -1 and only grows when a pixel is lit, so this is exactly the
 * emptiness guard.
 */
function expectSomethingWasDrawn(p: TextProbe): void {
  expect(p.maxX, 'drawText drew no ink at all — the test would pass vacuously').toBeGreaterThanOrEqual(0)
}

/**
 * [Finding 2] The fixture must still be a wide-margin overflow, or the two
 * assertions below decay into "a short string draws inside its box" and pass
 * no matter what `drawText` does. Measured on this machine: the CJK fixture
 * wants 15 360px at the 480px `base` and the Latin 10 334px, against a 516px
 * band — 29.8x and 20.0x over, so shrinking is not a close call.
 *
 * The 8x threshold (4 128px here) is deliberately far below those ratios and
 * far above 1x: 2.5x of headroom under the smaller measurement, so honest font
 * variation cannot make this a false red, while anything that stops
 * overflowing by an order of magnitude — a smaller `size`, a shorter fixture,
 * a font whose advances collapse — fails loudly instead of silently
 * defanging the tests.
 */
function expectGenuinelyOverflows(p: TextProbe): void {
  expect(
    p.unfittedWidth,
    `the fixture wants ${p.unfittedWidth.toFixed(1)}px at size ${p.base} against a ` +
      `${p.allowed}px band: it no longer overflows by a wide margin, so shrinking is ` +
      `not required and these tests would prove nothing`,
  ).toBeGreaterThan(p.allowed * 8)
}

/**
 * [Finding 1, part (b)] The fit succeeded: the box the fitted string measures
 * is inside the band. This is the real invariant, and rasterisation plays no
 * part in it — both sides are `measureText` output.
 *
 * The 0.5px tolerance is the same one `[RF-3] an overlong title shrinks…`
 * above uses on the same quantity, and it absorbs sub-pixel non-linearity in
 * how advances scale with font size. Measured here the fit lands 0.08px inside
 * the band per edge (box [42.08, 557.92] against band [42, 558]), so 0.5px is
 * ~6x the observed residual. It cannot hide a real fit failure: with no
 * shrinking at all the CJK fixture's box is 14 844px wider than the band, so
 * the miss is four orders of magnitude larger than the tolerance.
 */
function expectFitInsideBand(p: TextProbe): void {
  expect(p.boxLeft).toBeGreaterThanOrEqual((p.W - p.allowed) / 2 - 0.5)
  expect(p.boxRight).toBeLessThanOrEqual((p.W + p.allowed) / 2 + 0.5)
}

/**
 * [Finding 1, part (a)] The render honoured the fit: every lit pixel lies
 * inside the advance box `ctx.measureText` reports *in this browser*, ±1px for
 * antialiasing at the glyph edge. Because the expectation is the environment's
 * own measurement rather than a width baked in here, a font metrics change
 * moves both sides together and cannot turn this red on its own — only a
 * render that ignores the fitted size can.
 *
 * The ±1px covers the measured residual, which is 0.08px: the ink's edge pixel
 * sits at x=42 (CJK and Latin) while the box starts at x=42.08. Do not widen
 * it: a 1px overshoot is a real overshoot, and the invariant is "never", not
 * "usually". With `expectFitInsideBand` above, the composition still bounds
 * the ink at the band edge + 1.5px.
 */
function expectInkInsideMeasuredBox(p: TextProbe): void {
  expect(p.minX).toBeGreaterThanOrEqual(p.boxLeft - 1)
  expect(p.maxX).toBeLessThanOrEqual(p.boxRight + 1)
}

// Ordered so a failure is read in cause order: nothing drawn (vacuous) →
// fixture no longer overflows (vacuous) → the fit is wrong → the render
// ignored the fit.
test('[RF-3] an overlong CJK title draws no ink outside its allowed band', async ({ page }) => {
  const p = await probeText(page, OVERLONG.cjk)
  expectSomethingWasDrawn(p)
  expectGenuinelyOverflows(p)
  expectFitInsideBand(p)
  expectInkInsideMeasuredBox(p)
})

test('[RF-3] an overlong Latin title draws no ink outside its allowed band', async ({ page }) => {
  const p = await probeText(page, OVERLONG.latin)
  expectSomethingWasDrawn(p)
  expectGenuinelyOverflows(p)
  expectFitInsideBand(p)
  expectInkInsideMeasuredBox(p)
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

// ---------------------------------------------------------------------------
// More than one slot on one anchor
//
// The anchor used to position each slot independently, which is invisible on a
// one-slot template and wrong on a two-slot one: 经典 declares a title and a
// subtitle, both anchored `bottom`, and both were drawn on `H * 0.90` — the
// subtitle printed through the title. `drawText` now stacks a block, so these
// pin the property that makes that impossible rather than the arithmetic that
// happens to produce it: N lines occupy N separated bands of ink, and the end
// of the block the anchor names is where the block actually ends.
// ---------------------------------------------------------------------------

type Bands = { bands: number[][]; H: number }

/** Lit row bands on a black canvas, grouped contiguous rows per band. */
async function inkBands(page: Page, anchor: string, slots: unknown[], values: object): Promise<Bands> {
  return page.evaluate(
    ({ anchor, slots, values }) => {
      const f = (window as any).__frame
      const { drawText } = (window as any).__frameCore
      const W = 600
      const H = 600
      f.setSize(W, H)
      const ctx = f.ctx()
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)

      drawText(ctx, { W, H }, { anchor, slots }, values, { x: 0, y: 0, w: W, h: H }, 1)

      const bands: number[][] = []
      for (let y = 0; y < H; y++) {
        const row = f.sample(0, y, W, 1)
        let lit = false
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] > 40) {
            lit = true
            break
          }
        }
        const last = bands[bands.length - 1]
        if (!lit) continue
        if (last && y === last[1]! + 1) last[1] = y
        else bands.push([y, y])
      }
      const rows = bands.reduce((n, b) => n + (b[1]! - b[0]! + 1), 0)
      return { bands, H, rows }
    },
    { anchor, slots, values },
  )
}

/** 经典's own pair, in its own order, at the anchor it declares. */
const CLASSIC_PAIR = [
  { id: 'sub', size: 14, weight: 500, color: '#ffffff' },
  { id: 'title', size: 34, weight: 700, color: '#ffffff' },
]
const CLASSIC_WORDS = { sub: 'F/8 · 85mm', title: '经典' }

test('two bottom-anchored slots stack, and the block ends at the bottom margin', async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)

  const r = await inkBands(page, 'bottom', CLASSIC_PAIR, CLASSIC_WORDS)

  // Overprinting draws both slots on one baseline and produces ONE band. Two
  // bands is the whole point, and a gap of more than a row between them is what
  // says they are two lines rather than two glyph runs sharing an edge.
  expect(r.bands.length, `expected two lines of ink, got ${JSON.stringify(r.bands)}`).toBe(2)
  const gap = r.bands[1]![0]! - r.bands[0]![1]!
  expect(gap, `the two lines are ${gap}px apart`).toBeGreaterThan(2)

  // `bottom` names the *end* of the block: the last line is the one on the
  // margin. A block anchored by its first line would leave this ~40px low.
  const lastBaseline = Math.abs(r.bands[1]![1]! - r.H * 0.9)
  expect(lastBaseline, `the block ends ${lastBaseline}px from H*0.90`).toBeLessThan(15)
})

test('three top-anchored slots stack too, including the sign the templates never declare', async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)

  const r = await inkBands(
    page,
    'top',
    [
      { id: 'title', size: 34, weight: 700, color: '#ffffff' },
      { id: 'sub', size: 18, weight: 500, color: '#ffffff' },
      { id: 'sign', size: 12, weight: 400, color: '#ffffff' },
    ],
    { title: '经典', sub: 'F/8 · 85mm', sign: '@Breeze' },
  )

  // Three slots, three bands. `sign` is the one that used to be unable to
  // render anywhere but on the title's baseline.
  expect(r.bands.length, `expected three lines of ink, got ${JSON.stringify(r.bands)}`).toBe(3)
  for (let i = 1; i < r.bands.length; i++) {
    expect(r.bands[i]![0]! - r.bands[i - 1]![1]!, `lines ${i - 1}/${i} overlap`).toBeGreaterThan(0)
  }
  // `top` names the *start* of the block, so the first line is the high one.
  expect(r.bands[0]![0]!).toBeLessThan(r.H * 0.25)
})
