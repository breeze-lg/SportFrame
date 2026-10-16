import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { aspectOf, fitRect, matRect, resolveSize } from '../../src/core/geometry'
import { getTemplate } from '../../src/core/templates'

/**
 * The regression net: every built-in template, rendered in both themes, with
 * invariant assertions and committed goldens.
 *
 * Two kinds of assertion live here, and they are not equal partners.
 *
 * - The **invariants** say what a poster must always be: something was drawn,
 *   nothing is left transparent, text sits in the band it was given, the
 *   preview is the image that reaches the canvas. They never go stale, and
 *   each one names a bug class the spec calls out.
 * - The **goldens** in `tests/pixel/__screenshots__/` catch the changes nobody
 *   wrote a rule for — a radius nudged, a colour shifted, a blur re-tuned.
 *   They are the price of testing a visual product, and the price is real: a
 *   deliberate template change makes them stale, and re-baselining is work.
 *   There is one per template, not one per theme: the dark leg renders against
 *   the light golden, and that reproduction is the cross-theme assertion.
 *
 * So: a red golden is a question, not a verdict. Decide which it is — an
 * unintended regression (fix the code, keep the golden) or a template you meant
 * to change (re-baseline, commit the new goldens in the same change) — before
 * running `--update-snapshots`. `matchGolden` below says the same thing in the
 * failure output, because the developer who needs to read it is looking at the
 * test output, not at this comment.
 */

const TEMPLATE_IDS = [
  'classic',
  'polaroid',
  'magazine',
  'cinema',
  'postcard',
  'minimal',
  'square',
  'story',
  'spec-sheet',
]

const SIZE = { W: 480, H: 600 }

const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

const REBASELINE = [
  '',
  '  A golden no longer matches what this template renders. That is a question, not a bug:',
  '  either the renderer changed on purpose, or it changed by accident.',
  '',
  '    unintended  → fix src/ and re-run. Do NOT re-baseline to clear the red.',
  '    deliberate  → npx playwright test tests/pixel/templates.spec.ts --update-snapshots',
  '                  then commit the new goldens in tests/pixel/__screenshots__ together',
  '                  with the template change that made them.',
  '',
  '  The render that was just produced is kept next to the failure, under test-results/.',
].join('\n')

/**
 * `toMatchSnapshot` for a raw buffer, with the policy above on the failure.
 *
 * Playwright builds the matcher's message itself and ignores the custom message
 * `expect(value, message)` would carry, so the text is appended to the thrown
 * error instead. The error is the same object Playwright threw — same type,
 * same attachments written to `test-results/` — with the message and stack
 * re-formed around the addition.
 */
