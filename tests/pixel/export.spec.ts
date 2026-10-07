import { test, expect } from '@playwright/test'
import { resolveSize } from '../../src/core/geometry'
import { MAX_CANVAS_AREA, MAX_CANVAS_EDGE } from '../../src/ui/export'

/**
 * Review Focus 5 — the canvas ceiling. The predicate alone is pinned in
 * `tests/unit/export.test.ts`; what lives here is the behaviour that predicate
 * drives: the 1× fallback, the recovery when the engine fails even though the
 * prediction passed, and the failure the user is left with when nothing fits.
 *
 * `exportPng` is reached through the interim `?dev=1` handle because the output
 * long edge is a constant 1440 in these stages — no UI path can ask for a 4×
 * export, so without the handle the guard would be untestable and deletable.
 */

const TEMPLATE = {
  id: 'test',
  name: 'test',
  layout: { kind: 'single' as const },
  canvas: { ratio: '4:5' as const },
  background: { mode: 'blur' as const, blur: 20, darken: 40, zoom: 120 },
  frame: { scale: 70, radius: 8, mat: 24, matBottom: 0, shadow: 40 },
}

/** The default canvas these stages ship: a 1440 long edge at 4:5. */
const DEFAULT = resolveSize('4:5', 1440)

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frameExport' in window)
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

test('[RF-5] the advertised 4x export is downgraded to 1x and still produces a real image', async ({
  page,
}) => {
  // The premise, in the numbers the browser sees: 4608×5760 — both edges legal
  // (under 16384) and 26.5 MP of area (over the 16.8 MP budget). An edge-only
  // guard waves this through, which is exactly the blank poster on iOS.
  expect(DEFAULT.W * 4).toBeLessThanOrEqual(MAX_CANVAS_EDGE)
  expect(DEFAULT.H * 4).toBeLessThanOrEqual(MAX_CANVAS_EDGE)
  expect(DEFAULT.W * 4 * (DEFAULT.H * 4)).toBeGreaterThan(MAX_CANVAS_AREA)

  const res = await page.evaluate(
    async ({ tpl, size }) => {
      const { exportPng } = (window as any).__frameExport
      const r = await exportPng({
        size,
        template: tpl,
        photos: [(window as any).__photo],
        text: {},
        exif: null,
        want: 4,
      })
      // Decode what the user would actually receive. WebKit's failure is
      // silent — a blank or absent image — so "no throw" proves nothing; the
      // bytes have to decode to opaque pixels at the downgraded dimensions.
      const bmp = await createImageBitmap(r.blob)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      const centre = Array.from(ctx.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data)
      return {
        k: r.k,
        downgraded: r.downgraded,
        filename: r.filename,
        bytes: r.blob.size,
        w: bmp.width,
        h: bmp.height,
        centre,
      }
    },
    { tpl: TEMPLATE, size: DEFAULT },
  )

  expect(res.k).toBe(1)
  expect(res.downgraded).toBe(true)
  // the file names the dimensions that were drawn, not the ones requested
  expect(res.filename).toMatch(/^frame_1152x1440_\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/)
  expect([res.w, res.h]).toEqual([DEFAULT.W, DEFAULT.H])
  expect(res.bytes).toBeGreaterThan(1000)
  expect(res.centre[3]).toBe(255)
})

test('[RF-5] a null encode — how WebKit reports an over-budget canvas — is retried at 1x', async ({
  page,
}) => {
  // 600×750 fits at 2× (1200×1500), so nothing here trips the prediction: the
  // first attempt reaches the encoder and comes back empty, as it does on iOS
  // when the canvas is over the cap. The retry is what has to recover.
  const res = await page.evaluate(
    async ({ tpl, size }) => {
      const proto = HTMLCanvasElement.prototype
      const real = proto.toBlob
      let calls = 0
      proto.toBlob = function (this: HTMLCanvasElement, cb: BlobCallback, type?: string, quality?: any) {
        calls += 1
        if (calls === 1) {
          cb(null)
          return
        }
        real.call(this, cb, type, quality)
      }
      try {
        const r = await (window as any).__frameExport.exportPng({
          size,
          template: tpl,
          photos: [(window as any).__photo],
          text: {},
          exif: null,
          want: 2,
        })
        return { k: r.k, downgraded: r.downgraded, filename: r.filename, bytes: r.blob.size, calls }
      } finally {
        proto.toBlob = real
      }
    },
    { tpl: TEMPLATE, size: { W: 600, H: 750 } },
  )

  expect(res.calls).toBe(2)
  expect(res.k).toBe(1)
  expect(res.downgraded).toBe(true)
  expect(res.filename).toMatch(/^frame_600x750_/)
  expect(res.bytes).toBeGreaterThan(1000)
})

test('[RF-5] when even 1x cannot be encoded the user gets the legible failure', async ({
  page,
}) => {
  // The retry must not swallow the failure: a canvas that cannot be encoded at
  // any scale still has to say so, in the app's words rather than the engine's.
  const msg = await page.evaluate(
    async ({ tpl, size }) => {
      const proto = HTMLCanvasElement.prototype
      const real = proto.toBlob
      proto.toBlob = function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(null)
      }
      try {
        await (window as any).__frameExport.exportPng({
          size,
          template: tpl,
          photos: [(window as any).__photo],
          text: {},
          exif: null,
          want: 2,
        })
        return 'resolved'
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      } finally {
        proto.toBlob = real
      }
    },
    { tpl: TEMPLATE, size: { W: 600, H: 750 } },
  )

  expect(msg).toBe('导出失败：图片太大，请降低输出长边')
})
