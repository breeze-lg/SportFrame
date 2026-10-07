import { test, expect, type Page } from '@playwright/test'
import { aspectOf, fitRect, matRect, resolveSize } from '../../src/core/geometry'
import { getTemplate } from '../../src/core/templates'

/**
 * The 样张 spec plate — Review Focus 2's invariant, in two layers.
 *
 * The plate is the product's differentiator: it reads the photograph's own
 * camera settings and captions the poster with them, so the user types nothing.
 * What carries the risk is not the happy path but the failure mode — most
 * photographs arriving in this app have no EXIF at all (小红书 and 微信 strip it
 * on upload, and the ones that keep it usually keep only part of it). The rules
 * are therefore: a photo with no metadata renders no plate and never errors, a
 * photo with some of it renders exactly those fields, and nothing ever draws an
 * empty band or a placeholder.
 *
 * The tests come in two sizes for that reason. `plateFields` is the decision —
 * data in, display strings out, no canvas — and is tested directly. `render` is
 * the wiring, and is tested on the pixels a user would see, because a perfect
 * `plateFields` and a `render` that lays it out wrongly passes every assertion
 * about strings.
 */

test.beforeEach(async ({ page }) => {
  // `installProbe` (below) has to be in place before the app boots, so it goes
  // in front of the first navigation rather than in a hook of its own.
  await page.addInitScript(installProbe)
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

const FULL = { focal: '140mm', aperture: 'f/2.1', shutter: '1/82', iso: 'ISO 500' }

test('plateFields produces a value per configured field, in order', async ({ page }) => {
  const out = await page.evaluate((exif) => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture', 'shutter', 'iso'], color: '#000', align: 'center' },
      exif,
    )
  }, FULL)
  expect(out).toEqual(['140mm', 'f/2.1', '1/82', 'ISO 500'])
})

test('[RF-2] a null exif yields no fields at all', async ({ page }) => {
  const out = await page.evaluate(() => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture'], color: '#000', align: 'center' },
      null,
    )
  })
  expect(out).toEqual([])
})

test('[RF-2] missing tags are omitted, present ones kept', async ({ page }) => {
  const out = await page.evaluate(() => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture', 'shutter', 'iso'], color: '#000', align: 'center' },
      { focal: '50mm' },
    )
  })
  expect(out).toEqual(['50mm'])
})

test('a disabled plate yields no fields', async ({ page }) => {
  const out = await page.evaluate((exif) => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: false, fields: ['focal'], color: '#000', align: 'center' },
      exif,
    )
  }, FULL)
  expect(out).toEqual([])
})

test('drawPlate with no fields paints nothing', async ({ page }) => {
  const changed = await page.evaluate(() => {
    const f = (window as any).__frame
    const { drawPlate } = (window as any).__frameCore
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 200, 200)
    const before = f.pixel(100, 150)
    drawPlate(ctx, { enabled: true, fields: ['focal'], color: '#000', align: 'center' }, null, { x: 0, y: 100, w: 200, h: 100 }, 1)
    const after = f.pixel(100, 150)
    return { before, after }
  })
  expect(changed.after).toEqual(changed.before)
})

/**
 * `PlateField` has six members and 样张 configures four, so `camera` and `date`
 * are the two mappings nothing else in the app exercises — and the two a later
 * template can break without a test going red. `date` matters twice over: it is
 * the photograph's *capture* date (Task 15 reads `DateTimeOriginal` first), so
 * the value arriving here is already the day the frame was shot and the plate's
 * only job is to print it, in the order it was configured.
 */
test('the camera and date fields map through, in the configured order', async ({ page }) => {
  const out = await page.evaluate(() => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['date', 'camera'], color: '#000', align: 'center' },
      { camera: 'NIKON CORPORATION NIKON D810', date: '2019.12.03' },
    )
  })
  expect(out).toEqual(['2019.12.03', 'NIKON CORPORATION NIKON D810'])
})

// ---------------------------------------------------------------------------
// The plate as it reaches the canvas
// ---------------------------------------------------------------------------

