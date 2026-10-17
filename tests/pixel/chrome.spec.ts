import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../../src/core/templates'

/**
 * The chrome the reference editor gave this app: the collections above the rack,
 * the switch that shows one panel at a time, and the two arrows.
 *
 * The layout is `tests/pixel/layout.spec.ts`'s subject — where these things sit
 * and in what order. What is here is what they *do*: a tab filters the rack and
 * leaves the poster alone, a mode shows one panel and hides the other, the mount
 * that is on opens its own numbers instead of doing nothing, and 撤销 walks back
 * through the poster the way the user made it.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample_2.jpg'))

const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)
const tab = (page: Page, label: string) => page.locator('.tab', { hasText: label })
const mode = (page: Page, label: string) => page.locator('.mode', { hasText: label })

async function load(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/jpeg',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()
}

/** A fingerprint of the wall: "the rack changed and the poster did not" is a
 *  claim about pixels, not about a class name. */
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

const names = (page: Page) =>
  page
    .locator('#rail .print')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

test.describe('the collections', () => {
  test('filter the rack, and leave the poster alone', async ({ page }) => {
    await page.goto('/')
    await load(page)
    const poster = await digest(page)

    expect(await names(page), '全部 is not the whole rack').toEqual(TEMPLATES.map((t) => t.name))

    await tab(page, '参数牌').click()
    expect(await names(page), '参数牌 is not exactly 样张').toEqual(['样张'])

    await tab(page, '满幅').click()
    expect(await names(page)).toEqual(['经典', '杂志封面', '电影感', '留白', '社媒方形', '竖版故事'])

    await tab(page, '有白边').click()
    expect(await names(page)).toEqual(['拍立得', '明信片', '样张'])

    // the two are a partition: every style is in exactly one of them
    const full = await tab(page, '满幅').click().then(() => names(page))
    const bordered = await tab(page, '有白边').click().then(() => names(page))
    expect(full.length + bordered.length).toBe(TEMPLATES.length)

    // ...and browsing is not editing: the wall is showing exactly what it was,
    // because a tab is a view of the rack and not a choice about the poster
    expect(await digest(page), 'browsing the collections changed the poster').toBe(poster)
    // ...and the mount that is on is still on — it is not even in the tab that is
    // showing, which is the whole reason the caption under the poster exists.
    await expect(page.locator('#cap-name')).toHaveText('经典')
    expect(await names(page)).not.toContain('经典')
    await expect(page.locator('.tab.on')).toHaveText('有白边')

    // back to the rack that holds it, and it is still the one pressed
    await tab(page, '全部').click()
    await expect(chip(page, '经典')).toHaveAttribute('aria-pressed', 'true')
  })

  test('我的 arrives with the first saved template and leaves with the last', async ({ page }) => {
    page.on('dialog', (d) => void d.accept('我的样式'))
    await page.goto('/')
    await expect(tab(page, '我的'), 'an empty 我的 is a dead end').toHaveCount(0)

    await page.click('#saveTpl')
    await expect(tab(page, '我的')).toHaveCount(1)

    await tab(page, '我的').click()
    expect(await names(page)).toEqual(['我的样式'])

    // Deleting it empties the tab, and a selection left pointing at an empty tab
    // would be a rack with nothing on it and no word about why: the strip falls
    // back to 全部 and shows the whole product again.
    await page.locator('#rail .del').click()
    await expect(tab(page, '我的')).toHaveCount(0)
    await expect(page.locator('.tab.on')).toHaveText('全部')
    expect(await names(page)).toEqual(TEMPLATES.map((t) => t.name))
  })
})

