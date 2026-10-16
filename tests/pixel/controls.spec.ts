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

/** The rows the panel can hold, in the order `src/ui/controls.ts` writes them.
 *  Restated here on purpose: a test that read the order off the module would pass
 *  for any order at all. */
const FRAME = ['前景大小', '水平位置', '垂直位置', '圆角', '白边', '下白边']
const BACKDROP = ['后景放大', '后景虚化', '后景压暗']
/** 无照片 delivers the mount's own box, so the numbers that only move or resize the
 *  *window* — 前景大小 and the two offsets — cannot change that poster or its file.
 *  圆角 and the two borders stay: every one of them changes the card, and in this
 *  mode the card is the poster. */
const MOUNT = ['圆角', '白边', '下白边']

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

/**
 * The record the app keeps as you work (`frame-app-session-v1`), read straight
 * out of `localStorage`: what a reload would restore. An assertion about a
 * record write belongs here rather than on the canvas — the canvas can be right
 * while the thing that outlives the tab is wrong.
 */
async function saved(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('frame-app-session-v1') ?? 'null'))
}

/** The canvas's top-left pixel, as RGB. The corner of the wall is never the
 *  mount: `fitRect` centres it and every template leaves a margin. */
async function corner(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
    const d = cv.getContext('2d')!.getImageData(0, 0, 1, 1).data
    return [d[0]!, d[1]!, d[2]!]
  })
}

/** ...and its alpha, which is what 无照片 is a claim about. */
async function cornerAlpha(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
    return cv.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]!
  })
}

/**
 * One pixel of the wall, as RGB — for asking what is at a *place* rather than what
 * the corner is. The corner of a cropped card is its rounded corner (transparent),
 * which says nothing about what the card is made of.
 */
async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ({ x, y }) => {
      const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
      const d = cv.getContext('2d')!.getImageData(x, y, 1, 1).data
      return [d[0]!, d[1]!, d[2]!]
    },
    { x, y },
  )
}

test('the 背景 choice is two posters, drawn under the poster', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '拍立得').click()
  const thumbs = page.locator('#modebar .mode-thumb')
  // 带背景 / 无照片 — a canvas with the photograph on it, and no canvas at all.
  expect(await thumbs.allTextContents()).toEqual(['带背景', '无照片'])
  expect(await page.locator('#modebar .mode-thumb.on')).toHaveText('带背景')

  // Both are pictures of the poster this record would make, so both carry one.
  const art = (i: number) => thumbs.nth(i).locator('img')
  for (const i of [0, 1]) expect(await art(i).getAttribute('src'), String(i)).toMatch(/^data:image\//)
  // ...and 无照片's is *smaller*, because its poster is: the previews are drawn at
  // the size the file will be. That is the whole reason this row is not words.
  const box = async (i: number) =>
    art(i).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])
  expect((await box(1))[0]!).toBeLessThan((await box(0))[0]!)

  // The panel keeps the numbers and has no 背景 row of its own any more.
  expect(await page.locator('#controls .rail-h b').allTextContents()).toEqual(['画面'])
  await thumbs.nth(1).click()
  expect(await page.locator('#modebar .mode-thumb.on')).toHaveText('无照片')
  expect(await page.locator('#rail-info')).toContainText('拍立得 · 769×1058')
})

