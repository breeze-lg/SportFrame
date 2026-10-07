import { test, expect } from '@playwright/test'

const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

const TEMPLATE = {
  id: 'test',
  name: 'test',
  layout: { kind: 'single' as const },
  canvas: { ratio: '1:1' as const },
  background: { mode: 'blur' as const, blur: 20, darken: 40, zoom: 120 },
  frame: { scale: 70, radius: 8, mat: 24, matBottom: 0, shadow: 40 },
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
  await page.evaluate(async () => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample.webp'
    })
    ;(window as any).__photo = {
      el: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      name: 'sample',
      exif: null,
    }
  })
})

test('render paints the mat white and the background darker than it', async ({ page }) => {
  // At this template the frame is 70% of a 600px canvas, so the photograph
  // covers x 90..510 and the mat is the 23px border around it: (300, 78) is
  // mat, the canvas centre is the photograph itself, (4, 4) is background.
  const [mat, centre, corner] = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    f.setSize(600, 600)
    const { render } = (window as any).__frameCore
    render({
      ctx: f.ctx(),
      size: { W: 600, H: 600 },
      k: 1,
      template: tpl,
      photos: [(window as any).__photo],
      text: {},
      exif: null,
    })
    return [f.pixel(300, 78), f.pixel(300, 300), f.pixel(4, 4)]
  }, TEMPLATE)

  expect(mat.slice(0, 3)).toEqual([255, 255, 255])
  // the photograph is drawn over the mat, not under it
  expect(centre.slice(0, 3)).not.toEqual([255, 255, 255])
  expect(lum(corner)).toBeLessThan(200)
})

test('k=2 fills twice the area of k=1', async ({ page }) => {
  const [a, b] = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    const { render } = (window as any).__frameCore
    const load = {
      template: tpl,
      photos: [(window as any).__photo],
      text: {},
      exif: null,
    }
    // The seam where the mat starts is the boundary this can be measured on
    // exactly: the darkened background never reaches 250 and the mat is flat
    // white, so the first such pixel on the centre row is the mat's left edge,
    // and the photograph's frame sits a fixed distance inside it. A pixel of
    // the photograph cannot carry the assertion — Chromium resamples the same
    // source through different filters at 0.66x and 1.32x, so a high-contrast
    // pixel moves a few levels even when the geometry has not moved at all.
    const matEdge = (len: number, y: number): number => {
      const row = f.sample(0, y, len, 1)
      for (let x = 0; x < len; x++) {
        if (row[x * 4]! >= 250 && row[x * 4 + 1]! >= 250) return x
      }
      return -1
    }

    f.setSize(600, 600)
    render({ ctx: f.ctx(), size: { W: 600, H: 600 }, k: 1, ...load })
    const a = { edge: matEdge(600, 300), mat: f.pixel(300, 78) }

    f.setSize(1200, 1200)
    const ctx = f.ctx()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    render({ ctx, size: { W: 600, H: 600 }, k: 2, ...load })
    return [a, { edge: matEdge(1200, 600), mat: f.pixel(600, 156) }]
  }, TEMPLATE)

  expect(b.edge).toBe(a.edge * 2)
  expect(b.mat.slice(0, 3)).toEqual(a.mat.slice(0, 3))
})

test('render with no photo does not throw', async ({ page }) => {
  const ok = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    f.setSize(300, 300)
    const { render } = (window as any).__frameCore
    try {
      render({
        ctx: f.ctx(),
        size: { W: 300, H: 300 },
        k: 1,
        template: tpl,
        photos: [],
        text: {},
        exif: null,
      })
      return true
    } catch {
      return false
    }
  }, TEMPLATE)
  expect(ok).toBe(true)
})
