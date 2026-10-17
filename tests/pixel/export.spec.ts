import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveSize } from '../../src/core/geometry'
import { MAX_CANVAS_AREA, MAX_CANVAS_EDGE, PREMIUM_CANVAS_AREA } from '../../src/ui/export'

/**
 * Review Focus 5 — the canvas ceiling, and Task 17's premium rung on top of it.
 * The predicates alone are pinned in `tests/unit/export.test.ts`; what lives
 * here is the behaviour they drive: which rung a request draws at, the fall
 * down the ladder when the engine refuses a canvas even though the budget
 * allowed it, and the failure the user is left with when nothing fits.
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
      img.src = '/sample/sample_2.jpg'
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

/**
 * The one test here that drives the app rather than `exportPng`: the save
 * button is the seam Task 12 wired, and until a photo can be put on the wall
 * and exported at a real scale through the real UI, "the app exports" is a
 * claim about a code path nothing has run.
 *
 * It also pins the number the whole export exists to produce. The dimensions
 * the ceremony states come from `state.size` — the canvas `draw()` laid out at
 * k=1 — times the scale the export actually drew at. If the preview ever grew a
 * second layout path, the poster the user is told about here would stop being
 * the poster they saw.
 */
test('the save button exports at 2x and the ceremony states what was drawn', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/jpeg',
    buffer: readFileSync(resolve('public/sample/sample_2.jpg')),
  })
  await expect(page.locator('canvas#cv')).toBeVisible()

  await page.click('#save')

  // 6.6 MP to encode, so this one gets a longer leash than the default
  await expect(page.locator('.ceremony')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('.ceremony-dims')).toHaveText(`${DEFAULT.W * 2} × ${DEFAULT.H * 2} PNG`)
  const src = await page.locator('.ceremony img').getAttribute('src')
  expect(src?.startsWith('data:image/png')).toBe(true)
})

test('[RF-5] the advertised 4x export is drawn, not downgraded, where the device admits it', async ({
  page,
}) => {
  // The premise, in the numbers the browser sees: 4608×5760 — both edges legal
  // (under 16384), 26.5 MP of area. Over the floor every device honours, which
  // is why Task 9 downgraded this everywhere including desktop; inside WebKit's
  // raised 8192² cap, which is what makes it deliverable at all. §10 sells 4×
  // as the premium unlock, and this is the assertion that keeps that unlock
  // from being hollow.
  expect(DEFAULT.W * 4).toBeLessThanOrEqual(MAX_CANVAS_EDGE)
  expect(DEFAULT.H * 4).toBeLessThanOrEqual(MAX_CANVAS_EDGE)
  expect(DEFAULT.W * 4 * (DEFAULT.H * 4)).toBeGreaterThan(MAX_CANVAS_AREA)
  expect(DEFAULT.W * 4 * (DEFAULT.H * 4)).toBeLessThanOrEqual(PREMIUM_CANVAS_AREA)

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
      // bytes have to decode to opaque pixels at the requested dimensions.
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

  expect(res.k).toBe(4)
  expect(res.downgraded).toBe(false)
  expect(res.filename).toMatch(/^frame_4608x5760_\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/)
  expect([res.w, res.h]).toEqual([DEFAULT.W * 4, DEFAULT.H * 4])
  expect(res.bytes).toBeGreaterThan(1000)
  expect(res.centre[3]).toBe(255)
})

/**
 * 无照片 is a claim about the *file*, and the claim is a size: a 1000×1000 poster
 * whose photograph and border measure 800×800 is written at 800×800. The two other
 * modes are the control — same template, same photograph, full canvas — so a crop
 * that leaked into 带背景, or a canvas that leaked into 无照片, is what this catches.
 * The bytes are decoded rather than the model read: the dimensions in a PNG header
 * are the ones the user gets.
 *
 * The numbers come from the mount's own arithmetic, restated here on purpose:
 * `polaroid` is 64% of a 1152×1440 canvas — 737×922 — with mat 16 and matBottom 104,
 * so the card is 769 wide and 1058 tall. (The ratio is the template's own, not the
 * photograph's: a `4:5` canvas lays every photograph out at 4:5.)
 */
