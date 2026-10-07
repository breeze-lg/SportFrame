import { test, expect } from '@playwright/test'

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
