import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 照片 — the left column: several photographs loaded at once, one of them on the
 * wall, each switchable and removable.
 *
 * The claims here are the ones a list can get wrong and a unit test cannot see:
 * that the wall actually moves when a row is clicked, that the rail's previews
 * move with it (they are renders of the *active* photograph, so a switch is ten
 * new previews and not one), that the camera plate reads the photograph that is
 * on rather than the one that was loaded first, and that deleting never leaves
 * the wall pointing at nothing while there is still something to show.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))
/** A Nikon D810 frame with its full tag set — 85 mm, f/15, 1/125, ISO 64 — so
 *  the spec plate has something to print. The pixels are procedural and the
 *  repository owns them; see `tests/fixtures/README.md`. */
const CAMERA = readFileSync(resolve('tests/fixtures/with-exif.jpg'))

const row = (page: Page, name: string) => page.locator(`.ph-pick[aria-label="${name}"]`)
const count = (page: Page) => page.locator('#photo-count')

async function load(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page.setInputFiles(
    '#file',
    files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: f.buffer })),
  )
}

async function digest(page: Page): Promise<number> {
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
    return hash
  })
}

/** The rail's ten chip images, as their data URLs — one string per style. */
async function previews(page: Page): Promise<string[]> {
  return page
    .locator('#rail .print')
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage))
}

test('the column starts empty and says so', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.photos')).toBeVisible()
  await expect(page.locator('.photo-list .ph-empty')).toHaveText('还没有照片')
  await expect(page.locator('.photo-list .ph')).toHaveCount(0)
  // No photograph means no count to state: "0 / 0" is a number about nothing.
  await expect(count(page)).toHaveText('')
})

test('a batch lands as a list, and the wall takes the first of it', async ({ page }) => {
  await page.goto('/')
  await load(page, [
    { name: 'sample.webp', buffer: SAMPLE },
    { name: 'camera.jpg', buffer: CAMERA },
  ])
  await expect(page.locator('canvas#cv')).toBeVisible()

  await expect(page.locator('.photo-list .ph')).toHaveCount(2)
  await expect(page.locator('.photo-list .ph-empty')).toHaveCount(0)
  await expect(row(page, 'sample')).toHaveCount(1)
  await expect(row(page, 'camera')).toHaveCount(1)
  // the first of the batch is the one on the wall — one rule, stated once
  await expect(row(page, 'sample')).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, 'camera')).toHaveAttribute('aria-pressed', 'false')
  await expect(count(page)).toHaveText('1 / 2')
})

test('clicking a row moves the wall, and the previews with it', async ({ page }) => {
  await page.goto('/')
  await load(page, [
    { name: 'sample.webp', buffer: SAMPLE },
    { name: 'camera.jpg', buffer: CAMERA },
  ])
  await expect(page.locator('canvas#cv')).toBeVisible()

  const first = await digest(page)
  const firstPreviews = await previews(page)

  await row(page, 'camera').click()

  const after = await digest(page)
  expect(after, 'the wall did not move to the photograph that was clicked').not.toBe(first)
  await expect(row(page, 'camera')).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, 'sample')).toHaveAttribute('aria-pressed', 'false')
  await expect(count(page)).toHaveText('2 / 2')

  // The rack is renders of the *active* photograph, so a switch is ten new
  // previews. This is the assertion that keeps the rail from showing a
  // photograph the wall is not on.
  const secondPreviews = await previews(page)
  expect(secondPreviews).not.toEqual(firstPreviews)
  for (const bg of secondPreviews) {
    expect(bg, 'a chip kept the previous photograph').toMatch(/^url\("data:image\/png;base64,/)
  }

  // ...and back, byte for byte
  await row(page, 'sample').click()
  expect(await digest(page)).toBe(first)
  expect(await previews(page)).toEqual(firstPreviews)
})

test('the camera plate reads the photograph that is on', async ({ page }) => {
  await page.goto('/')
  await load(page, [
    { name: 'sample.webp', buffer: SAMPLE },
    { name: 'camera.jpg', buffer: CAMERA },
  ])
  await page.locator('.print[aria-label="样张"]').click()
  // 样张's own mode is 无照片 — a white sheet and nothing behind it — and the wall's
  // mode is sticky across picks, so the mode this test's band arithmetic assumes is
  // chosen here rather than inherited from whatever the app booted in.
  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  await expect(page.locator('canvas#cv')).toBeVisible()

  /**
   * Ink in the bottom band of the poster — the white mat strip the plate is
   * laid out in. 样张's background is a flat `#FFFFFF` and its mat is white too,
   * so on this template every dark pixel in that band belongs to the plate (the
   * test types no words, which is the only other thing drawn there).
   */
  const plateInk = () =>
    page.evaluate(() => {
      const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
      const ctx = cv.getContext('2d')!
      const y0 = Math.floor(cv.height * 0.89)
      const d = ctx.getImageData(0, y0, cv.width, cv.height - y0).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! < 120 && d[i + 1]! < 120 && d[i + 2]! < 120) n++
      }
      return n
    })

  // The sample has no EXIF at all, so there is nothing to caption.
  await expect(row(page, 'sample')).toHaveAttribute('aria-pressed', 'true')
  const none = await plateInk()
  expect(none, 'the plate printed something for a photograph with no EXIF').toBe(0)

  await row(page, 'camera').click()
  const printed = await plateInk()
  expect(printed, 'the plate stayed empty for a photograph that carries EXIF').toBeGreaterThan(0)

  // ...and back: the plate is not a one-way latch, it follows the list
  await row(page, 'sample').click()
  expect(await plateInk()).toBe(0)
})

test('the × drops a row and leaves the wall where it was', async ({ page }) => {
  await page.goto('/')
  await load(page, [
    { name: 'sample.webp', buffer: SAMPLE },
    { name: 'camera.jpg', buffer: CAMERA },
  ])
  await expect(page.locator('canvas#cv')).toBeVisible()
  const onSample = await digest(page)

  // removing a photograph that is not the one on the wall moves nothing
  await page.locator('.ph-del[aria-label="移除 camera"]').click()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect(count(page)).toHaveText('1 / 1')
  expect(await digest(page)).toBe(onSample)
  await expect(page.locator('#toast')).toContainText('已移除 camera')

  // removing the last one is the app's default state, not an error: a bare wall
  await page.locator('.ph-del[aria-label="移除 sample"]').click()
  await expect(page.locator('.photo-list .ph')).toHaveCount(0)
  await expect(page.locator('.photo-list .ph-empty')).toHaveText('还没有照片')
  await expect(count(page)).toHaveText('')
  await expect(page.locator('canvas#cv')).toBeHidden()
})

test('removing the photograph on the wall lands on one that is still there', async ({ page }) => {
  await page.goto('/')
  await load(page, [
    { name: 'sample.webp', buffer: SAMPLE },
    { name: 'camera.jpg', buffer: CAMERA },
  ])
  await expect(page.locator('canvas#cv')).toBeVisible()

  // what the wall looks like on the second photograph, measured while both are
  // still in the list
  await row(page, 'camera').click()
  const onCamera = await digest(page)
  await row(page, 'sample').click()

  await page.locator('.ph-del[aria-label="移除 sample"]').click()

  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect(count(page)).toHaveText('1 / 1')
  // the wall is on the photograph that took the removed one's place, and never
  // on nothing while something is left
  expect(await digest(page)).toBe(onCamera)
  await expect(row(page, 'camera')).toHaveAttribute('aria-pressed', 'true')
})
