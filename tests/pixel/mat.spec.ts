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
 * 白边 carries no line of its own.
 *
 * The card is paper: `drawMat` fills it and draws nothing on it. The bevel is a cut
 * at the *window* (`drawBevel`), and it used to be a hairline `BEVEL_INSET` inside
 * the card's edge instead — invisible under the photograph on three sides, and a
 * frame drawn across the bottom band on the fourth, which is the line a 拍立得
 * export showed. Both halves of the contract are pinned here: the surface has no ink
 * anywhere, and the bevel lands exactly on the rect it is handed.
 */
test('the card is paper — no line on it — and the bevel goes where it is handed', async ({ page }) => {
  const out = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    const { drawMat, drawBevel } = (window as any).__frameCore
    const card = { x: 100, y: 100, w: 200, h: 200 }

    ctx.clearRect(0, 0, 400, 400)
    drawMat(ctx, card, 0, 0, 1)
    // interior, and the four bands where the old bevel used to run (5px in from the
    // edge, on every side)
    const surface = [
      f.pixel(200, 200),
      f.pixel(105, 200),
      f.pixel(295, 200),
      f.pixel(200, 105),
      f.pixel(200, 295),
    ]

    ctx.clearRect(0, 0, 400, 400)
    drawBevel(ctx, card, 0, 1)
    // a 1px stroke centred on the path: the boundary pixel is inked, and both 4px
    // *inside* (where the old card-edge bevel used to run) and just outside are not
    const bevel = [f.pixel(100, 200), f.pixel(96, 200), f.pixel(105, 200)]
    return { surface, bevel }
  })

  for (const p of out.surface) expect(p).toEqual([255, 255, 255, 255])
  // ink on the boundary — 9% ink at half coverage is ~11/255 — and nothing 4px
  // inside it, which is where a bevel on the *card* would have been drawn instead
  expect(out.bevel[0]![3]!).toBeGreaterThan(4)
  expect(out.bevel[0]![3]!).toBeLessThan(160)
  expect(out.bevel[1]).toEqual([0, 0, 0, 0])
  expect(out.bevel[2]).toEqual([0, 0, 0, 0])
})
