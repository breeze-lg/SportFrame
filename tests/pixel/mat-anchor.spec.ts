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
/** where the bottom band begins: the photo's lower edge plus the side mat */
const BAND_TOP = FRAME.y + FRAME.h + 16

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('mat-anchored text lands inside the bottom band, not on the photo', async ({ page }) => {
  const result = await page.evaluate(
    ({ size, frame, mat, matBottom, bandTop }) => {
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

      // Every row of the bottom band that the title puts ink on. `title` is the
      // only slot and is black, so any pixel under 100 in the red channel is
      // glyph, not antialiasing.
      const darkRows: number[] = []
      for (let y = Math.round(bandTop); y < Math.round(mat.y + mat.h); y++) {
        const row = f.sample(Math.round(mat.x), y, Math.round(mat.w), 1)
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] < 100) {
            darkRows.push(y)
            break
          }
        }
      }
      return { first: darkRows[0] ?? null, last: darkRows[darkRows.length - 1] ?? null, bandTop }
    },
    { size: SIZE, frame: FRAME, mat: MAT, matBottom: MAT_BOTTOM, bandTop: BAND_TOP },
  )

  expect(result.first).not.toBeNull()
  expect(result.first!).toBeGreaterThanOrEqual(result.bandTop - 1)
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
