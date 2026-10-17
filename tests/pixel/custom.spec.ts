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

const SAMPLE = readFileSync(resolve('public/sample/sample_2.jpg'))

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
    mimeType: 'image/jpeg',
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

const lum = (p: number[]) => 0.299 * p[0]! + 0.587 * p[1]! + 0.114 * p[2]!

/**
 * A chip's pixels, decoded by the browser itself: there is no image library in
 * the dependency set and there must not be one, so the PNG goes back into the
 * page as a data URL and comes back as rows.
 *
 * `element.screenshot()` clips to the element's box rounded outward, so the
 * image can be a row taller than the 62px the CSS asks for. Nothing below
 * assumes a height; the strips are taken from the image's own last row.
 */
async function decode(page: Page, png: Buffer): Promise<number[][][]> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const rows: number[][][] = []
    for (let y = 0; y < bmp.height; y++) {
      const row: number[][] = []
      for (let x = 0; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4
        row.push([d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!])
      }
      rows.push(row)
    }
    return rows
  }, png.toString('base64'))
}

/**
 * How two chips differ, and where.
 *
 * `from` defaults to the bottom 10 rows: `.print.custom::before` and
 * `.print.on::after` both put their line three pixels above the chip's inner
 * bottom edge, so that strip is where the mark is, where the ring lands, and
 * nowhere else. Measured, the unselected pair differs on exactly one row —
 * 42 pixels wide, the hairline's `left: 3px; right: 3px` inset by the chip's
 * own 1px borders.
 */
function markDelta(a: number[][][], b: number[][][], from?: number) {
  // The two chips must be *the same chip* for a pixel difference to mean
  // anything, and every caller compares a saved copy against the template it was
  // copied from: same template, same shape, same picture. That is a real
  // precondition now rather than an accident of the CSS, because a chip's box
  // follows its canvas ratio (`styleThumb`) — comparing across two styles would
  // be comparing two different sizes, and the offset below would compare the
  // wrong pixels.
  //
  // A single pixel of slack: `element.screenshot()` clips to the element's box
  // rounded *outward*, and the rail centres its chips, so two chips of identical
  // width can sit on a fractional x and be rasterised a pixel apart. The comparison
  // below runs over the overlap, and the mark it is looking for is a 42px
  // hairline inset 3px from either edge — nowhere near the pixel this drops.
  expect(
    Math.abs(a.length - b.length),
    'the two chips are different heights — compare a copy against the template it came from',
  ).toBeLessThanOrEqual(2)
  expect(
    Math.abs(a[0]!.length - b[0]!.length),
    'the two chips are different widths — compare a copy against the template it came from',
  ).toBeLessThanOrEqual(2)

  const height = Math.min(a.length, b.length)
  const width = Math.min(a[0]!.length, b[0]!.length)
  const start = from ?? Math.max(0, height - 10)
  const rows: number[] = []
  let delta = 0
  let n = 0
  let lumA = 0
  let lumB = 0
  for (let y = start; y < height; y++) {
    let hit = false
    for (let x = 0; x < width; x++) {
      const mine = a[y]![x]!
      const theirs = b[y]![x]!
      const d = Math.max(
        Math.abs(mine[0]! - theirs[0]!),
        Math.abs(mine[1]! - theirs[1]!),
        Math.abs(mine[2]! - theirs[2]!),
      )
      if (d > 0) {
        hit = true
        n += 1
        lumA += lum(mine)
        lumB += lum(theirs)
      }
      delta = Math.max(delta, d)
    }
    if (hit) rows.push(y)
  }
  return { height, rows, delta, n, lumA: n ? lumA / n : 0, lumB: n ? lumB / n : 0 }
}

/**
 * The finding this covers: `.print.custom::before` is drawn at `bottom: 3px`,
 * which is the row `.print.on::after`'s ring draws its bottom border on, and
 * `::after` paints after `::before`. A selected saved chip is therefore a
 * marked chip with its own ring on top of the mark.
 *
 * It has to still be a marked chip. The ring is 55% opaque, so the pixels it
 * covers carry what is underneath them — the two chips below are otherwise
 * identical, and if the ring ever painted the hairline out, this pair would be
 * the same picture.
 */