const ID = 'spec-sheet'
/**
 * 样张's canvas at the size the app actually renders it: `state.longEdge`'s
 * 1440, which `resolveSize` makes 1152×1440 for a 4:5 poster — the `k = 1`
 * preview, and doubled the `k = 2` export.
 *
 * This was the goldens' 480×600 probe size, and the plate tests were red there
 * for a reason that was not the plate. `matRect` adds an *absolute* 236px
 * (86 + 150) below the photograph while the frame is a *fraction* of the
 * canvas, so the card fits only while `H ≥ 2·236/(1 - scale/100)`: 1388px at
 * 样张's scale of 66, and 2145px at the 78 it shipped with. On a 600px canvas
 * nothing that keeps a photograph on the poster can fit that mat, so the old
 * size was asking the wiring to put ink into a band that is off the canvas by
 * construction — the composition, not the wiring, and the composition is fixed
 * where the user sees it, at the canvas below.
 */
const SIZE = resolveSize(getTemplate(ID)!.canvas.ratio, 1440)
/** the sample fixture's dimensions, in case a template ever says `orig` */
const PHOTO_SIZE = { width: 640, height: 1074 }

type Shot = { count: number; minX: number; maxX: number; minY: number; maxY: number }

/**
 * The band `render` hands to `drawPlate`, in device pixels: the strip of mat
 * below the photograph, inset by the mat's own walls. Reconstructed here from
 * the layout functions `render` itself uses, so assertions about where the ink
 * landed are assertions about the band the renderer actually chose.
 *
 * `x` is `frame.x`, which is what "the mat's bottom strip, inset by the mat's
 * side walls" means: `matRect` grows the frame by `mat * k` on every side, so
 * the strip inside those walls begins at the frame's own left edge. The
 * `frame.x + mat * k` this used to carry was the defect's expression copied
 * into the test, which is why nothing in this file could see the plate sitting
 * 86px right of centre — `bandFor` moved with it.
 */
function bandFor(k: number) {
  const tpl = getTemplate(ID)!
  const aspect = aspectOf(tpl.canvas.ratio, PHOTO_SIZE)
  const frame = fitRect({ W: SIZE.W * k, H: SIZE.H * k }, aspect, tpl.frame.scale, 0, 0)
  const mat = matRect(frame, tpl.frame.mat, tpl.frame.matBottom, k)
  const top = frame.y + frame.h + tpl.frame.mat * k
  return { x: frame.x, y: top, w: frame.w, h: Math.max(1, mat.y + mat.h - top) }
}

/**
 * Where the plate's ink has to be centred, derived from the *canvas* and the
 * *mat* — never from the band expression above or the one `render` lays the
 * band out with. Those two are the same expression, so an assertion against
 * either can only say the plate is centred inside whatever band the renderer
 * chose; it says nothing about where that band is, and it stays green while the
 * plate sits a full mat to the right of the poster's centre.
 *
 * The two numbers here cannot move when the band expression does:
 *
 * - `canvas` is the middle of the box itself — `render` fits the frame with
 *   `ox = 0`, so `fitRect` centres the photograph on it.
 * - `mat` is the middle of the rect `matRect` lays the mat out with, which is
 *   the photograph's frame grown symmetrically by `mat * k` on both sides. The
 *   band is that mat's bottom strip inset by those same side walls, so the
 *   band's centre is the mat's centre.
 */
function centresFor(k: number): { canvas: number; mat: number } {
  const tpl = getTemplate(ID)!
  const box = { W: SIZE.W * k, H: SIZE.H * k }
  const frame = fitRect(box, aspectOf(tpl.canvas.ratio, PHOTO_SIZE), tpl.frame.scale, 0, 0)
  const mat = matRect(frame, tpl.frame.mat, tpl.frame.matBottom, k)
  return { canvas: box.W / 2, mat: mat.x + mat.w / 2 }
}