function matchGolden(received: Buffer, name: string): void {
  try {
    expect(received).toMatchSnapshot(name)
  } catch (e) {
    if (e instanceof Error) {
      const stack = e.stack ?? ''
      e.message = `${e.message}\n${REBASELINE}`
      e.stack = `${e.message}\n${stack.split('\n').slice(1).join('\n')}`
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Every template, in both themes
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  for (const id of TEMPLATE_IDS) {
    test(`${id} renders in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('/?dev=1')
      await page.waitForFunction(() => '__frame' in window)

      const result = await page.evaluate(
        async ({ templateId, size, full }) => {
          const f = (window as any).__frame
          const { render } = (window as any).__frameCore
          const { getTemplate } = (window as any).__frameTemplates

          const img = new Image()
          await new Promise((res, rej) => {
            img.onload = res
            img.onerror = rej
            img.src = '/sample/sample.webp'
          })
          const photo = {
            el: img,
            width: img.naturalWidth,
            height: img.naturalHeight,
            name: 'sample',
            exif: null,
          }

          // The canvas the app would deliver this poster on. 无照片 writes the
          // mount's own box, so a postcard-sized canvas would be a canvas nobody
          // ever sees, and the transparency check below is about the file.
          const tplNow = getTemplate(templateId)
          const aspect = (window as any).__frameCore.aspectOf(tplNow.canvas.ratio, photo)
          const win = (window as any).__frameCore.outputRect(size, tplNow, aspect)
          const W = Math.max(1, Math.round(win.w))
          const H = Math.max(1, Math.round(win.h))

          // ...and, where the poster *is* the mount's own box, a second render at the
          // size the app actually writes (`state.longEdge`, see `main.ts`). 样张's mat
          // is absolute pixels while the canvas is a fraction of the layout's size, so
          // at a 480×600 canvas its mount does not fit at all (the fact that decides
          // the plate tests' size too, see `tests/pixel/plate.spec.ts`) — and an
          // invariant asserted there would be a claim about a poster nobody can make.
          let strict: number | null = null
          if (tplNow.background.mode !== 'blur') {
            const big = (window as any).__frameCore.outputRect(full, tplNow, aspect)
            const bw = Math.max(1, Math.round(big.w))
            const bh = Math.max(1, Math.round(big.h))
            f.setSize(bw, bh)
            const bctx = f.ctx()
            bctx.setTransform(1, 0, 0, 1, 0, 0)
            bctx.clearRect(0, 0, bw, bh)
            render({ ctx: bctx, size: full, k: 1, template: tplNow, photos: [photo], text: {}, exif: null })
            const bd = bctx.getImageData(0, 0, bw, bh).data
            let holes = 0
            for (let i = 3; i < bd.length; i += 4) if (bd[i] === 0) holes++
            strict = holes
          }

          f.setSize(W, H)
          const ctx = f.ctx()
          ctx.clearRect(0, 0, W, H)
          render({
            ctx,
            size,
            k: 1,
            template: tplNow,
            photos: [photo],
            text: {},
            exif: null,
          })
          return {
            // the page's own theme, so "in dark" is something this test saw
            // rather than something it assumed from the line above
            theme: document.documentElement.getAttribute('data-theme'),
            W,
            H,
            px: Array.from(ctx.getImageData(0, 0, W, H).data) as number[],
            strict: strict == null ? null : (strict as number),
          }
        },
        { templateId: id, size: SIZE, full: resolveSize(getTemplate(id)!.canvas.ratio, 1440) },
      )

      const px = result.px
      expect(result.theme, `${id}: the page did not paint in ${theme}`).toBe(theme)
      expect(px.length, `${id} did not fill the canvas`).toBe(result.W * result.H * 4)

      // invariant: something was actually drawn
      const nonBlank = px.some((v, i) => i % 4 !== 3 && v > 8)
      expect(nonBlank, `${id} drew nothing`).toBe(true)

      // invariant: nothing the poster draws is transparent. For 带背景 that is the
      // whole canvas and the answer is zero. For 无照片 the file is the mount's own
      // box, and the render above is a 480×600 probe whose mat — absolute pixels —
      // does not fit that canvas at all; the same render at the size the app writes
      // is the one this assertion is about (see the probe's `strict`). `matchGolden`
      // below pins every pixel of the probe render byte for byte either way.
      let transparent = 0
      for (let i = 3; i < px.length; i += 4) if (px[i] === 0) transparent++
      if (result.strict != null) {
        expect(result.strict, `${id} left transparent pixels`).toBe(0)
      } else {
        expect(transparent, `${id} left transparent pixels`).toBe(0)
      }

      // One golden per template, not one per theme. The artifact does not
      // follow the chrome: `--mat` is `#FFFFFF` in both themes and every colour
      // `render` paints is a literal or a template field, so the dark leg has
      // to reproduce the light golden byte for byte. That is a *stronger* claim
      // than the `-dark.rgba` file it replaces made — the renderer must produce
      // the light render while the media query says dark, rather than two
      // committed files having happened to agree on the day they were made —
      // and it is why those nine files are gone.
      //
      // A theme-dependent renderer cannot be re-baselined out of this: both
      // legs compare against this one file, so whichever render
      // `--update-snapshots` last wrote, the other leg is red on the next run.
      matchGolden(Buffer.from(px), `${id}-light.rgba`)
    })
  }
}

// ---------------------------------------------------------------------------
// The shadow branch
// ---------------------------------------------------------------------------

test.describe('the mat shadow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?dev=1')
    await page.waitForFunction(() => '__frame' in window)
  })

  /**
   * No other test says what the shadow branch does. `mat.spec` calls `drawMat`
   * with `shadow = 0`; `render.spec` renders a template that does ask for one
   * (40) but reads the mat, the photograph and a far corner, none of which the
   * shadow touches. The goldens above would go red if the shadow changed —
   * which is not the same as an assertion about what it is for.
   *
   * Two claims. The shadow has to fall *below* the mat, onto the surface the
   * mat is mounted on — and it has to be local, because a shadow that washed
   * the whole canvas would be a different bug wearing the same colour. And the
   * call has to leave the context as it found it: the probe canvas outlives the
   * call, so a `shadowBlur` left set would smear every fill drawn after it,
   * including every later test's.
   */
  test('a shadow darkens the surface under the mat, and only there', async ({ page }) => {
    const r = await page.evaluate(() => {
      const f = (window as any).__frame
      const { drawMat } = (window as any).__frameCore
      const W = 400
      f.setSize(W, W)
      const ctx = f.ctx()
      const mat = { x: 100, y: 100, w: 200, h: 200 }

      const shot = (shadow: number) => {
        // a flat wall, so anything else in the pixel is the mat or its shadow
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, W, W)
        drawMat(ctx, mat, 0, shadow, 1)
        return {
          // 3px under the mat's bottom edge, where the shadow is heaviest
          below: f.pixel(200, 302),
          // the far corner: blur 27 at offset 7 cannot reach it
          far: f.pixel(10, 10),
        }
      }
      const off = shot(0)
      const on = shot(45)
      return {
        off,
        on,
        state: { blur: ctx.shadowBlur, offsetY: ctx.shadowOffsetY, color: ctx.shadowColor },
      }
    })

    // the two draws differ in nothing but the shadow, so the wall is flat grey
    // in the plain one and cannot be anything else under the shadowed one
    expect(r.off.below).toEqual([128, 128, 128, 255])
    expect(lum(r.on.below), `shadow 45 did not darken the wall: ${r.on.below}`).toBeLessThan(
      lum(r.off.below) - 15,
    )
    // local: the corner is the same pixel in both draws
    expect(r.on.far).toEqual(r.off.far)

    // and the state the draw borrowed is given back
    expect(r.state).toEqual({ blur: 0, offsetY: 0, color: 'rgba(0, 0, 0, 0)' })
  })
})