test('无照片 delivers the mount’s own box: the poster is the card', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '拍立得').click()
  const full = await saved(page)
  const canvasSize = () =>
    page.evaluate(() => {
      const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
      return [cv.width, cv.height]
    })
  const before = await canvasSize()
  // 带背景 fills the template's canvas: 1152×1440 for a 4:5 poster at this long edge.
  expect(before).toEqual([1152, 1440])
  expect(await corner(page)).not.toEqual([255, 255, 255])

  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  const after = await canvasSize()
  // Smaller in both directions — the field around the card is the part that is not
  // part of the file — and the crop is *tight*: 8px in from the file's own edge is
  // already the card's white border, where 带背景 had the blurred photograph. (The
  // very corner is the mat's rounded corner, so it is transparent; that is a corner,
  // not a background.)
  expect(after[0]).toBeLessThan(before[0]!)
  expect(after[1]).toBeLessThan(before[1]!)
  expect(await pixelAt(page, 8, 8)).toEqual([255, 255, 255])
  // The size printed under the poster is the size of the file, not of the canvas it
  // was laid out on.
  expect(await page.locator('#rail-info').textContent()).toBe(`拍立得 · ${after[0]}×${after[1]}`)

  // Only the two numbers that change the card are offered: 前景大小 and the offsets
  // move or resize the *window*, and in this mode the window is the poster.
  expect(await page.locator('#controls .ctl-name').allTextContents()).toEqual(MOUNT)
  expect((await saved(page)).template.frame.scale).toBe(full.template.frame.scale)

  // ...and 白边 still changes the poster — the file grows with the border.
  await page.locator('#controls input[aria-label="白边"]').fill('60')
  const wider = await canvasSize()
  expect(wider[0]).toBe(after[0]! + 88)
  expect(wider[1]).toBe(after[1]! + 88)
})

test('圆角 is one slider, and it says 无 rather than 0 when the corners are square', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '拍立得').click()
  // 拍立得 ships square corners, so the row opens on the off state — 有无与大小 with
  // 有无 said in words, because「0px」beside a square-cornered poster is a number
  // answering a question nobody asked.
  expect(await readout(page, 'radius')).toHaveText('无')
  const bare = await digest(page)
  const bounds = await slider(page, '圆角').evaluate((el: HTMLInputElement) => [el.min, el.max])
  // The ceiling is the layout's own: half the frame's shorter side, which is where
  // a rounded rectangle stops being expressible.
  expect(Number(bounds[1])).toBeGreaterThan(0)

  await set(page, '圆角', 24)
  expect(await readout(page, 'radius')).toHaveText('24px')
  expect(await digest(page), 'the corner radius did not reach the wall').not.toBe(bare)
  // It is a record write like any other: 已调整 is up and the reset in the row
  // above it is live.
  expect(await page.locator('#record-acts').getAttribute('data-adjusted')).toBe('true')
  expect(await page.locator('#mount-reset').isEnabled()).toBe(true)

  await set(page, '圆角', 0)
  expect(await readout(page, 'radius')).toHaveText('无')
  expect(await digest(page), 'putting the radius back did not restore the poster').toBe(bare)

  // ...and it is *visible* where it can be. 带背景 paints the whole canvas, so a
  // rounded poster's own corner is covered by its backdrop there; it is in 无照片,
  // where the card is the file, that a rounded corner puts a hole in the file —
  // near-zero rather than zero, because the card's shadow still reaches that pixel.
  await set(page, '圆角', 24)
  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  expect(await cornerAlpha(page), 'a rounded card did not round the file').toBeLessThan(32)
  await page.locator('#modebar .mode-thumb[data-mode="blur"]').click()
  expect(await cornerAlpha(page)).toBe(255)
  await set(page, '圆角', 0)
})

test('无照片 keeps what 带背景 is made of: a step out and back returns the backdrop', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '经典').click()
  const before = await saved(page)
  expect(await page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')

  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  expect(await page.locator('#mount-reset').isEnabled()).toBe(true)

  // What the switch did *not* do: throw away the numbers the trip back needs, or
  // touch the mount.
  await page.locator('#modebar .mode-thumb[data-mode="blur"]').click()
  const back = await saved(page)
  expect(await cornerAlpha(page)).toBe(255)
  expect(back.template.background.blur).toBe(before.template.background.blur)
  expect(back.template.background.zoom).toBe(before.template.background.zoom)
  expect(back.template.background.darken).toBe(before.template.background.darken)
  // The frame I left is the frame I came back to. `toMatchObject` rather than
  // `toEqual`, because settling a write states the offsets a blur template never
  // needed — `ox: 0` is the value it always meant, not a change.
  expect(back.template.frame).toMatchObject(before.template.frame)

  // Back where it started, and the app says so: the marker is the difference from
  // the template as authored, so a round trip through 无照片 is not an edit.
  expect(await page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')
})