/**
 * The measuring apparatus, installed into the page before the app boots: one
 * render of 样张 through the real `render`, and a scan of the result.
 *
 * The photograph is a flat `#E8E8E8`, lighter than every other mark the
 * template makes — the white mat, its 9%-alpha bevel, the bevel's hairline —
 * so a single luminance threshold catches the plate's `#3A3833` and nothing
 * else on the canvas. "Dark pixel" and "plate ink" are then the same set, which
 * is what lets the tests below say `count === 0` about the band. The title slot
 * is left empty: it is mat-anchored into this very band, and these tests are
 * about the plate.
 */
function installProbe(): void {
  let flat: HTMLImageElement | null = null
  ;(window as any).__plateShot = async (opts: {
    size: { W: number; H: number }
    k: number
    exif: unknown
    id: string
  }): Promise<Shot> => {
    const f = (window as any).__frame
    const { render } = (window as any).__frameCore
    const template = (window as any).__frameTemplates.getTemplate(opts.id)

    if (!flat) {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const cc = c.getContext('2d')!
      cc.fillStyle = '#E8E8E8'
      cc.fillRect(0, 0, 64, 64)
      flat = await new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image()
        img.onload = () => res(img)
        img.onerror = rej
        img.src = c.toDataURL('image/png')
      })
    }
    const photo = { el: flat, width: 64, height: 64, name: 'flat', exif: null }

    const W = opts.size.W * opts.k
    const H = opts.size.H * opts.k
    f.setSize(W, H)
    const ctx = f.ctx()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    render({
      ctx,
      size: opts.size,
      k: opts.k,
      template,
      photos: [photo],
      text: {},
      exif: opts.exif as any,
    })

    const px = ctx.getImageData(0, 0, W, H).data
    const out: Shot = { count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        if (0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]! < 160) {
          out.count++
          if (x < out.minX) out.minX = x
          if (x > out.maxX) out.maxX = x
          if (y < out.minY) out.minY = y
          if (y > out.maxY) out.maxY = y
        }
      }
    }
    return out
  }
}

