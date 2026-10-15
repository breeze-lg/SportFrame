import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEMPLATES } from '../../src/core/templates'
import { matCeiling, matSumCeiling, scaleCeiling } from '../../src/core/limits'
import { resolveSize } from '../../src/core/geometry'

/**
 * 画面 — the sliders, and the one promise this feature makes: what you set is
 * what you keep.
 *
 * A geometry panel is easy to fake. Its claims are only real at the two ends
 * that a unit test cannot reach: that a drag changes *the wall* (not a model),
 * and that 存为模板 writes the numbers somewhere that outlives the tab. So every
 * assertion below is made against the running app — the canvas pixels, the
 * sliders' own attributes, and localStorage across a reload.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))

const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)
const slider = (page: Page, label: string) => page.locator(`#controls input[aria-label="${label}"]`)
const readout = (page: Page, id: string) => page.locator(`.ctl[data-id="${id}"] .ctl-val`)

/** The eight rows the panel can hold, in the order `src/ui/controls.ts` writes
 *  them. Restated here on purpose: a test that read the order off the module
 *  would pass for any order at all. */
const FRAME = ['前景大小', '水平位置', '垂直位置', '白边', '下白边']
const BACKDROP = ['后景放大', '后景虚化', '后景压暗']

/**
 * Sets a slider the way the control is meant to be used. `fill` on a range
 * input writes the value, clamps it to the element's own min/max, and
 * dispatches `input` — which is the event the panel listens to, and the event a
 * pointer drag produces. A `page.mouse` drag across the track would exercise
 * the same handler with less of the browser's own value handling in it.
 */
async function set(page: Page, label: string, value: number | string): Promise<void> {
  await slider(page, label).fill(String(value))
}

/**
 * A slider's own `max` is enforced by the input itself — `fill` past it is
 * refused, and a pointer cannot drag a thumb off the end of its track — so the
 * value the *app* has to clamp is one the control never offered: a stale `max`,
 * which `syncControls` is supposed to have refreshed a moment earlier. This
 * writes that value and dispatches the same event a drag does, which is the
 * only way to ask the app's own clamp a question.
 */
async function push(page: Page, label: string, value: number): Promise<void> {
  await slider(page, label).evaluate((node, v) => {
    const input = node as HTMLInputElement
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function loadPhoto(page: Page): Promise<void> {
  await page.setInputFiles('#file', {
    name: 'sample.webp',
    mimeType: 'image/webp',
    buffer: SAMPLE,
  })
  await expect(page.locator('canvas#cv')).toBeVisible()
}

/** A fingerprint of the wall, so "it applied" is a claim about pixels. */
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
 * Near-white pixels in the outermost two rows and columns of the wall.
 *
 * The mat is `#FFFFFF` (`drawMat`), and the canvas is the poster's paper: a mat
 * touching the canvas edge is a mat that has been cropped, which is the failure
 * the ceilings exist to prevent. Reading the frame rather than the model is the
 * point — a clamp that never reached `render` would pass a DOM assertion.
 */
async function edgeWhites(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
    const ctx = cv.getContext('2d')
    if (!ctx) throw new Error('no 2d context on #cv')
    const near = (i: number) => d[i]! >= 250 && d[i + 1]! >= 250 && d[i + 2]! >= 250
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let x = 0; x < cv.width; x++) {
      for (const y of [0, 1, cv.height - 2, cv.height - 1]) {
        if (near((y * cv.width + x) * 4)) n++
      }
    }
    for (let y = 0; y < cv.height; y++) {
      for (const x of [0, 1, cv.width - 2, cv.width - 1]) {
        if (near((y * cv.width + x) * 4)) n++
      }
    }
    return n
  })
}

async function saveAs(page: Page, name: string): Promise<void> {
  page.once('dialog', (d) => void d.accept(name))
  await page.click('#saveTpl')
}

test('the panel is exactly the controls the current template offers', async ({ page }) => {
  await page.goto('/')

  for (const t of TEMPLATES) {
    await chip(page, t.name).click()
    // 后景 only where there is one: 样张 paints a flat white card, and a slider
    // that accepts a drag and changes nothing is the failure 文字 already
    // refuses for 留白.
    const expected = t.background.mode === 'blur' ? [...FRAME, ...BACKDROP] : FRAME
    expect(await page.locator('#controls .ctl-name').allTextContents(), t.id).toEqual(expected)
  }
})

test('a slider moves the wall, and putting it back restores the poster', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  const bare = await digest(page)

  await set(page, '前景大小', 45)
  await expect(readout(page, 'scale')).toHaveText('45%')
  const small = await digest(page)
  expect(small, 'moving 前景大小 did not change the poster').not.toBe(bare)

  // The pair is what makes this non-vacuous: not "something changed" but "that,
  // and nothing else" — 经典 declares `scale: 72`, and returning the slider to
  // it has to return the exact render the poster had before.
  await set(page, '前景大小', 72)
  expect(await digest(page), 'restoring the scale did not restore the poster').toBe(bare)
})

test('the 已调整 note appears on an edit and clears when the mount is re-picked', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  const bare = await digest(page)

  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
  await expect(page.locator('.ctl-note')).toBeHidden()

  await set(page, '白边', 40)
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'true')
  await expect(page.locator('.ctl-note')).toBeVisible()

  // 重置, not a second click on the chip: that gesture is what opens this panel
  // now (the knob in the middle of the chip that is on), so the way back to the
  // numbers as authored is the button that says so.
  await page.locator('#mount-reset').click()
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
  expect(await digest(page)).toBe(bare)
  // ...and it goes dead again: there is nothing left to reset.
  await expect(page.locator('#mount-reset')).toBeDisabled()
})

