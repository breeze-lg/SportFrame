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
    // white, so the first such pixel running in from an edge is the mat's
    // left/top edge, and the photograph's frame sits a fixed distance inside
    // it. Both axes are scanned: a y-only scaling bug would slip past a row
    // scan, and the mat's 1px inset is applied on both.
    const matEdge = (len: number, across: number, axis: 'row' | 'col'): number => {
      const line = axis === 'row' ? f.sample(0, across, len, 1) : f.sample(across, 0, 1, len)
      for (let i = 0; i < len; i++) {
        if (line[i * 4]! >= 250 && line[i * 4 + 1]! >= 250) return i
      }
      return -1
    }

    // Mean of an n x n device patch centred on (cx, cy).
    const patchMean = (cx: number, cy: number, n: number): number[] => {
      const d = f.sample(Math.round(cx - n / 2), Math.round(cy - n / 2), n, n)
      let r = 0
      let g = 0
      let b = 0
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]!
        g += d[i + 1]!
        b += d[i + 2]!
      }
      const area = n * n
      return [r / area, g / area, b / area]
    }

    f.setSize(600, 600)
    render({ ctx: f.ctx(), size: { W: 600, H: 600 }, k: 1, ...load })
    const a = {
      edgeX: matEdge(600, 300, 'row'),
      edgeY: matEdge(600, 300, 'col'),
      mat: f.pixel(300, 78),
      // inside the photograph, which covers 90..509 on both axes at this
      // template and scale
      photo: patchMean(300, 300, 8),
    }

    f.setSize(1200, 1200)
    const ctx = f.ctx()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    render({ ctx, size: { W: 600, H: 600 }, k: 2, ...load })
    return [
      a,
      {
        edgeX: matEdge(1200, 600, 'row'),
        edgeY: matEdge(1200, 600, 'col'),
        mat: f.pixel(600, 156),
        // the same patch in logical units: the photograph covers 180..1019
        // here, so 16 device pixels at k=2 is the 8 at k=1 doubled
        photo: patchMean(600, 600, 16),
      },
    ]
  }, TEMPLATE)

  expect(b.edgeX).toBe(a.edgeX * 2)
  expect(b.edgeY).toBe(a.edgeY * 2)
  expect(b.mat.slice(0, 3)).toEqual(a.mat.slice(0, 3))

  // The photograph's *content* must not change with `k`. `k` is the on-screen
  // scale and export renders at k=1, so an image whose content moved with
  // scale is one the user exports having never seen it — the worst case this
  // architecture has. No single pixel can carry this: Chromium resamples the
  // same source through different filters at 0.66x and 1.32x, so a
  // high-contrast pixel moves up to 8 levels even when nothing has moved.
  // Patch means can: averaging removes that local jitter, while a misplaced or
  // mis-scaled photograph samples a different neighbourhood and moves the mean
  // by tens of levels — a one-logical-pixel displacement moves it by 59.
  // Measured here, the two means differ by 0.18/0.19/0.16 per channel.
  for (let ch = 0; ch < 3; ch++) {
    expect(
      Math.abs(a.photo[ch]! - b.photo[ch]!),
      `photo patch mean moved with k: k=1 ${a.photo} vs k=2 ${b.photo}`,
    ).toBeLessThanOrEqual(2)
  }
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