test('白边 can be filled with the photograph, blurred', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '拍立得').click()
  const row = page.locator('#mat-discs')
  const discs = row.locator('.disc')
  // 带背景 keeps them closed: the same blur on a blurred backdrop is a border
  // nobody can see, which is the failure this row refuses everywhere else.
  expect(await row.getAttribute('data-out')).toBe('false')
  expect(await discs).toHaveCount(2)
  expect(await discs.allTextContents()).toEqual(['白边', '模糊'])
  // ...and each disc is the material it names. 白边 is the mount's own white, and
  // not a colour the app happened to pick: paper is what the border already is.
  const art = (i: number) => discs.nth(i).locator('.disc-art')
  expect(await art(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)')
  expect(await art(1).evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/^url\("data:image\//)
  // Circles, which is what makes them read as a colour rather than as a chip: the
  // border is one material, and a disc shows one material.
  expect(await art(0).evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')

  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  // Revealed rather than toggled — the row is a transition's two states, and by the
  // time this runs it has run.
  await expect(row).toHaveAttribute('data-out', 'true')
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible')
  expect(await page.locator('#mat-discs .disc.on')).toHaveText('白边')
  // The card's border is the mat's white, 8px in from the file's own edge.
  expect(await pixelAt(page, 8, 8)).toEqual([255, 255, 255])

  await page.locator('#mat-discs .disc[data-fill="blur"]').click()
  // ...and now the border is the photograph itself, out of focus: the picture bleeds
  // past its own frame instead of sitting on paper. Not white, and not the app's
  // empty slate either — this is the picture.
  const border = await pixelAt(page, 8, 8)
  expect(border).not.toEqual([255, 255, 255])
  expect(border).not.toEqual([42, 50, 56])
  // A fill, not a size: the crop 无照片 delivers is untouched.
  expect(
    await page.evaluate(() => {
      const cv = document.querySelector('canvas#cv') as HTMLCanvasElement
      return [cv.width, cv.height]
    }),
  ).toEqual([769, 1058])
  expect((await saved(page)).template.frame.matBlur).toBe(true)
  expect(await page.locator('#record-acts').getAttribute('data-adjusted')).toBe('true')

  // ...and 白边 puts the paper back.
  await page.locator('#mat-discs .disc[data-fill="white"]').click()
  expect(await pixelAt(page, 8, 8)).toEqual([255, 255, 255])
})

test('the 白边 discs wait disabled until there is a border to fill', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '经典').click()
  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  const discs = page.locator('#mat-discs .disc')
  expect(await discs).toHaveCount(2)
  expect(await discs.first().isDisabled()).toBe(true)

  // Raising 白边 is a slider drag, so the discs have to come alive *without* a
  // rebuild — `syncMatDiscs` runs on the slider's own write path, beside
  // `syncControls`. A rebuilt row would also lose the drag's pointer.
  await page.locator('#controls input[aria-label="白边"]').fill('40')
  expect(await discs.first().isEnabled()).toBe(true)
  expect(await discs.last().isEnabled()).toBe(true)
  // ...and now choosing it draws the blurred border that was waiting.
  await page.locator('#mat-discs .disc[data-fill="blur"]').click()
  expect((await saved(page)).template.frame.matBlur).toBe(true)
  expect(await pixelAt(page, 20, 20)).not.toEqual([255, 255, 255])
})

test('样张 keeps its white sheet: 无照片 there is a card, and the card is the file', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '样张').click()
  // 样张 ships as 无照片 — the poster is the card — and *with* a sheet, because its
  // plate is printed on it. That colour is authored, not a control: a camera plate
  // over a punched-out background is a caption floating in the void.
  expect(await page.locator('#modebar .mode-thumb.on')).toHaveText('无照片')
  expect(await corner(page)).toEqual([255, 255, 255])
  expect((await saved(page)).template.background.color).toBe('#FFFFFF')
})

test('无照片 keeps no 后景 rows, and 带背景 keeps the three', async ({ page }) => {
  await page.goto('/')
  await chip(page, '经典').click()
  const rows = page.locator('#controls .ctl-name')

  expect(await rows.allTextContents()).toEqual([...FRAME, ...BACKDROP])

  await page.locator('#modebar .mode-thumb[data-mode="mount"]').click()
  expect(await rows.allTextContents()).toEqual(MOUNT)
})