test.describe('the plate on the canvas', () => {
  const shoot = (page: Page, k: number, exif: unknown): Promise<Shot> =>
    page.evaluate(
      (o) => (window as any).__plateShot(o),
      { size: SIZE, k, exif, id: ID },
    ) as Promise<Shot>

  /**
   * The end-to-end half of Review Focus 2, and the only test of the wiring
   * itself — every other test in this file calls `drawPlate` or `plateFields`
   * directly and would stay green if `render` never called either.
   *
   * Three renders of the same photograph: with no EXIF the band is untouched;
   * with the full set the plate is there, inside the band, centred in it; with
   * one tag the ink is *narrower*, so the fields that are missing are absent
   * rather than reserved as blank runs. `null` is the common case in the wild,
   * not an edge case: it is what every photo stripped by a social app looks
   * like.
   */
  test('render draws the full set into the band, only the present fields, and nothing without EXIF', async ({
    page,
  }) => {
    const [none, full, partial] = await Promise.all([
      shoot(page, 1, null),
      shoot(page, 1, FULL),
      shoot(page, 1, { focal: '50mm' }),
    ])
    const band = bandFor(1)

    expect(full.count, 'the plate drew nothing').toBeGreaterThan(20)
    expect(full.minY, `ink above the band: ${JSON.stringify(full)}`).toBeGreaterThanOrEqual(
      Math.round(band.y) - 2,
    )
    expect(full.maxY, `ink below the band: ${JSON.stringify(full)}`).toBeLessThanOrEqual(
      Math.round(band.y + band.h) + 2,
    )
    // horizontally too: a plate laid out from the canvas box rather than from
    // the band it was handed drifts out of the mat's own walls
    expect(full.minX).toBeGreaterThanOrEqual(Math.round(band.x) - 2)
    expect(full.maxX).toBeLessThanOrEqual(Math.round(band.x + band.w) + 2)

    // `align: 'center'` is 样张's setting. The tolerance is font rasterisation;
    // a plate laid out from the band's left edge is ~150px off.
    const inkCentre = (full.minX + full.maxX) / 2
    expect(
      Math.abs(inkCentre - (band.x + band.w / 2)),
      `the plate is not centred: ink centre ${inkCentre}, band centre ${band.x + band.w / 2}`,
    ).toBeLessThanOrEqual(6)

    // ...and centred on the *poster*, which the assertion above cannot say: it
    // measures the ink against the band `bandFor` reconstructs from the same
    // expression `render` builds its band with, so both sides move together.
    // It passed while the band's `x` carried an extra `mat * k` and the plate
    // sat 86px right of a 1152px canvas's centre. These two do not move with
    // that expression — the canvas's centre is the box's, and the mat's centre
    // is the frame's, because `matRect` grows the frame by `mat` on both sides
    // — and the plate is the mat's bottom strip, so all three are one x.
    const centre = centresFor(1)
    expect(
      Math.abs(inkCentre - centre.canvas),
      `the plate is not centred on the canvas: ink centre ${inkCentre}, canvas centre ${centre.canvas}`,
    ).toBeLessThanOrEqual(6)
    expect(
      Math.abs(inkCentre - centre.mat),
      `the plate is not centred in the mat: ink centre ${inkCentre}, mat centre ${centre.mat}`,
    ).toBeLessThanOrEqual(6)

    // no metadata at all: the band is untouched, which is the whole of RF-2
    expect(none.count, 'a photo with no EXIF drew a plate').toBe(0)

    // one tag: ink, and narrower than the full set
    expect(partial.count, 'a one-tag photo drew no plate').toBeGreaterThan(0)
    expect(partial.maxX - partial.minX).toBeLessThan(full.maxX - full.minX)
  })

  /**
   * `render` scales its layout box by `k` once, and `frame` reaches the plate in
   * device pixels exactly as it reaches `drawText`. The preview only ever
   * renders at `k = 1`, so a unit slip here is invisible on screen and lands
   * only in the exported file — this architecture's worst failure, a poster
   * nobody ever saw. Doubling the canvas has to move the plate by the same
   * doubling, measured against bands reconstructed from the layout functions
   * rather than from the numbers the plate used.
   */
  test('the plate keeps its place in the band when the canvas is doubled', async ({ page }) => {
    const one = await shoot(page, 1, FULL)
    const two = await shoot(page, 2, FULL)

    for (const [k, s] of [[1, one], [2, two]] as const) {
      expect(s.count, `no plate ink found at k=${k}`).toBeGreaterThan(20)
      const band = bandFor(k)
      expect(s.minY, `at k=${k} the plate is above the band it was given`).toBeGreaterThanOrEqual(
        Math.round(band.y) - 2,
      )
      expect(s.maxY, `at k=${k} the plate is below the band it was given`).toBeLessThanOrEqual(
        Math.round(band.y + band.h) + 2,
      )
    }

    // where the ink sits *within* the band, in device pixels: the k=2 offset has
    // to be the k=1 offset doubled. Dropping the `* k` from the band's top edge
    // moves the plate 86px against it at k=2 — twenty times the tolerance — and
    // would pass every string-level test in this file.
    const intoBand = (k: 1 | 2, s: Shot) => s.minY - bandFor(k).y
    expect(
      Math.abs(intoBand(2, two) - intoBand(1, one) * 2),
      `ink sits ${intoBand(1, one)}px into the band at k=1 and ${intoBand(2, two)}px at k=2`,
    ).toBeLessThanOrEqual(4)

    // and the whole row doubles, so it is the same plate in the same place and
    // not merely something inside the band: extent, height and centre all scale
    expect(Math.abs(two.minY - one.minY * 2)).toBeLessThanOrEqual(4)
    expect(Math.abs(two.maxY - one.maxY * 2)).toBeLessThanOrEqual(4)
    expect(
      Math.abs((two.minX + two.maxX) / 2 - ((one.minX + one.maxX) / 2) * 2),
    ).toBeLessThanOrEqual(4)
  })
})
