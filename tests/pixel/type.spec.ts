import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 文字 — where the words sit, how large they are, and what they are set in.
 *
 * The three claims that matter, in the order a user meets them: the panel offers
 * exactly the slots the template prints (that rule is old and is still the
 * point), a change to any of the three reaches the poster *and* the record, and
 * the numbers a user can drag to cannot be dragged into a poster the type has
 * left. The last one is the reason the ceilings live in `src/core/limits.ts` and
 * are asserted here against the panel's own DOM.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample_2.jpg'))
const FONT = resolve('tests/fixtures/dejavu-subset.ttf')

const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)
const mode = (page: Page, label: string) => page.locator('.mode', { hasText: label })

async function words(page: Page): Promise<void> {
  await mode(page, '文字').click()
  await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'words')
}

async function load(page: Page): Promise<void> {
  await page.setInputFiles('#file', { name: 'sample.webp', mimeType: 'image/jpeg', buffer: SAMPLE })
  await expect(page.locator('canvas#cv')).toBeVisible()
}

/** The record's own `text`, read back out of the session: "it reached the poster"
 *  and "it is going to come back after a refresh" are two different claims. */
const textOf = (page: Page): Promise<any> =>
  page.evaluate(
    () => (JSON.parse(localStorage.getItem('frame-app-session-v1') ?? '{}') as any).template?.text ?? null,
  )

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

test('the panel is one block per slot the template prints, each named', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)

  // 经典 declares 副标题 above 主标题, and the panel is that list — headed, because
  // a font picker and a size slider are the same two controls for every slot.
  expect(await page.locator('.slot-block .rail-h b').allTextContents()).toEqual(['副标题', '主标题'])
  await expect(page.locator('.font-pick')).toHaveCount(2)

  // 白边 is offered only where there is a band for it: 经典 has no mat, 拍立得 has one
  expect(await page.locator('#fields .seg-btn').allTextContents()).toEqual(['顶部', '居中', '底部'])
  await chip(page, '拍立得').click()
  await words(page)
  expect(await page.locator('#fields .seg-btn').allTextContents()).toEqual(['顶部', '白边', '居中', '底部'])

  // ...and 留白 declares no typography at all, so there is no panel to open: its
  // 文字 button is disabled rather than live and inert
  await chip(page, '留白').click()
  await expect(mode(page, '文字')).toBeDisabled()
  await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'frame')
})

test('the block moves: an anchor, and a nudge', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)
  await page.locator('#fields .field[aria-label="主标题"]').fill('夜航')
  const atBottom = await digest(page)

  await page.locator('#fields .seg-btn', { hasText: '居中' }).click()
  expect(await digest(page), 'the anchor did not move the block').not.toBe(atBottom)
  expect(await textOf(page)).toMatchObject({ anchor: 'center' })

  // the nudge: to the far end of the horizontal range the panel offers, which is
  // what the fit rule leaves either side of centre
  const dx = page.locator('.pos-block .ctl-range').first()
  const max = Number(await dx.getAttribute('max'))
  expect(max).toBeGreaterThan(0)
  await dx.fill(String(max))
  const moved = await digest(page)
  expect(moved, 'the nudge did not move the block').not.toBe(atBottom)
  await expect.poll(async () => (await textOf(page)).dx).toBe(max)

  // ...and it is the *record*, so a refresh comes back nudged
  await page.reload()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await words(page)
  expect(await textOf(page)).toMatchObject({ anchor: 'center', dx: max })
  await expect(page.locator('#fields .seg-btn.on')).toHaveText('居中')
})

test('a size the panel offers always fits the poster it is drawn on', async ({ page }) => {
  // `?dev=1` for the ceilings themselves: the claim is that the DOM's `max` is the
  // number `src/core/limits.ts` derives from the layout, not a round number the
  // panel liked the look of.
  await page.goto('/?dev=1')
  await load(page)
  await words(page)

  // the photograph's box, from the same two functions `render` uses
  const frame = await page.evaluate(() => {
    const w = window as any
    const size = { W: 1152, H: 1440 }
    const aspect = w.__frameCore.aspectOf('4:5', { width: 640, height: 1074 })
    return w.__frameCore.fitRect(size, aspect, 72, 0, 0)
  })

  const domMax = Number(await page.locator('.slot-block').nth(1).locator('.ctl-range').getAttribute('max'))
  const ceiling = await page.evaluate((f) => {
    const w = window as any
    const t = w.__frameTemplates.getTemplate('classic')
    return w.__frameCore.sizeCeiling({ W: 1152, H: 1440 }, t.text, f, 0, 1)
  }, frame)
  expect(domMax).toBeCloseTo(ceiling, 1)
  expect(domMax, 'the panel is not offering room to grow at all').toBeGreaterThan(34)

  // and dragging the size to that ceiling keeps every line on the poster
  await page.locator('.slot-block').nth(1).locator('.ctl-range').fill(String(domMax))
  const inside = await page.evaluate((f) => {
    const w = window as any
    const text = JSON.parse(localStorage.getItem('frame-app-session-v1') ?? '{}').template.text
    const size = { W: 1152, H: 1440 }
    const span = w.__frameCore.textSpan(text, size, 1)
    const y0 = w.__frameCore.blockTop(text, size, span, f, 1)
    return { span, y0 }
  }, frame)
  expect(inside.y0, 'the block ran off the top of the poster').toBeGreaterThanOrEqual(0)
  expect(inside.y0 + inside.span, 'the block ran off the bottom').toBeLessThanOrEqual(1440)
})

