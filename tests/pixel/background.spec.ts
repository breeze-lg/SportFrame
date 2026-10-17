import { test, expect } from '@playwright/test'

const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('无照片 with a sheet is that sheet; without one the wall is the app slate', async ({ page }) => {
  // 样张's authored `color` — the one record that has a sheet, because its plate
  // is printed on it.
  const filled = await page.evaluate(async () => {
    const f = (window as any).__frame
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample_2.jpg'
    })
    const photo = { el: img, width: img.naturalWidth, height: img.naturalHeight }
    const { drawBackground } = (window as any).__frameCore
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'mount', color: '#FFFFFF' }, photo, 1)
    return f.pixel(100, 100).slice(0, 3)
  })
  expect(filled).toEqual([255, 255, 255])
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

/**
 * `darken` is a percentage, and the assertion is the percentage it names rather
 * than "darker than it was". `darken: 64` composites `rgba(0, 0, 0, .64)` over
 * the blurred photo, so what survives is 0.36 of it — measured here at 0.362,
 * the 0.002 being the compositor's per-channel rounding.
 *
 * The band is tight on purpose. The old ceiling of 0.6 was 1.67x the real
 * ratio, so a wash applied at any strength between 0.36 and 0.60 — a darken
 * that read the slider as 0-255, say, or one applied twice at a lower opacity
 * — passed while producing a visibly different poster.
 */
test('darken lowers a blurred background to the ratio it names', async ({ page }) => {
  const [plain, darkened] = await page.evaluate(async () => {
    const f = (window as any).__frame
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample_2.jpg'
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
  const ratio = lum(darkened) / lum(plain)
  expect(ratio, `darken 64 left ${ratio.toFixed(3)} of the plain luminance`).toBeGreaterThan(0.33)
  expect(ratio, `darken 64 left ${ratio.toFixed(3)} of the plain luminance`).toBeLessThan(0.39)
})