// ---------------------------------------------------------------------------
// The self-hosted faces
// ---------------------------------------------------------------------------

const FACES = [
  { family: 'Newsreader', weight: 400, style: 'normal', file: 'newsreader-400.woff2' },
  { family: 'Newsreader', weight: 400, style: 'italic', file: 'newsreader-400-italic.woff2' },
  { family: 'IBM Plex Mono', weight: 400, style: 'normal', file: 'plex-mono-400.woff2' },
  { family: 'IBM Plex Mono', weight: 500, style: 'normal', file: 'plex-mono-500.woff2' },
  { family: 'IBM Plex Sans', weight: 400, style: 'normal', file: 'plex-sans-400.woff2' },
  { family: 'IBM Plex Sans', weight: 600, style: 'normal', file: 'plex-sans-600.woff2' },
]

test.describe('the self-hosted faces', () => {
  /**
   * Six faces, and the failure this guards is the quietest one in the app: drop
   * a `.woff2` from `public/fonts/`, rename it, or let the build stop copying
   * it, and the browser falls back to the system stack. Every other pixel spec
   * stays green — the canvas draws from a font stack no test can see through —
   * while the interface stops being the one that was designed. Self-hosting is
   * a constraint that exists precisely so this cannot happen silently.
   */
  test('all six faces are declared, fetched from this origin, and loaded', async ({
    page,
    baseURL,
  }) => {
    const fetched: string[] = []
    page.on('request', (r) => {
      if (r.resourceType() === 'font' || /\.woff2?(\?|$)/.test(r.url())) fetched.push(r.url())
    })
    await page.goto('/')

    const loaded = await page.evaluate(async (faces) => {
      const out: { spec: string; statuses: string[]; error: string | null }[] = []
      for (const f of faces) {
        const spec = `${f.style} ${f.weight} 16px "${f.family}"`
        let statuses: string[] = []
        let error: string | null = null
        try {
          // resolves with the faces the list matched, and rejects if the file
          // cannot be fetched — which is what a lost or renamed woff2 is
          statuses = (await document.fonts.load(spec)).map((face) => face.status)
        } catch (e) {
          error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        }
        out.push({ spec, statuses, error })
      }
      return out
    }, FACES)

    for (const face of loaded) {
      expect(face.error, `${face.spec} failed to load`).toBeNull()
      // an empty list means no @font-face matched the family at all
      expect(face.statuses, `${face.spec} did not resolve to a loaded face`).toEqual(['loaded'])
    }

    // and the bytes came from this origin — never a font CDN
    const origin = new URL(baseURL!).origin
    for (const url of fetched) {
      expect(new URL(url).origin, `${url} is not served by the app`).toBe(origin)
    }
    for (const face of FACES) {
      expect(
        fetched.some((u) => new URL(u).pathname.endsWith(`/fonts/${face.file}`)),
        `${face.file} was never fetched`,
      ).toBe(true)
    }
  })

  test('the built app serves each face byte for byte', async ({ page }) => {
    // The complement of the load test: a face can load and still be the wrong
    // file — a truncated copy, a placeholder, a subset swapped for another.
    for (const face of FACES) {
      const res = await page.request.get(`/fonts/${face.file}`)
      expect(res.status(), `${face.file} is not served by the built app`).toBe(200)
      const served = await res.body()
      expect(served.subarray(0, 4).toString('latin1'), `${face.file} is not a woff2`).toBe('wOF2')
      expect(
        served.equals(readFileSync(resolve('public/fonts', face.file))),
        `${face.file} is not the committed file`,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// The preview indirection
// ---------------------------------------------------------------------------

/**
 * A frame at 80% of the canvas, so what is inside it is the photograph and
 * what is around it is the background pass's own draw of the same source. On
 * the 480×600 canvas below, the photograph covers x 48..432, y 60..540.
 *
 * `blur: 0` and `darken: 0` keep that source's own colour intact — a flat
 * magenta stays exactly #FF00FF through a zero-radius blur — so one equality
 * assertion covers both call sites of `photo.preview ?? photo.el` at once.
 * That is the point of the 80: at `scale: 100` the photograph covered every
 * pixel, the background pass could have drawn from `photo.el` unseen, and this
 * probe would have been a claim about the cheap call site only. The background
 * is the expensive one — it uploads and blurs the source at canvas-plus-padding
 * size on every render — and a downscale ignored there is a slow app rather
 * than a wrong poster, which is exactly what a correctness suite misses.
 */
const PROBE = {
  id: 'probe',
  name: 'probe',
  layout: { kind: 'single' as const },
  canvas: { ratio: '4:5' as const },
  background: { mode: 'blur' as const, blur: 0, darken: 0, zoom: 100 },
  frame: { scale: 80, radius: 0, mat: 0, matBottom: 0, shadow: 0 },
}

test.describe('the preview downscale', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?dev=1')
    await page.waitForFunction(() => '__frame' in window)
  })

  /**
   * `render` draws from `photo.preview ?? photo.el` — the ~4 MP downscale the
   * app builds for a photo over 12 MP, so that a large image is not painted
   * through the full-resolution element on every frame. Export passes photos
   * with no `preview` at all, which is how it gets the full image.
   *
   * Nothing else in the suite uses a photo whose `preview` differs from its
   * `el`, so a regression to `el` — the downscale quietly dropped from the
   * preview path, which is a slow app rather than a wrong poster and so
   * survives every correctness test — would pass everything else in this file.
   * Here the two differ visibly: the preview is a flat colour of the same
   * dimensions, and the render has to be that colour.
   *
   * `render` reads the source in two places — the background pass and the photo
   * pass — and each can regress on its own. So the samples below sit on both
   * sides of the frame's edge (see `PROBE`): reverting *either* occurrence to
   * `photo.el` on its own reddens this test, and that is the whole reason the
   * frame is not full-bleed.
   */
  test('render draws the downscale, not the full-size el', async ({ page }) => {
    const r = await page.evaluate(async (template) => {
      const f = (window as any).__frame
      const { render } = (window as any).__frameCore
      const load = (src: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image()
          i.onload = () => res(i)
          i.onerror = () => rej(new Error(`could not load ${src}`))
          i.src = src
        })

      const full = await load('/sample/sample.webp')
      // same dimensions, different pixels: what a downscale looks like to the
      // renderer, which only ever hands it to `drawImage`
      const c = document.createElement('canvas')
      c.width = full.naturalWidth
      c.height = full.naturalHeight
      const cc = c.getContext('2d')!
      cc.fillStyle = '#FF00FF'
      cc.fillRect(0, 0, c.width, c.height)
      const preview = await load(c.toDataURL('image/png'))

      const W = 480
      const H = 600
      // named, so a failure says which pass disagreed. The three photo samples
      // are 50px or more inside the frame's edge (x 48..432, y 60..540 at
      // `frame.scale: 80`), clear of the clip and of the 1px overdraw; the
      // corner is 28px outside it, and only the background pass can reach it.
      const shot = (photo: any) => {
        f.setSize(W, H)
        const ctx = f.ctx()
        ctx.clearRect(0, 0, W, H)
        render({
          ctx,
          size: { W, H },
          k: 1,
          template,
          photos: [photo],
          text: {},
          exif: null,
        })
        return {
          photoCentre: f.pixel(240, 300),
          photoUpperLeft: f.pixel(120, 160),
          photoLowerRight: f.pixel(380, 480),
          background: f.pixel(20, 20),
        }
      }

      const dims = { width: full.naturalWidth, height: full.naturalHeight, name: 's', exif: null }
      return {
        // the photo as the app shapes it for the screen: el + preview
        both: shot({ el: full, preview, ...dims }),
        // the same photo as export shapes it: preview stripped
        elOnly: shot({ el: full, ...dims }),
        // the reference: the preview image drawn as the only source
        previewAsEl: shot({ el: preview, ...dims }),
      }
    }, PROBE)

    // With a preview in hand the preview is what reaches the canvas — in the
    // photo pass and in the background pass, and the second is the one that
    // costs: `drawBackground` scales the source up to the canvas plus three
    // blur radii of padding, so a `photo.el` there paints 4 MP where 4 MP was
    // meant to be 4 MP downscaled, on every frame. That is a slow app, not a
    // wrong poster, and no other test in this file can see it.
    //
    // The samples are named, so `toEqual`'s own diff names the point that
    // disagreed: `background` is the corner, which only `drawBackground` draws.
    expect(r.both, 'the render did not draw the preview').toEqual(r.previewAsEl)

    // and it is visibly not the full-size image — the assertion above would be
    // vacuous if the two sources happened to look alike
    let spread = 0
    const elOnly = r.elOnly as Record<string, number[]>
    const previewAsEl = r.previewAsEl as Record<string, number[]>
    for (const [where, a] of Object.entries(elOnly)) {
      const b = previewAsEl[where]!
      for (let ch = 0; ch < 3; ch++) spread = Math.max(spread, Math.abs(a[ch]! - b[ch]!))
    }
    expect(spread, 'the fixtures are too alike to tell apart').toBeGreaterThan(60)
  })
})

// ---------------------------------------------------------------------------
// Mat-anchored text at export scale
// ---------------------------------------------------------------------------

/**
 * `matBottom * k` is the one conversion in `drawText`, and `k = 1` is the only
 * scale the preview ever uses — so a unit mix-up there is invisible on screen
 * and lands only in the file the user exports. That is this architecture's
 * worst failure: a poster nobody ever saw. 拍立得 is the template that carries
 * the anchor (`anchor: 'mat'`, `matBottom: 104`).
 */
test.describe('mat-anchored text at k = 2', () => {
  const W = 600
  const H = 750
  const ID = 'polaroid'
  /** the fixture's own size, 640×1074, in case a template ever says `orig` */
  const SAMPLE_SIZE = { width: 640, height: 1074 }

  test.beforeEach(async ({ page }) => {
    await page.goto('/?dev=1')
    await page.waitForFunction(() => '__frame' in window)
  })

  test('text keeps its place in the band when the canvas is doubled', async ({ page }) => {
    const tpl = getTemplate(ID)!
    // the same functions `render` does the layout with, so the band the scan
    // looks in is the band the renderer drew
    const aspect = aspectOf(tpl.canvas.ratio, SAMPLE_SIZE)
    const bands: Record<string, { top: number; bottom: number; x: number; w: number }> = {}
    for (const k of [1, 2]) {
      const frame = fitRect({ W: W * k, H: H * k }, aspect, tpl.frame.scale, 0, 0)
      const mat = matRect(frame, tpl.frame.mat, tpl.frame.matBottom, k)
      bands[String(k)] = {
        top: frame.y + frame.h,
        bottom: mat.y + mat.h,
        x: mat.x,
        w: mat.w,
      }
    }

    const ink = await page.evaluate(
      async ({ size, bands, id }) => {
        const f = (window as any).__frame
        const { render } = (window as any).__frameCore
        const img = new Image()
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
          img.src = '/sample/sample.webp'
        })
        const photo = {
          el: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          name: 'sample',
          exif: null,
        }
        const template = (window as any).__frameTemplates.getTemplate(id)

        const run = (k: number) => {
          const band = bands[String(k)]!
          f.setSize(size.W * k, size.H * k)
          const ctx = f.ctx()
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.clearRect(0, 0, size.W * k, size.H * k)
          render({
            ctx,
            size,
            k,
            template,
            photos: [photo],
            text: { title: 'City Walk' },
            exif: null,
          })

          // The middle half of the mat's width: the mat's own edge columns and
          // its rounded corners are outside it, so within the band the only
          // thing under 120 is the title — the bevel hairline sits at 245.
          const x = Math.round(band.x + band.w * 0.25)
          const w = Math.round(band.w * 0.5)
          const rows: number[] = []
          // from the photo's bottom edge to just inside the mat's: the last row
          // of the mat is the 1px inset `render` leaves around the fill
          for (let y = Math.round(band.top) + 1; y < Math.round(band.bottom) - 2; y++) {
            const line = f.sample(x, y, w, 1)
            for (let i = 0; i < line.length; i += 4) {
              if (
                0.299 * line[i]! +
                  0.587 * line[i + 1]! +
                  0.114 * line[i + 2]! <
                120
              ) {
                rows.push(y)
                break
              }
            }
          }
          return {
            rows: rows.length,
            first: rows[0] ?? null,
            last: rows[rows.length - 1] ?? null,
            centre: rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null,
          }
        }
        return { 1: run(1), 2: run(2) }
      },
      { size: { W, H }, bands, id: ID },
    )

    for (const k of [1, 2]) {
      // without ink on both sides every scaling claim below is vacuous
      expect(ink[k as 1 | 2].rows, `no title ink found at k=${k}`).toBeGreaterThan(5)
    }

    // Where the ink sits *within* the band, in logical units — the claim the
    // pair this replaced only appeared to make. `first > band.top` and
    // `last < band.bottom` could not fail: the scan runs from
    // `round(band.top) + 1` to `round(band.bottom) - 3`, so both were true of
    // every row it could possibly return, and `rows > 5` was carrying them.
    // This one the window can violate, because the band edge it is measured
    // against comes from the layout functions while the row comes from the
    // pixels. Dropping the `* k` on `matBottom` moves the ink 64.5 device
    // pixels against the band's top edge at k=2 — sixteen times the tolerance.
    const intoBand = (k: 1 | 2) => ink[k].first! - bands[String(k)]!.top
    expect(
      Math.abs(intoBand(2) - intoBand(1) * 2),
      `ink sits ${intoBand(1)}px into the band at k=1 and ${intoBand(2)}px at k=2`,
    ).toBeLessThanOrEqual(4)

    // The same place, in logical units: every row at k=2 is the k=1 row
    // doubled. Dropping the `* k` from `matBottom` moves the ink by
    // 104 * 0.62 = 64 device pixels — sixteen times the tolerance.
    expect(Math.abs(ink[2].first! - ink[1].first! * 2)).toBeLessThanOrEqual(4)
    expect(Math.abs(ink[2].last! - ink[1].last! * 2)).toBeLessThanOrEqual(4)
    expect(Math.abs(ink[2].centre! - ink[1].centre! * 2)).toBeLessThanOrEqual(4)
  })
})