test('a face from the list is set on the slot, and written into the record', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)

  await page.locator('.slot-block').nth(1).locator('.font-pick').selectOption('xingkai')
  await expect.poll(async () => (await textOf(page)).slots[1].family).toBe('xingkai')
  // the other slot keeps the face it had: the picker is per line
  expect((await textOf(page)).slots[0].family).toBeUndefined()
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')
})

test('a font file the user brings is loaded, kept, and set on the slot', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)
  const title = page.locator('#fields .field[aria-label="主标题"]')
  // Latin words: the fixture is a Latin subset, and the point of the test is that
  // the *face* reaches the canvas rather than what the words say
  await title.fill('Nightflight')
  const before = await digest(page)

  await page.getByLabel('主标题加载字体').click()
  await page.setInputFiles('#font-file', FONT)

  await expect.poll(async () => (await textOf(page)).slots[1].family).toBe('user:dejavu-subset')
  await expect(page.locator('.toast')).toHaveText(/字体已载入/)
  const withFace = await digest(page)
  expect(withFace, 'the loaded face did not reach the canvas').not.toBe(before)

  // the picker gained it, under its own group
  const pick = page.locator('.slot-block').nth(1).locator('.font-pick')
  await expect(pick).toHaveValue('user:dejavu-subset')
  expect(await pick.locator('optgroup').evaluateAll((els) => els.map((e) => e.getAttribute('label')))).toEqual([
    '中文',
    '西文',
    '我加载的',
  ])

  // and it is kept: the bytes are in the store and the face is registered again
  // on boot, which is what makes the poster after the reload the same poster
  await page.reload()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await words(page)
  await expect(page.locator('.slot-block').nth(1).locator('.font-pick')).toHaveValue('user:dejavu-subset')
  await expect
    .poll(() => digest(page), { message: 'the restored poster is not the one with the loaded face' })
    .toBe(withFace)
})

test('a file that is not a font is refused, and nothing is kept', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)

  await page.getByLabel('主标题加载字体').click()
  await page.setInputFiles('#font-file', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not a font, it is a sentence about one'),
  })

  await expect(page.locator('.toast')).toHaveText(/读不出这个字体/)
  const family = await page.evaluate(
    () => JSON.parse(localStorage.getItem('frame-app-session-v1') ?? '{}').template?.text?.slots[1]?.family,
  )
  expect(family, 'a refused file was written into the record anyway').toBeUndefined()

  // nothing was stored under that name either: the picker has no 我加载的 group
  await page.reload()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await words(page)
  const groups = await page
    .locator('.slot-block')
    .nth(1)
    .locator('.font-pick optgroup')
    .evaluateAll((els) => els.map((e) => e.getAttribute('label')))
  expect(groups).toEqual(['中文', '西文'])
})

test('重置 and 撤销 cover the typography, like everything else in the record', async ({ page }) => {
  await page.goto('/')
  await load(page)
  await words(page)
  const pick = page.locator('.slot-block').nth(1).locator('.font-pick')
  const asAuthored = await digest(page)

  await pick.selectOption('kaiti')
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')
  await expect(page.locator('#mount-reset')).toBeEnabled()

  // 撤销 puts the face back — and it is reachable from the 文字 panel, because it
  // belongs to the record rather than to one of the two panels
  await page.click('#undo-desk')
  await expect(pick).toHaveValue('default')
  expect(await digest(page)).toBe(asAuthored)

  // 重置 does too, and the panel follows it: a 文字 panel still showing the face
  // that was just reset would be describing a record the app is not holding
  await pick.selectOption('kaiti')
  await page.click('#mount-reset')
  await expect(pick).toHaveValue('default')
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
  expect(await digest(page)).toBe(asAuthored)
})