test('带背景 on 样张 is a blur, not a label on a flat card', async ({ page }) => {
  await page.goto('/')
  await loadPhoto(page)
  await chip(page, '样张').click()
  expect(await page.locator('#modebar .mode-thumb.on')).toHaveText('无照片')

  await page.locator('#modebar .mode-thumb[data-mode="blur"]').click()
  // Three rows appear, one of them the blur the card did not have — a 带背景 that
  // drew a sharp backdrop under its own label would be a control lying.
  expect(await page.locator('#controls .ctl-name').allTextContents()).toEqual([...FRAME, ...BACKDROP])
  expect((await saved(page)).template.background.blur).toBeGreaterThan(0)
  // ...and the authored sheet is still there underneath, for the trip back.
  expect((await saved(page)).template.background.color).toBe('#FFFFFF')
})

test('the panel is exactly the controls the current template offers', async ({ page }) => {
  await page.goto('/')

  for (const t of TEMPLATES) {
    await chip(page, t.name).click()
    // 后景 only where there is one, and the mount's own numbers only in 无照片:
    // 样张 ships as 无照片, so its panel is the card's three numbers and no 后景
    // rows — a slider that accepts a drag and changes nothing is the failure 文字
    // already refuses for 留白.
    const expected = t.background.mode === 'blur' ? [...FRAME, ...BACKDROP] : MOUNT
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
  await chip(page, '拍立得').click()

  // 拍立得 carries the deepest mat among the 带背景 templates — mat 16, matBottom
  // 104 — so its photograph's maximum is 100·(1 − 2·(16 + 104)/1440) = 83.3, floored
  // to a whole number. Not 100, and not a round number: the layout's own answer.
  const size = resolveSize('4:5', 1440)
  const scaleTop = Math.floor(scaleCeiling(size, 16, 104))
  await expect(slider(page, '前景大小')).toHaveAttribute('max', String(scaleTop))

  // The mat's own maximum at this scale, and the two constraints behind it: the
  // side walls on `mat` alone, the bottom edge with 拍立得's 104px band under it.
  const matMax = Number(await slider(page, '白边').getAttribute('max'))
  expect(matMax).toBe(Math.floor(Math.min(matCeiling(size, 64), matSumCeiling(size, 64) - 104)))

  // A value past the end of the track, which the input itself would refuse: the
  // app stops it at the bound it offered rather than writing it through.
  await push(page, '白边', 1000)
  await expect(readout(page, 'mat')).toHaveText(`${matMax}px`)

  // And the scale's ceiling has followed the deeper mat down, so the next drag
  // of 前景大小 cannot be the one that pushes the card off the poster.
  const scaleMax = Number(await slider(page, '前景大小').getAttribute('max'))
  expect(scaleMax).toBe(Math.floor(scaleCeiling(size, matMax, 104)))
  expect(scaleMax, 'a deeper mat did not lower the scale ceiling').toBeLessThan(scaleTop)

  await push(page, '前景大小', 1000)
  await expect(readout(page, 'scale')).toHaveText(`${scaleMax}%`)
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

  // 样张's own panel, and its own numbers: it ships as 无照片, so the row set is the
  // card's three — 前景大小 is not a row there at all, because it would resize the
  // window the file does not contain — and a panel still holding 经典's 70px mat
  // would be a panel describing the wrong mount.
  await chip(page, '样张').click()
  expect(await page.locator('#controls .ctl-name').allTextContents()).toEqual(MOUNT)
  await expect(readout(page, 'radius')).toHaveText('无')
  await expect(readout(page, 'mat')).toHaveText('86px')
  await expect(readout(page, 'matBottom')).toHaveText('150px')
  await expect(page.locator('#record-acts')).toHaveAttribute('data-adjusted', 'false')

  // 留白 carries no mat at all, and no 后景 of its own kind to lose.
  await chip(page, '留白').click()
  await expect(readout(page, 'mat')).toHaveText('0px')
  await expect(readout(page, 'zoom')).toHaveText('126%')
})
