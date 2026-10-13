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

/**
 * The rail's chips are prints of the user's photograph — the treatment the
 * design sheet gives `.print .rawshot` — so the rack reads as a rack of mounts
 * rather than nine identical blank rectangles.
 *
 * The claim has three parts and they are not the same claim: the chips are
 * blank until there is a photograph, every chip carries it once there is one
 * (a rail painted only on a *pick* would leave the user looking at blank mounts
 * at the exact moment the print matters), and what it carries is the
 * photograph — a crop with more than one colour in it, not a flat fill.
 */
test('every chip carries the photograph once there is one', async ({ page }) => {
  await page.goto('/')

  const bare = await page
    .locator('#rail .print')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage))
  expect(bare.every((bg) => bg === 'none'), 'the blank rail should be blank').toBe(true)

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
    expect(bg, 'a chip came back without its print').toMatch(/^url\("data:image\/png;base64,/)
  }

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
  expect(colours, 'the print is a flat fill, not the photograph').toBeGreaterThan(4)
})
