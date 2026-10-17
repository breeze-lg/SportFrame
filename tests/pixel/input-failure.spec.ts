import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveSize } from '../../src/core/geometry'

/**
 * Review Focus 4, the half that could not be tested until the app rendered.
 *
 * The classification logic is pinned in `tests/unit/input.test.ts`, and that
 * file says so itself: "Real corrupt bytes and real `onerror` are the pixel
 * suite's business." This is that suite. Every case below drives a bad file
 * through the real input path — the app's own `#file` element, the app's own
 * `wireInput`, the app's own canvas — and asserts the two halves of the spec's
 * promise (§9, and Review Focus 4): a message the user can read, and a poster
 * that is still there. A blank canvas is the failure mode, so "the message
 * appeared" alone would pass on it; the digest of the rendered pixels is what
 * rules it out.
 *
 * The poster is loaded first, on purpose. On an empty wall "unchanged" is
 * nearly free to satisfy — the canvas has never been sized. The state worth
 * pinning is the one where a user already has a photo on the wall and then
 * drops a bad file on top of it.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample_2.jpg'))
/** the 4:5 canvas the app ships at its default 1440 long edge */
const DEFAULT = resolveSize('4:5', 1440)

const PDF = Buffer.from(
  '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'latin1',
)

/**
 * A JPEG's opening bytes followed by noise. Not a truncated real file — a
 * stream that announces itself as a JPEG and then cannot be decoded, which is
 * what a half-synced upload or a corrupted card yields.
 */
const CORRUPT = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 37 + 11) & 0xff)),
])

const UNREADABLE = '图片读取失败 — 该格式可能不被此浏览器支持（HEIC 需要 Safari）'

const CASES = [
  {
    what: 'a zero-byte file',
    name: 'empty.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(0),
    message: '文件为空',
  },
  {
    // The case classification cannot catch: a PDF that reaches the browser
    // named `.jpg` is typed `image/jpeg` — the OS maps by extension — so the
    // only thing standing between it and a blank poster is the decode.
    what: 'a PDF renamed .jpg',
    name: 'document.jpg',
    mimeType: 'image/jpeg',
    buffer: PDF,
    message: UNREADABLE,
  },
  {
    what: 'a PDF that still says it is a PDF',
    name: 'document.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
    message: '这不是图片文件',
  },
  {
    what: 'a corrupt byte stream',
    name: 'corrupt.jpg',
    mimeType: 'image/jpeg',
    buffer: CORRUPT,
    message: UNREADABLE,
  },
]

type Digest = { hash: number; lit: number; w: number; h: number }

/**
 * A fingerprint of what is actually on the wall.
 *
 * `lit` is the count of sampled pixels with any opacity at all: it is zero on a
 * canvas that has never been drawn on, which is the blank-poster failure this
 * file exists to catch, and it makes the digest-inequality assertions below
 * non-vacuous. `hash` is FNV-1a over a 4-pixel grid of the whole canvas — cheap
 * enough to run a few times, and sensitive to any change large enough to matter
 * (a re-render from another template, a cleared canvas, a photo that vanished).
 */
async function digest(page: Page): Promise<Digest> {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no 2d context on #cv')
    const w = cv.width
    const h = cv.height
    const d = ctx.getImageData(0, 0, w, h).data
    let hash = 2166136261
    let lit = 0
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const i = (y * w + x) * 4
        hash = ((hash ^ d[i]!) * 16777619) >>> 0
        hash = ((hash ^ d[i + 1]!) * 16777619) >>> 0
        hash = ((hash ^ d[i + 2]!) * 16777619) >>> 0
        if (d[i + 3]! > 0) lit++
      }
    }
    return { hash, lit, w, h }
  })
}

/** One real photo, through the real input, ending in a drawn poster. */
async function loadPoster(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/jpeg',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()
  await expect(page.locator('#toast')).toHaveText(/^已载入 \d+ × \d+$/)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('the fixture loads: a photo through the real input paints the canvas itself', async ({
  page,
}) => {
  // The premise the four cases below rest on, asserted rather than assumed. The
  // canvas is the *logical* size at k=1 — the preview and the export share one
  // layout, so a preview drawn at some other scale would let a user export a
  // poster they never saw. And it is opaque: a revealed but undrawn canvas
  // would be transparent, which would make every "unchanged" below meaningless.
  await loadPoster(page)

  const d = await digest(page)
  expect([d.w, d.h]).toEqual([DEFAULT.W, DEFAULT.H])
  expect(d.lit).toBeGreaterThan(0)
})

for (const c of CASES) {
  test(`[RF-4] ${c.what} is reported, and the poster survives it`, async ({ page }) => {
    await loadPoster(page)
    const before = await digest(page)
    expect(before.lit).toBeGreaterThan(0)

    await page.setInputFiles('#file', {
      name: c.name,
      mimeType: c.mimeType,
      buffer: c.buffer,
    })

    // the message: the app's own words, in the app's own UI, actually on screen
    await expect(page.locator('#toast')).toHaveText(c.message)
    await expect(page.locator('#toast')).toHaveClass(/show/)

    // ...and the canvas, pixel for pixel, is the one that was there before —
    // same size, same lit pixels, same content
    expect(await digest(page)).toEqual(before)
  })
}