test('the mark on a saved chip survives being the selected chip', async ({ page }) => {
  await page.goto('/')

  // 拍立得 and not the boot template: the pair below has to be two chips of the
  // same *shape* for a pixel difference to be about the mark, and a saved copy
  // is only ever the same shape as the template it was copied from. 拍立得 is
  // also not the premium one.
  await chip(page, '拍立得').click()
  await saveAs(page, '我的模板')
  // ...and then off it again, because the first half of this test is about the
  // mark on an *unselected* chip: 拍立得 was selected to be copied, so both chips
  // would otherwise wear `.on`'s ring and the ring — an ink line, where the mark
  // is the bevel grey — would be what the pixels below are measuring.
  await chip(page, '经典').click()

  const saved = chip(page, '我的模板')
  const builtIn = chip(page, '拍立得')

  // First, where the mark is: the chip's bottom strip, which is where the mark
  // is claimed to live. This used to run from row 0, on the claim that the mark
  // was the *only* difference between a saved chip and a built-in one. That is
  // no longer true, and deliberately so: a saved chip now carries the × that
  // removes it, whose cell crosses rows the mark does not. Measuring the strip
  // keeps this test's own claim — the mark is real, bottom-weighted, and in the
  // bevel grey — while the × is asserted where it belongs, in the delete tests.
  const off = markDelta(
    await decode(page, await saved.screenshot()),
    await decode(page, await builtIn.screenshot()),
  )
  expect(off.n, 'a saved chip and a built-in chip are the same picture').toBeGreaterThan(0)
  expect(
    off.delta,
    `a mark this faint is a wash, not a hairline: ${off.delta}`,
  ).toBeGreaterThanOrEqual(10)
  expect(
    Math.min(...off.rows),
    `the mark is not bottom-weighted: rows ${off.rows.join(',')} of ${off.height}`,
  ).toBeGreaterThanOrEqual(off.height - 10)
  // and it is the bevel grey — a dark line on the light theme's white chip
  expect(off.lumA).toBeLessThan(off.lumB)

  // Then, that it is still there when the chip is the selected one. Both chips
  // are `.on` for this pair, so the ring cannot be what tells them apart.
  await saved.click()
  await expect(saved).toHaveAttribute('aria-pressed', 'true')
  const mineOn = await decode(page, await saved.screenshot())
  await builtIn.click()
  await expect(builtIn).toHaveAttribute('aria-pressed', 'true')
  const theirsOn = await decode(page, await builtIn.screenshot())

  const on = markDelta(mineOn, theirsOn)
  expect(
    on.delta,
    `the ring painted the mark out: the selected pair differs by ${on.delta}`,
  ).toBeGreaterThanOrEqual(10)
  expect(on.lumA).toBeLessThan(on.lumB)
})

test('the rail carries the mark in dark theme too', async ({ page }) => {
  // The marker has never been asserted anywhere but the light theme, where
  // `--bevel` is a grey line on a white chip. Dark inverts it: `--bevel` is
  // lighter than `--surface`, so the same hairline is a light line on near
  // black. That is a different rendering of the same gesture, and the one a
  // visitor whose system prefers dark sees first.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await chip(page, '拍立得').click()
  await saveAs(page, '夜里的模板')
  // off again, for the reason the light-theme test above gives: the ring and the
  // mark are different lines in different greys
  await chip(page, '经典').click()

  const saved = chip(page, '夜里的模板')
  // the copy's own parent, as in the selection test above: two chips of one
  // shape, so the only difference the pixels can carry is the mark
  const builtIn = chip(page, '拍立得')

  // the bottom strip, as in the selection test above and for the same reason:
  // the × a saved chip wears is a difference in the chip's top-right, and this
  // test is about the hairline at its foot
  const mark = markDelta(
    await decode(page, await saved.screenshot()),
    await decode(page, await builtIn.screenshot()),
  )
  expect(mark.n, 'the saved chip is unmarked on a dark rail').toBeGreaterThan(0)
  expect(
    mark.delta,
    `the mark is invisible on a dark chip: ${mark.delta}`,
  ).toBeGreaterThanOrEqual(10)
  expect(
    Math.min(...mark.rows),
    `the mark is not bottom-weighted: rows ${mark.rows.join(',')} of ${mark.height}`,
  ).toBeGreaterThanOrEqual(mark.height - 10)
  // the other way round from light: lighter than the chip it is drawn on
  expect(mark.lumA).toBeGreaterThan(mark.lumB)
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

// ---------------------------------------------------------------------------
// Deleting a saved template
// ---------------------------------------------------------------------------

/**
 * The rail's other half, and the prototype's shape: a `×` on a saved chip.
 * Without it the rail only grows — three saves are three permanent chips, and a
 * mistyped name is a chip for good — which is why the prototype carried one on
 * every custom chip and why §4's v1 row counts custom templates as carried over
 * from it.
 *
 * The × is a control on the chip, so most of what has to be true of it is
 * visual and lives below: it wears the bevel hairline rather than `--brass`
 * (brass is the premium marker and nothing else may look like metal), it is
 * drawn for a saved chip and never for one of the nine, and removing the
 * selected template has to leave the app pointed at something real.
 */

/** The × on a saved chip, named the way the rail names it for assistive tech. */
const remove = (page: Page, name: string) =>
  page.locator(`.del[aria-label="删除模板 ${name}"]`)

test('a saved template can be deleted — off the rail and out of the store', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await saveAs(page, '待删除的')

  const saved = chip(page, '待删除的')
  await expect(saved).toHaveCount(1)
  await expect(remove(page, '待删除的')).toHaveCount(1)
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length + 1)

  // the saved chip is not the selected one, so what is on the wall is a claim
  // about deletion leaving everything but the rail alone
  const before = await digest(page)
  await remove(page, '待删除的').click()

  await expect(saved).toHaveCount(0)
  await expect(remove(page, '待删除的')).toHaveCount(0)
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length)
  await expect(page.locator('#toast')).toContainText('已删除模板：待删除的')
  expect(await digest(page), 'deleting a chip redrew a wall it is not on').toEqual(before)

  // Gone from the store, not merely from the DOM: the reload below is the only
  // thing that can tell a deleted record from a chip that was merely not drawn.
  const stored = await page.evaluate(() => localStorage.getItem('frame-app-custom-v1'))
  expect(JSON.parse(stored ?? '[]')).toEqual([])

  await page.reload()
  await expect(chip(page, '待删除的')).toHaveCount(0)
  await expect(page.locator('#rail .print')).toHaveCount(TEMPLATES.length)
})

