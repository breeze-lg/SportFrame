import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../../src/core/templates'

/**
 * The template rail: the app's second action after a photo lands, and the only
 * way a visitor chooses a mount. What it has to do is small and entirely
 * observable — offer every template, say which one is on, and re-render the
 * wall when one is picked.
 *
 * The chips carry no text (see `src/ui/rail.ts`): a blank print each, named by
 * `aria-label`. So the names are asserted the way a screen reader would read
 * them, not by reading a label that is not there.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))

/** A fingerprint of the wall, so "it re-rendered" is a claim about pixels. */
async function digest(page: Page): Promise<{ hash: number; w: number; h: number }> {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no 2d context on #cv')
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    let hash = 2166136261
    for (let y = 0; y < cv.height; y += 4) {
      for (let x = 0; x < cv.width; x += 4) {
        const i = (y * cv.width + x) * 4
        hash = ((hash ^ d[i]!) * 16777619) >>> 0
        hash = ((hash ^ d[i + 1]!) * 16777619) >>> 0
        hash = ((hash ^ d[i + 2]!) * 16777619) >>> 0
      }
    }
    return { hash, w: cv.width, h: cv.height }
  })
}

const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)

test('the rail offers every template by name, with the current one marked', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length)
  for (const t of TEMPLATES) await expect(chip(page, t.name)).toHaveCount(1)

  // the app boots on the first template, and the rail says so — to the eye
  // (`.on`) and to assistive tech (`aria-pressed`), which are two separate
  // claims about the same state
  const first = TEMPLATES[0]!
  await expect(chip(page, first.name)).toHaveClass(/\bon\b/)
  await expect(chip(page, first.name)).toHaveAttribute('aria-pressed', 'true')

  const others = page.locator('#rail .print[aria-pressed="false"]')
  await expect(others).toHaveCount(TEMPLATES.length - 1)

  // exactly one premium template, and it is the one wearing the brass corner
  await expect(page.locator('#rail .print.brass')).toHaveCount(1)
  const premium = TEMPLATES.find((t) => t.premium)!
  await expect(chip(page, premium.name)).toHaveClass(/brass/)
})

test('picking a template re-renders the wall through the same spine', async ({ page }) => {
  await page.goto('/')
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()

  const before = await digest(page)

  // 拍立得 is 4:5 like the default, so the canvas keeps its size: what changes
  // below is the picture on it, not a resize.
  await chip(page, '拍立得').click()

  await expect(chip(page, '拍立得')).toHaveClass(/\bon\b/)
  await expect(chip(page, '经典')).toHaveAttribute('aria-pressed', 'false')

  const after = await digest(page)
  expect([after.w, after.h]).toEqual([before.w, before.h])
  expect(after.hash).not.toBe(before.hash)
})

/** The width-to-height a chip's box should have, from the template's own canvas
 *  ratio: the box is the style's shape (see `styleThumb`). */
const RATIO: Record<string, number> = {
  '4:5': 0.8,
  '1:1': 1,
  '3:2': 1.5,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

/**
 * The chips are the styles themselves: each is a small render of the poster that
 * style makes of the photograph in hand (see `styleThumb`), so the rack says
 * what a style *is* before a visitor commits to it — the thing a rack of nine
 * identical crops of one photograph could not do.
 *
 * Four claims, and they are not the same claim:
 *
 *  - blank until there is a photograph: a poster is a photograph framed, and
 *    there is nothing to render;
 *  - the boxes still carry each style's canvas ratio, so the rack says which
 *    styles are wide, tall or square before anything is loaded;
 *  - every chip carries a render once there is a photograph;
 *  - and no two styles render the same picture — which is the one a preview
 *    cannot be without, and the exact defect this replaced (nine chips that were
 *    the same crop of the same photograph).
 */
test('every chip is a preview of its own style, and no two are the same picture', async ({ page }) => {
  await page.goto('/')

  const bare = await page
    .locator('#rail .print')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage))
  expect(bare.every((bg) => bg === 'none'), 'a chip carried a preview with no photograph').toBe(true)

  // The boxes, before any photograph: the style's own shape, from its ratio.
  // `boundingBox` includes the chip's 1px border, and the numbers are the rounded
  // device pixels halved (see `styleThumb`), so this is a tolerance rather than
  // an equality — a chip that ignored the ratio misses it by a mile, not by a
  // hundredth.
  const shapes = await page.locator('#rail .print').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return (r.width - 2) / (r.height - 2)
    }),
  )
  for (const [i, t] of TEMPLATES.entries()) {
    expect(
      Math.abs(shapes[i]! - RATIO[t.canvas.ratio]!),
      `${t.id}: the chip box is ${shapes[i]!.toFixed(3)}, the canvas ratio ${RATIO[t.canvas.ratio]!.toFixed(3)}`,
    ).toBeLessThan(0.05)
  }

  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()

  const prints = await page
    .locator('#rail .print')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage))
  expect(prints).toHaveLength(TEMPLATES.length)
  for (const bg of prints) {
    expect(bg, 'a chip came back without a preview').toMatch(/^url\("data:image\/png;base64,/)
  }

  // The load-bearing one. Nine chips that are the same picture are the defect
  // this feature replaced, and they would satisfy every assertion above.
  expect(new Set(prints).size, 'two styles rendered the same preview').toBe(prints.length)

  // And a preview is a poster, not a flat fill: the first chip is 经典, whose
  // blur backdrop alone is thousands of colours.
  const colours = await page.locator('#rail .print').first().evaluate(async (el) => {
    const url = getComputedStyle(el).backgroundImage.slice(5, -2)
    const bmp = await createImageBitmap(await (await fetch(url)).blob())
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const seen = new Set<string>()
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]! >> 4},${d[i + 1]! >> 4},${d[i + 2]! >> 4}`)
    return seen.size
  })
  expect(colours, 'the preview is a flat fill, not a poster').toBeGreaterThan(4)
})
