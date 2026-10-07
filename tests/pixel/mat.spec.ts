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

test('the bevel line is drawn at inset 5px', async ({ page }) => {
  const [edge, bevel] = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 400, 400)
    const { drawMat } = (window as any).__frameCore
    drawMat(ctx, { x: 100, y: 100, w: 200, h: 200 }, 0, 0, 1)
    return [f.pixel(102, 200), f.pixel(105, 200)]
  })
  const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!
  expect(lum(bevel)).toBeLessThan(lum(edge))
})
