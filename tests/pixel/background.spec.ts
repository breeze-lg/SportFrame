import { test, expect } from '@playwright/test'

const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('solid mode fills the requested colour', async ({ page }) => {
  const px = await page.evaluate(async () => {
    const f = (window as any).__frame
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    const { drawBackground } = (window as any).__frameCore
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'solid', color: '#102030' }, null, 1)
    return f.pixel(100, 100)
  })
  expect(px.slice(0, 3)).toEqual([16, 32, 48])
})

test('an empty canvas with no photo paints #2a3238', async ({ page }) => {
  const px = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    const { drawBackground } = (window as any).__frameCore
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur' }, null, 1)
    return f.pixel(100, 100)
  })
  expect(px.slice(0, 3)).toEqual([42, 50, 56])
})

test('darken lowers the luminance of a blurred background', async ({ page }) => {
  const [plain, darkened] = await page.evaluate(async () => {
    const f = (window as any).__frame
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample.webp'
    })
    const photo = { el: img, width: img.naturalWidth, height: img.naturalHeight }
    f.setSize(200, 200)
    const ctx = f.ctx()
    const { drawBackground } = (window as any).__frameCore

    ctx.clearRect(0, 0, 200, 200)
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur', blur: 20, darken: 0 }, photo, 1)
    const a = f.pixel(100, 100)

    ctx.clearRect(0, 0, 200, 200)
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur', blur: 20, darken: 64 }, photo, 1)
    const b = f.pixel(100, 100)

    return [a, b]
  })
  expect(lum(darkened)).toBeLessThan(lum(plain) * 0.6)
})