test('the × is drawn on saved chips only, and never in the premium brass', async ({ page }) => {
  await page.goto('/')

  // nothing saved: no × on the rail at all, so the affordance is not merely
  // unstyled on a built-in — it is not there
  await expect(page.locator('#rail .del')).toHaveCount(0)

  await saveAs(page, '我的模板')
  await expect(page.locator('#rail .del')).toHaveCount(1)
  // and it belongs to the saved chip's mount, not to one of the nine
  await expect(page.locator('.mount:has(.del) .print')).toHaveAttribute('aria-label', '我的模板')
  for (const t of TEMPLATES) {
    await expect(
      page.locator(`.mount:has(.print[aria-label="${t.name}"]) .del`),
      `${t.name} carries a delete control`,
    ).toHaveCount(0)
  }

  // The material: the same bevel hairline every mount already has — measured
  // against the chip's own border, which is `var(--bevel)` — and not brass. The
  // plaque is the one element in the app that is painted brass, and it is
  // `hidden` here; a computed style is still the computed style.
  const style = await page.evaluate(() => {
    const del = document.querySelector('#rail .del') as HTMLElement
    // off, and not the premium one: `.on` repaints the border in `--ink` and
    // the brass chip's hairline is the one the × must not be mistaken for
    const builtIn = document.querySelector('#rail .print[aria-label="竖版故事"]') as HTMLElement
    const plaque = document.querySelector('.plaque-row') as HTMLElement
    const s = getComputedStyle(del)
    return {
      line: s.borderLeftColor,
      foot: s.borderBottomColor,
      chip: getComputedStyle(builtIn).borderTopColor,
      glyph: s.color,
      brass: getComputedStyle(plaque).color,
    }
  })
  expect(style.line).toBe(style.chip)
  expect(style.foot).toBe(style.chip)
  expect(style.glyph, 'the × is wearing the premium brass').not.toBe(style.brass)
})

test('deleting the selected template falls back to a built-in and re-renders the wall', async ({
  page,
}) => {
  await page.goto('/')
  await loadPhoto(page)

  // the boot template's own render, which is what the app must come back to
  await chip(page, '经典').click()
  const boot = await digest(page)

  // a copy of 拍立得, selected: the wall is the copy's, byte for byte, until
  // the copy is deleted
  await chip(page, '拍立得').click()
  await saveAs(page, '会没的')
  const saved = chip(page, '会没的')
  await saved.click()
  await expect(saved).toHaveAttribute('aria-pressed', 'true')
  const asSaved = await digest(page)
  expect(asSaved).not.toEqual(boot)

  await remove(page, '会没的').click()

  // the chip is gone, and exactly one chip is on: the selection landed on a
  // template that exists rather than on the id that just left the rail
  await expect(saved).toHaveCount(0)
  await expect(page.locator('#rail .print.on')).toHaveCount(1)
  await expect(page.locator('#rail .print[aria-pressed="true"]')).toHaveCount(1)
  await expect(chip(page, '经典')).toHaveAttribute('aria-pressed', 'true')

  // and the wall moved with it — a canvas still showing the deleted template's
  // poster is the state this exists to prevent
  expect(await digest(page), 'the wall still shows the deleted template').toEqual(boot)

  // still usable: a pick still moves the wall, and 存为模板 still saves
  await chip(page, '电影感').click()
  await expect(chip(page, '电影感')).toHaveAttribute('aria-pressed', 'true')
  expect(await digest(page)).not.toEqual(boot)
  await saveAs(page, '删除之后')
  await expect(chip(page, '删除之后')).toHaveCount(1)
})

test('a delete the store refuses changes nothing and says so', async ({ page }) => {
  await page.goto('/')
  await saveAs(page, '删不掉的')
  await expect(chip(page, '删不掉的')).toHaveCount(1)

  // a store that stops taking writes after the template is in it — the same
  // failure §9 names for saving, which for a delete is a different shape: a
  // save has the template in hand and can carry the list to the session store,
  // while a delete has nothing to carry and must not pretend it happened.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
  })
  await remove(page, '删不掉的').click()

  await expect(page.locator('#toast')).toContainText('删除失败')
  // the chip is still there, and so is the record behind it: the reload below
  // is what proves the second half
  await expect(chip(page, '删不掉的')).toHaveCount(1)

  await page.reload()
  await expect(chip(page, '删不掉的')).toHaveCount(1)
})
