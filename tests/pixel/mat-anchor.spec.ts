import { test, expect } from '@playwright/test'
import { matRect } from '../../src/core/geometry'

/**
 * The `'mat'` anchor: text in the white band below the photograph, which the
 * polaroid, postcard and spec-sheet templates all ask for.
 *
 * A note on `matRect`: the brief's listing resolved it through
 * `__frameCore.matRect`, which the dev block this suite runs against does not
 * carry (Task 8's block predates it, and Task 12's consolidated one is written
 * further down this same change). Calling it there would make the first run
 * fail with `matRect is not a function` — a missing handle, not the text
 * placement this test exists to pin. So the rect is resolved here, in Node,
 * from the very function `render` uses.
 */

const SIZE = { W: 600, H: 750 }
const FRAME = { x: 100, y: 100, w: 400, h: 400 }
/** the bottom mat, as polaroid (104) and spec-sheet (150) carry one */
const MAT_BOTTOM = 104
const MAT = matRect(FRAME, 16, MAT_BOTTOM, 1)
/**
 * The bottom band's edges, from the mat's own rect: it runs from the mat's
 * bottom edge less the bottom mat's depth (`MAT.y + MAT.h - MAT_BOTTOM`, which
 * is the photo's lower edge plus the side mat) down to the mat's bottom edge.
 *
 * Derived from `MAT` and `MAT_BOTTOM`, not from the row the scan starts at. An
 * assertion against the scan's own origin cannot fail — the loop's first
 * candidate row is `Math.round(origin)`, which is always past `origin - 1` —
 * and that is how the assertion this replaces read: true of every row the loop
 * could return, so `not.toBeNull()` was carrying the whole test.
 */
const BAND_TOP = MAT.y + MAT.h - MAT_BOTTOM
const BAND_BOTTOM = MAT.y + MAT.h

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('mat-anchored text lands inside the bottom band, not on the photo', async ({ page }) => {
  const result = await page.evaluate(
    ({ size, frame, mat, matBottom }) => {
      const f = (window as any).__frame
      const { drawText } = (window as any).__frameCore

      f.setSize(size.W, size.H)
      const ctx = f.ctx()
      ctx.clearRect(0, 0, size.W, size.H)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size.W, size.H)

      drawText(
        ctx,
        size,
        { anchor: 'mat', slots: [{ id: 'title', size: 26, weight: 400, color: '#000000' }] },
        { title: 'City Walk' },
        frame,
        1,
        matBottom,
      )

      // Every row of the *canvas* that the title puts ink on — the whole of it,
      // not the band: the scan has to be free to reach the photograph, or the
      // claim below that the title is not on one is a claim nothing can
      // violate. `title` is the only slot and is black, so any pixel under 100
      // in the red channel is glyph, not antialiasing.
      const darkRows: number[] = []
      for (let y = 0; y < size.H; y++) {
        const row = f.sample(Math.round(mat.x), y, Math.round(mat.w), 1)
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] < 100) {
            darkRows.push(y)
            break
          }
        }
      }
      return { first: darkRows[0] ?? null, last: darkRows[darkRows.length - 1] ?? null }
    },
    { size: SIZE, frame: FRAME, mat: MAT, matBottom: MAT_BOTTOM },
  )

  // Two claims, each measured against an edge of the mat's band rather than
  // against the scan: the title begins inside the band (it is not drawn on the
  // photograph, above the band's top edge) and ends inside it (it is not drawn
  // past the mat's bottom edge). Both edges come from `MAT`; the scan runs the
  // whole canvas, so either can be violated — a title anchored `top` lands
  // around y 55, one anchored `bottom` around y 660, and each reddens one of
  // these. The pair this replaces could not: the assertion read `first >=
  // scanOrigin - 1`, which every row the loop can return satisfies.
  expect(result.first, `no title ink on the canvas: ${JSON.stringify(result)}`).not.toBeNull()
  expect(
    result.first!,
    `the title starts above the mat's band (band top ${BAND_TOP}): ${JSON.stringify(result)}`,
  ).toBeGreaterThanOrEqual(BAND_TOP - 1)
  expect(
    result.last!,
    `the title runs past the mat's bottom edge (mat bottom ${BAND_BOTTOM}): ${JSON.stringify(result)}`,
  ).toBeLessThanOrEqual(BAND_BOTTOM + 1)
})

/**
 * The guard on the branch above, pinned: `drawText` only takes the `'mat'`
 * position when there is a bottom mat worth putting text in. A template with
 * none falls through to its default bottom position rather than drawing into a
 * band zero pixels tall.
 *
 * Asserted as an equivalence rather than against a row number, so it cannot go
 * red on a font whose metrics move the baseline: whatever `'bottom'` produces is
 * what a bottom-less `'mat'` must produce.
 */
test('a mat anchor with no bottom mat falls back to the bottom position', async ({ page }) => {
  const rows = await page.evaluate(({ size, frame }) => {
    const f = (window as any).__frame
    const { drawText } = (window as any).__frameCore
    const ctx = f.ctx()

    const inkRows = (anchor: 'mat' | 'bottom', matBottom: number): number[] => {
      f.setSize(size.W, size.H)
      ctx.clearRect(0, 0, size.W, size.H)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, size.W, size.H)
      drawText(
        ctx,
        size,
        { anchor, slots: [{ id: 'title', size: 26, weight: 400, color: '#000000' }] },
        { title: 'City Walk' },
        frame,
        1,
        matBottom,
      )
      const out: number[] = []
      for (let y = 0; y < size.H; y++) {
        const row = f.sample(0, y, size.W, 1)
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] < 100) {
            out.push(y)
            break
          }
        }
      }
      return out
    }

    return { matless: inkRows('mat', 0), bottom: inkRows('bottom', 0) }
  }, { size: SIZE, frame: FRAME })

  // Without ink on both sides the equality below is vacuous.
  expect(rows.bottom.length).toBeGreaterThan(0)
  expect(rows.matless.length).toBeGreaterThan(0)
  expect(rows.matless).toEqual(rows.bottom)
})
