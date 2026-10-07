import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../../src/core/templates'

/**
 * Saved templates, end to end: the write half was already committed, and none
 * of it was reachable. What these tests are here to catch is precisely the
 * failure a unit test cannot see — a `loadCustom` that returns the perfect list
 * to a caller that never renders it. Every assertion below is made against the
 * running app: the rail DOM, the pixels on the wall, and the computed style of
 * the chip the user just made.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))

const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)

/** A fingerprint of the wall, so "it applied" is a claim about pixels. */
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

async function loadPhoto(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()
}

/** Press 存为模板 and answer the name prompt the way a user would. */
async function saveAs(page: Page, name: string): Promise<void> {
  page.once('dialog', (d) => void d.accept(name))
  await page.click('#saveTpl')
}

test('a saved template reaches the rail, and picking it applies it', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)

  // Start from a style that is not the boot default, so "applied" below is a
  // change the wall can show: 拍立得 is the copy's parent, 经典 is a way off it.
  await chip(page, '拍立得').click()
  const asBuiltIn = await digest(page)

  await saveAs(page, '我的拍立得')

  // It is on the rail — as a chip, not merely as bytes in a store — and the
  // rail grew by one rather than by a whole second list.
  const saved = chip(page, '我的拍立得')
  await expect(saved).toHaveCount(1)
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length + 1)
  await expect(page.locator('#toast')).toContainText('已保存模板：我的拍立得')
  // Saving files the current style away; it does not switch to the copy, so
  // the wall is still 拍立得's and the new chip is the only off one of the two.
  await expect(saved).toHaveAttribute('aria-pressed', 'false')
  await expect(chip(page, '拍立得')).toHaveAttribute('aria-pressed', 'true')

  // Away to a built-in, then back to the saved one: the chip has to resolve
  // through `pick` against the same merged list the rail was drawn from, and
  // the wall has to come back to what 拍立得 rendered — byte for byte, because
  // a copy of a template is that template.
  await chip(page, '经典').click()
  expect(await digest(page)).not.toEqual(asBuiltIn)

  await saved.click()
  await expect(saved).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '经典')).toHaveAttribute('aria-pressed', 'false')
  expect(await digest(page)).toEqual(asBuiltIn)
})

test("a saved chip is marked as the user's own, and never with the premium brass", async ({ page }) => {
  await page.goto('/')
  await saveAs(page, '我的模板')

  const saved = chip(page, '我的模板')
  const builtIn = chip(page, '竖版故事') // off, and not the premium one

  await expect(saved).toHaveClass(/\bcustom\b/)
  await expect(builtIn).not.toHaveClass(/\bcustom\b/)
  // brass is the premium marker and stays exclusive: the one premium template
  // wears it, the saved chip does not, and the rail is still nine-tenths
  // built-ins rather than premium-looking
  await expect(page.locator('#rail .print.brass')).toHaveCount(1)
  await expect(saved).not.toHaveClass(/brass/)

  // The marker is a real rendered thing, not a class that styles nothing. It is
  // drawn on `::before` — the same pseudo-element the brass corner uses, so a
  // saved template that is also selected shows the marker *and* `.on`'s ring.
  const marker = async (loc: typeof saved) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el, '::before')
      return { content: s.content, width: s.borderTopWidth, style: s.borderTopStyle }
    })

  expect(await marker(saved)).toEqual({ content: '""', width: '1px', style: 'solid' })
  expect(await marker(builtIn)).toEqual({ content: 'none', width: '0px', style: 'none' })

  // And it changes what is on screen. Both chips are off and neither is
  // premium, so their boxes are identical in every other respect: if the
  // hairline went away, these two images would be the same image.
  const [mine, theirs] = [await saved.screenshot(), await builtIn.screenshot()]
  expect(mine.length).toBeGreaterThan(0)
  expect(mine.equals(theirs)).toBe(false)
})

test('a store that fills up mid-session carries what it holds into the session', async ({ page }) => {
  // A template saved last week, and then a store that starts refusing writes:
  // reads still work, `setItem` throws. This is the other half of §9 — the
  // first half, where the property itself throws, is the test below — and the
  // one where a naive fallback drops the library on the floor.
  await page.addInitScript(() => {
    localStorage.setItem(
      'frame-app-custom-v1',
      JSON.stringify([
        {
          id: 'custom-seed',
          name: '已有的',
          layout: { kind: 'single' },
          canvas: { ratio: '4:5' },
          background: { mode: 'blur', blur: 28, darken: 30, zoom: 118 },
          frame: { scale: 72, radius: 8, mat: 0, matBottom: 0, shadow: 45 },
        },
      ]),
    )
    Storage.prototype.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
  })

  await page.goto('/')
  // Read across a reload: what was saved in an earlier session is on the rail.
  await expect(chip(page, '已有的')).toHaveCount(1)

  await saveAs(page, '新的')
  await expect(page.locator('#toast')).toContainText('仅本次会话')
  await expect(chip(page, '新的')).toHaveCount(1)
  // The template that was on the rail before the store filled up is still on
  // it: the fallback carried the list, it did not start from empty.
  await expect(chip(page, '已有的')).toHaveCount(1)
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length + 2)

  // A third save, now writing to the session store the switch handed the rail:
  // three templates, three chips, no second copy of anything.
  await saveAs(page, '更晚的')
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length + 3)
  for (const name of ['已有的', '新的', '更晚的']) await expect(chip(page, name)).toHaveCount(1)
})

test('with no browser store, a save survives the session — and only lands once', async ({ page }) => {
  // Safari's private mode, and every embedded webview that blocks storage: the
  // *property* throws rather than returning null, which is the case
  // `browserStorage()` exists to survive and the one `loadCustom(null)` covers.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage is denied') },
    })
  })

  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '电影感').click()
  const asBuiltIn = await digest(page)

  await saveAs(page, '甲的模板')
  const first = chip(page, '甲的模板')
  await expect(first).toHaveCount(1)
  await expect(page.locator('#toast')).toContainText('仅本次会话')

  // The second save is the one that catches a session list kept *beside* the
  // store instead of inside it: the rail reads what the save wrote, so two
  // saves are two chips and never four.
  await saveAs(page, '乙的模板')
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length + 2)
  await expect(chip(page, '甲的模板')).toHaveCount(1)
  await expect(chip(page, '乙的模板')).toHaveCount(1)

  // Session-only still means usable: the first one resolves and applies, and
  // it renders what 电影感 rendered.
  await chip(page, '经典').click()
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  expect(await digest(page)).toEqual(asBuiltIn)
})
