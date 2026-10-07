import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('the mat fills its rect with pure white', async ({ page }) => {
  const px = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 400, 400)
    const { drawMat } = (window as any).__frameCore
    drawMat(ctx, { x: 100, y: 100, w: 200, h: 200 }, 0, 0, 1)
    return f.pixel(200, 200)
  })
  expect(px.slice(0, 3)).toEqual([255, 255, 255])
  expect(px[3]).toBe(255)
})

/**
 * Two claims about where the bevel is, and one about what it is drawn against.
 *
 * The reference pixel is a deep interior one — the mat's own surface, nowhere
 * near anything the rasteriser has to decide. The obvious alternative, sampling
 * a pixel 1px inside the mat's edge, makes the assertion a claim about the
 * fill's antialiasing as much as about the bevel: the two pixels are only
 * `BEVEL_INSET` apart, so a bevel at 4 or 6 would still pass as long as the
 * edge pixel were dimmed too. Sampling the interior removes that coupling, and
 * with it the ±1px of slack the old reference left in the constant.
 *
 * `BEVEL_INSET` is 5 and the stroke is 1px wide, centred on the path at x=105,
 * so the ink lands on x=104 and x=105. x=101 is therefore a third claim: the
 * bevel is not drawn against the mat's edge.
 */
test('the bevel line is drawn at inset 5px', async ({ page }) => {
  const [interior, bevel, nearEdge] = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 400, 400)
    const { drawMat } = (window as any).__frameCore
    drawMat(ctx, { x: 100, y: 100, w: 200, h: 200 }, 0, 0, 1)
    return [f.pixel(200, 200), f.pixel(105, 200), f.pixel(101, 200)]
  })
  const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

  // the mat's surface is untouched white, so the reference is not a claim
  expect(interior).toEqual([255, 255, 255, 255])
  // and the bevel is a real line on it: 245 against 255, not a rounding wobble
  expect(lum(bevel)).toBeLessThan(250)
  // while 4px inside the mat's edge there is nothing at all
  expect(nearEdge).toEqual(interior)
})
