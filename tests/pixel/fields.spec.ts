import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../../src/core/templates'

/**
 * 文字 — the fields that put words on the poster.
 *
 * What this suite is for: the app is the prototype's renderer with an input
 * surface, and the input surface is the part that used to be missing. So the
 * claims are end-to-end and about the artifact — the fields exist for exactly
 * the slots the template prints, typing changes the poster, the caret survives
 * a keystroke, the words follow the user across mounts, and the words are in
 * the file the user keeps.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))

const LABEL: Record<string, string> = { title: '主标题', sub: '副标题', sign: '署名' }

const field = (page: Page, slot: string) => page.locator(`#fields .field[aria-label="${LABEL[slot]}"]`)
const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)

async function loadPhoto(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()
}

/** A fingerprint of the wall, so "the words reached it" is a claim about pixels. */
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

/**
 * Bright pixels in the poster's lower band, read out of the ceremony's own
 * image — the file the user is looking at, not a re-render.
 *
 * 经典's title is `#ffffff` with a stroke, so glyph ink is near-white and a
 * threshold of 225 is unambiguous. The band is the bottom fifth, where the
 * `'bottom'` anchor puts the block.
 */
async function ceremonyInk(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const img = document.querySelector('.ceremony-art img') as HTMLImageElement | null
    if (!img) throw new Error('no ceremony image')
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob())
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bmp, 0, 0)
    const y0 = Math.floor(bmp.height * 0.8)
    const d = ctx.getImageData(0, y0, bmp.width, bmp.height - y0).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! > 225 && d[i + 1]! > 225 && d[i + 2]! > 225) n++
    }
    return n
  })
}

test('the fields are exactly the slots the current template prints', async ({ page }) => {
  await page.goto('/')

  // Every template, not the boot one: the field list is a property of the
  // template, and this is the assertion that keeps it one. `留白` declares no
  // `text` at all, so there the block is gone rather than empty.
  for (const t of TEMPLATES) {
    await chip(page, t.name).click()
    const expected = (t.text?.slots ?? []).map((s) => LABEL[s.id])
    // A slot list may repeat an id; one slot is one field, and the field order
    // is the order the template draws its lines in.
    const unique = expected.filter((l, i) => expected.indexOf(l) === i)

    await expect(page.locator('#fields .field')).toHaveCount(unique.length)
    expect(await page.locator('#fields .field').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label')),
    ), `${t.id} field order`).toEqual(unique)
    if (unique.length === 0) await expect(page.locator('#fields')).toBeHidden()
    else await expect(page.locator('#fields')).toBeVisible()
  }
})

test('typing puts the words on the poster, and clearing them puts the poster back', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  const bare = await digest(page)

  await field(page, 'title').fill('以梦为马')
  const withTitle = await digest(page)
  expect(withTitle, 'typing a title did not change the poster').not.toBe(bare)

  // The pair is what makes this non-vacuous: not "something changed" but
  // "that, and nothing else" — removing the words returns the exact render
  // the poster had before they were typed.
  await field(page, 'title').fill('')
  expect(await digest(page), 'clearing the title did not restore the poster').toBe(bare)
})

test('the caret stays in the field while the wall follows the keystrokes', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  const bare = await digest(page)

  const title = field(page, 'title')
  await title.click()
  await page.keyboard.type('以梦为马')

  // The renderer runs per keystroke, and the one way that breaks a text field
  // is rebuilding it: the input is replaced, the caret goes to <body>, and the
  // second character lands nowhere. So this asserts the input the user is
  // typing into is still that input.
  expect(await title.inputValue()).toBe('以梦为马')
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('field-title')
  expect(await digest(page), 'the wall did not follow the typing').not.toBe(bare)
})

test('the words follow the user across templates, which choose typography and not copy', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)

  await field(page, 'title').fill('以梦为马')
  await chip(page, '经典').click()
  const onClassic = await digest(page)

  // 拍立得 prints a title in its bottom mat; the app's words are not the
  // template's, so the new mount sets them in its own type.
  await chip(page, '拍立得').click()
  await expect(field(page, 'title')).toHaveValue('以梦为马')
  const onPolaroid = await digest(page)
  expect(onPolaroid).not.toBe(onClassic)

  // And back: a copy is the same template, so the same words plus the same
  // mount is the same poster, byte for byte.
  await chip(page, '经典').click()
  expect(await digest(page)).toBe(onClassic)
})

test('the words the user typed are in the exported file', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)

  await page.click('#save')
  await expect(page.locator('.ceremony')).toHaveCount(1)
  const silent = await ceremonyInk(page)
  await page.click('[data-act="done"]')

  await field(page, 'title').fill('以梦为马')
  await page.click('#save')
  await expect(page.locator('.ceremony')).toHaveCount(1)
  const written = await ceremonyInk(page)

  // The export is the artifact, so the honest place to check the text is in it.
  // A blank-vs-ink comparison rather than a byte comparison: the two files
  // differ for many reasons and only one of them is the title.
  expect(written, `no title ink in the exported poster (silent=${silent}, written=${written})`).toBeGreaterThan(silent + 500)
})

/**
 * A slot is set at the size its template declares, measured on ink that nothing
 * else can account for.
 *
 * The photograph here is a black canvas rather than the sample, for the same
 * reason this test exists: the sample is bright and varied, and a scan for
 * near-white rows on it measures the photograph rather than the type (the first
 * draft of this test did exactly that and reported the two mounts identical).
 * On black, every lit row belongs to the title.
 *
 * 经典 sets a title at 34/700 and 杂志封面 at 46/700, both white with a stroke
 * that is invisible against black. 46/34 is 1.35, so a quarter again taller is
 * a threshold no single-size implementation can clear.
 */
async function titleInkHeight(page: Page, mount: string): Promise<number> {
  return page.evaluate(async (name) => {
    const core = (window as any).__frameCore
    const { TEMPLATES } = (window as any).__frameTemplates
    const template = TEMPLATES.find((t: { name: string }) => t.name === name)
    if (!template) throw new Error(`no template named ${name}`)

    const dark = document.createElement('canvas')
    dark.width = 1200
    dark.height = 1500
    const dc = dark.getContext('2d')!
    dc.fillStyle = '#000000'
    dc.fillRect(0, 0, 1200, 1500)

    const size = { W: 1152, H: 1440 }
    const out = document.createElement('canvas')
    out.width = size.W
    out.height = size.H
    const ctx = out.getContext('2d')!
    core.render({
      ctx,
      size,
      k: 1,
      template,
      photos: [{ el: dark, width: 1200, height: 1500, name: 'black', exif: null }],
      text: { title: '以梦为马' },
      exif: null,
    })

    const d = ctx.getImageData(0, 0, size.W, size.H).data
    const rows: number[] = []
    for (let y = 0; y < size.H; y++) {
      let lit = 0
      for (let x = 0; x < size.W; x += 2) {
        const i = (y * size.W + x) * 4
        if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) lit++
      }
      if (lit > 2) rows.push(y)
    }
    if (rows.length === 0) return 0
    return rows[rows.length - 1]! - rows[0]!
  }, mount)
}

test('a slot is set at the size its template declares', async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)

  const small = await titleInkHeight(page, '经典')
  const large = await titleInkHeight(page, '杂志封面')

  expect(small, '经典 drew no title ink to measure').toBeGreaterThan(0)
  expect(
    large,
    `杂志封面 sets 46px and 经典 34px, so its ink must be ~1.35x taller (small=${small}, large=${large})`,
  ).toBeGreaterThan(small * 1.25)
})