test('无照片 exports at the mount’s own size, and 带背景 at the canvas’s', async ({ page }) => {
  const shots = await page.evaluate(async () => {
    const { exportPng } = (window as any).__frameExport
    const base = {
      id: 't',
      name: 't',
      layout: { kind: 'single' },
      canvas: { ratio: '4:5' },
      frame: { scale: 64, radius: 0, mat: 16, matBottom: 104, shadow: 0 },
    }
    const out: { mode: string; w: number; h: number; corner: number[]; inside: number[] }[] = []
    for (const mode of ['blur', 'mount']) {
      const r = await exportPng({
        size: { W: 1152, H: 1440 },
        template: { ...base, background: { mode, blur: 20, zoom: 118, darken: 0 } },
        photos: [(window as any).__photo],
        text: {},
        exif: null,
        want: 1,
      })
      const bmp = await createImageBitmap(r.blob)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      out.push({
        mode,
        w: bmp.width,
        h: bmp.height,
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        inside: Array.from(ctx.getImageData(8, 8, 1, 1).data),
      })
    }
    return out
  })
  const by = Object.fromEntries(shots.map((s) => [s.mode, s]))

  // The canvas for 带背景, and the mount's own box for 无照片: same two functions the
  // screen canvas, the export ladder and the size beside the rack all ask.
  expect([by.blur!.w, by.blur!.h]).toEqual([1152, 1440])
  expect(by.blur!.corner[3]).toBe(255)

  // ...and no canvas at all: the mount's own box, which is the photograph plus a
  // 16px border on three sides and 104px below.
  expect([by.mount!.w, by.mount!.h]).toEqual([769, 1058])
  // The card fills the file, and tightly: 8px in from the file's own edge is the
  // card's white border rather than a background.
  expect(Array.from(by.mount!.inside)).toEqual([255, 255, 255, 255])
  expect(by.mount!.w).toBeLessThan(by.blur!.w)
  expect(by.mount!.h).toBeLessThan(by.blur!.h)
})

test('[RF-5] a device that refuses the 4x canvas falls to the best rung it can hold', async ({
  page,
}) => {
  // WebKit's refusal is not an exception: the canvas takes the draws and keeps
  // none of them, and `toBlob` hands back null — the blank poster Task 9
  // closed, and the reason the premium budget cannot simply be a bigger
  // constant. Staged here by answering `getImageData` with zeros for any canvas
  // over the floor, which is the shape a phone in WebKit's 4096² tier presents.
  // The export's own check is what has to notice, and the rung below — held to
  // the floor — is what has to catch it.
  const res = await page.evaluate(
    async ({ tpl, size, floor }) => {
      const proto = CanvasRenderingContext2D.prototype
      const real = proto.getImageData
      proto.getImageData = function (
        this: CanvasRenderingContext2D,
        ...args: [number, number, number, number]
      ) {
        // a canvas that stores nothing answers with nothing
        if (this.canvas.width * this.canvas.height > floor) return new ImageData(args[2], args[3])
        return real.apply(this, args)
      }
      try {
        const r = await (window as any).__frameExport.exportPng({
          size,
          template: tpl,
          photos: [(window as any).__photo],
          text: {},
          exif: null,
          want: 4,
        })
        const bmp = await createImageBitmap(r.blob)
        return {
          k: r.k,
          downgraded: r.downgraded,
          filename: r.filename,
          bytes: r.blob.size,
          w: bmp.width,
          h: bmp.height,
        }
      } finally {
        proto.getImageData = real
      }
    },
    { tpl: TEMPLATE, size: DEFAULT, floor: MAX_CANVAS_AREA },
  )

  // One rung down, not two: 2× is 6.6 MP and fits the floor, so the user gets
  // the largest file their device can hold rather than the smallest we can draw.
  expect(res.k).toBe(2)
  expect(res.downgraded).toBe(true)
  expect(res.filename).toMatch(/^frame_2304x2880_\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.png$/)
  expect([res.w, res.h]).toEqual([DEFAULT.W * 2, DEFAULT.H * 2])
  expect(res.bytes).toBeGreaterThan(1000)
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