test('存为模板 keeps the numbers the sliders set', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '经典').click()
  const stock = await digest(page)

  await set(page, '前景大小', 48)
  await set(page, '白边', 60)
  await set(page, '水平位置', 25)
  const tuned = await digest(page)
  expect(tuned, 'the three edits did not change the poster').not.toBe(stock)

  await saveAs(page, '我的经典')

  // Away to another mount and back: the saved record carries its own geometry,
  // not 经典's, so the wall comes back to what the sliders had made — which is
  // the whole of "这些设置要支持存成模板".
  await chip(page, '留白').click()
  await chip(page, '我的经典').click()
  expect(await digest(page)).toBe(tuned)

  // And the panel is showing those numbers, so the poster and the sliders agree
  // about the record rather than merely both being different from 经典.
  await expect(readout(page, 'scale')).toHaveText('48%')
  await expect(readout(page, 'mat')).toHaveText('60px')
  await expect(readout(page, 'ox')).toHaveText('25%')
  // A saved template is the rail's own record for that id — nothing is
  // overridden, so nothing is marked as unsaved.
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
})

test('a saved template carries its numbers through a reload', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await set(page, '前景大小', 50)
  await set(page, '后景压暗', 70)
  await set(page, '垂直位置', -18)
  const tuned = await digest(page)

  await saveAs(page, '暗一点')

  // Not a DOM check: the store is the claim. A reload drops every object the
  // app was holding, so what comes back came off disk.
  await page.reload()
  await expect(chip(page, '暗一点')).toHaveCount(1)
  await loadPhoto(page)
  await chip(page, '暗一点').click()

  expect(await digest(page)).toBe(tuned)
  await expect(readout(page, 'scale')).toHaveText('50%')
  await expect(readout(page, 'darken')).toHaveText('70%')
  await expect(readout(page, 'oy')).toHaveText('-18%')
})

test('the sliders cannot be driven past the ceilings the layout allows', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '样张').click()

  // 样张 declares the deepest mat in the set — mat 86, matBottom 150 — so its
  // photograph's maximum is 1440·(1 − 2·236/1440) = 67.2, floored to a whole
  // number. Not 100, and not a round number: it is the layout's own answer.
  const size = resolveSize('4:5', 1440)
  await expect(slider(page, '前景大小')).toHaveAttribute(
    'max',
    String(Math.floor(scaleCeiling(size, 86, 150))),
  )

  // The mat's own maximum at this scale, and the two constraints behind it: the
  // side walls on `mat` alone, the bottom edge with 样张's 150px band under it.
  const matMax = Number(await slider(page, '白边').getAttribute('max'))
  expect(matMax).toBe(Math.floor(Math.min(matCeiling(size, 66), matSumCeiling(size, 66) - 150)))

  // A value past the end of the track, which the input itself would refuse: the
  // app stops it at the bound it offered rather than writing it through.
  await push(page, '白边', 1000)
  await expect(readout(page, 'mat')).toHaveText(`${matMax}px`)

  // And the scale's ceiling has followed the deeper mat down, so the next drag
  // of 前景大小 cannot be the one that pushes the card off the poster.
  const scaleMax = Number(await slider(page, '前景大小').getAttribute('max'))
  expect(scaleMax).toBe(Math.floor(scaleCeiling(size, matMax, 150)))

  await push(page, '前景大小', 1000)
  await expect(readout(page, 'scale')).toHaveText(`${scaleMax}%`)
  // 样张's authored scale is 66 and the deeper mat has brought its ceiling to
  // exactly that, so the panel is now shut: the poster on the wall is the one
  // the limits allow, at both ends.
  expect(scaleMax).toBe(66)
})

test('a mat pushed to its maximum grows on the wall and still leaves the canvas edge alone', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '经典').click()

  const bare = await digest(page)
  const bareEdge = await edgeWhites(page)
  expect(bareEdge, '经典 has no mat, so its canvas edge cannot already be white').toBe(0)

  // One step short of the maximum: at the exact ceiling the mat's own edge
  // lands within a pixel of the canvas and the outer ring is anti-aliased
  // rather than wrong. The claim here is about the clamp holding, not about
  // where a rounding lands.
  const max = Number(await slider(page, '白边').getAttribute('max'))
  await set(page, '白边', max - 20)

  expect(await digest(page), 'the mat did not reach the wall').not.toBe(bare)
  await expect(readout(page, 'mat')).toHaveText(`${max - 20}px`)
  expect(await edgeWhites(page), 'the mat was cropped at the canvas edge').toBe(0)
})

test('the sliders are rebuilt for the template that is on, not carried over', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)

  await chip(page, '经典').click()
  await set(page, '前景大小', 40)
  await set(page, '白边', 70)

  // 样张's own numbers, and 样张's own ceilings — a panel still holding 经典's
  // 70px mat would offer a maximum computed for the wrong mount.
  await chip(page, '样张').click()
  await expect(readout(page, 'scale')).toHaveText('66%')
  await expect(readout(page, 'mat')).toHaveText('86px')
  await expect(readout(page, 'matBottom')).toHaveText('150px')
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')

  // 留白 carries no mat at all, and no 后景 of its own kind to lose.
  await chip(page, '留白').click()
  await expect(readout(page, 'mat')).toHaveText('0px')
  await expect(readout(page, 'zoom')).toHaveText('126%')
})