test.describe('the panel switch', () => {
  test('shows one panel at a time', async ({ page }) => {
    await page.goto('/')
    await load(page)

    // 画面 to begin with: the mount is what a photograph is put in
    await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'frame')
    await expect(page.locator('#controls')).toBeVisible()
    await expect(page.locator('#fields')).toBeHidden()
    await expect(mode(page, '画面')).toHaveAttribute('aria-pressed', 'true')

    await mode(page, '文字').click()
    await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'words')
    await expect(page.locator('#fields')).toBeVisible()
    await expect(page.locator('#controls')).toBeHidden()
    await expect(mode(page, '文字')).toHaveAttribute('aria-pressed', 'true')

    // the panel that is up survives a pick, because it is a question about the
    // poster rather than about the mount: 经典 → 拍立得 keeps the fields up
    await chip(page, '拍立得').click()
    await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'words')
    await expect(page.locator('#fields')).toBeVisible()
  })

  test('a template with no typography has no 文字 to open', async ({ page }) => {
    await page.goto('/')
    await chip(page, '留白').click()

    // disabled with the reason on it, rather than live and inert
    await expect(mode(page, '文字')).toBeDisabled()
    await expect(mode(page, '文字')).toHaveAttribute('title', /.+/)
    await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'frame')
    await expect(page.locator('#fields')).toBeHidden()

    // and back to a template that does print words: the switch comes back
    await chip(page, '经典').click()
    await expect(mode(page, '文字')).toBeEnabled()
  })

  test('the mount that is on opens its own numbers instead of doing nothing', async ({ page }) => {
    await page.goto('/')
    await load(page)

    await page.locator('#control-row .ctl-range').first().fill('40')
    await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')

    // ...off to 文字, then a press on the chip that is on: the knob drawn in the
    // middle of it is the promise this keeps
    await mode(page, '文字').click()
    await chip(page, '经典').click()
    await expect(page.locator('#panels')).toHaveAttribute('data-mode', 'frame')

    // and it did *not* re-pick the mount: the numbers the user moved are still
    // theirs, which is the thing the old gesture took away without saying so
    await expect(
      page.locator('#record-acts'),
      'pressing the chip that is on took the edits with it',
    ).toHaveAttribute('data-adjusted', 'true')
  })
})

test.describe('撤销 / 重做', () => {
  test('walk the mount back and forward', async ({ page }) => {
    await page.goto('/')
    await load(page)
    const bare = await digest(page)

    // nothing to undo yet, and the arrows say so rather than being absent
    await expect(page.locator('#undo-desk')).toBeDisabled()
    await expect(page.locator('#redo-desk')).toBeDisabled()

    await page.locator('#control-row .ctl-range').first().fill('40')
    await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')
    await expect(page.locator('#undo-desk')).toBeEnabled()

    await page.click('#undo-desk')
    await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
    expect(await digest(page), '撤销 did not put the poster back').toBe(bare)
    await expect(page.locator('#undo-desk')).toBeDisabled()
    await expect(page.locator('#redo-desk')).toBeEnabled()

    await page.click('#redo-desk')
    await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')
    expect(await digest(page), '重做 did not put the edit back').not.toBe(bare)
  })

  test('a word typed is one step, not one per keystroke', async ({ page }) => {
    await page.goto('/')
    await load(page)
    const bare = await digest(page)

    await mode(page, '文字').click()
    const title = page.locator('#fields .field[aria-label="主标题"]')
    await title.click()
    await page.keyboard.type('以梦为马')
    expect(await digest(page), 'typing did not reach the poster').not.toBe(bare)

    // One press, not four: the burst rule (`COALESCE_MS`) is what makes 撤销 a
    // control people use instead of a rewind.
    await page.click('#undo-desk')
    expect(await digest(page), 'one press of 撤销 did not clear the whole word').toBe(bare)
    await expect(title).toHaveValue('')
  })

  test('the arrows are in the bar on a phone and in the dock on a desk', async ({ page }) => {
    // The same two controls in the two arrangements, like 保存 — and exactly one
    // pair of them on screen at a time.
    await page.goto('/')
    await expect(page.locator('#undo-desk')).toBeVisible()
    await expect(page.locator('#undo')).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('#undo')).toBeVisible()
    await expect(page.locator('#undo-desk')).toBeHidden()
  })
})
