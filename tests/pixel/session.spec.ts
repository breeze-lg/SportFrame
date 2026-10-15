import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Where a refresh picks up.
 *
 * Nothing about this can be answered in `node`: it is one page's bytes going
 * into one browser's stores and coming back out after a real reload, and the
 * parts most likely to be wrong are the ones a unit test cannot reach — whether
 * the *original* file was stored rather than a re-encode (the camera plate knows
 * the difference), whether a photograph removed from the list leaves its bytes
 * behind, and what the app does when the store is refused outright.
 */

const SAMPLE = readFileSync(resolve('public/sample/sample.webp'))
/** A Nikon D810 frame with its full tag set — 85 mm, f/15, 1/125, ISO 64. */
const CAMERA = readFileSync(resolve('tests/fixtures/with-exif.jpg'))
const CAMERA_BY_ITSELF = { name: 'camera.jpg', buffer: CAMERA }

const row = (page: Page, name: string) => page.locator(`.ph-pick[aria-label="${name}"]`)
const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)
const count = (page: Page) => page.locator('#photo-count')
const field = (page: Page, label: string) => page.locator(`#fields .field[aria-label="${label}"]`)
const slider = (page: Page, label: string) => page.locator(`#controls input[aria-label="${label}"]`)
const readout = (page: Page, id: string) => page.locator(`.ctl[data-id="${id}"] .ctl-val`)

async function load(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  await page.setInputFiles(
    '#file',
    files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: f.buffer })),
  )
}
const sampleAndCamera = [
  { name: 'sample.webp', buffer: SAMPLE },
  { name: 'camera.jpg', buffer: CAMERA },
]

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

/** How many photographs the byte store is holding. The number the *record* keeps
 *  is not evidence: the point of removing a photograph is that its bytes go.
 *
 *  `databases()` first, and deliberately not `open()`: opening a database that
 *  does not exist *creates* it, and a store-less database created by a test
 *  leaves the app's own `open` unable to run the upgrade that creates the store
 *  — which is how an earlier version of this helper made the app silently unable
 *  to store anything, and turned the test below into a comparison of two zeros.
 *  A database that was never created answers zero, which is what the caller is
 *  asking; only an error answers -1. */
async function storedBytes(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
        const names = typeof factory.databases === 'function' ? factory.databases() : null
        const proceed = () => {
          const request = indexedDB.open('frame-app-photos')
          request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('photos')) return resolve(0)
            const got = db.transaction('photos', 'readonly').objectStore('photos').count()
            got.onsuccess = () => resolve(got.result)
            got.onerror = () => resolve(-1)
          }
          request.onerror = () => resolve(-1)
        }
        if (!names) return proceed()
        names.then(
          (list) => (list.some((d) => d.name === 'frame-app-photos') ? proceed() : resolve(0)),
          () => resolve(-1),
        )
      }),
  )
}

test('a refresh comes back where it was', async ({ page }) => {
  await page.goto('/')
  await load(page, sampleAndCamera)

  // everything the session record is supposed to hold: which photograph is on
  // the wall, which mount, what words, what numbers
  await row(page, 'camera').click()
  await chip(page, '拍立得').click()
  // 文字 is the panel the typing is in, and the dock opens on 画面 (the mount)
  await page.locator('.mode', { hasText: '文字' }).click()
  await field(page, '主标题').fill('回来了')
  // ...and back to 画面 for the numbers: one panel at a time means the other one
  // is off screen, which is the point of the switch.
  await page.locator('.mode', { hasText: '画面' }).click()
  await slider(page, '前景大小').fill('52')
  await expect(count(page)).toHaveText('2 / 2')
  await expect(readout(page, 'scale')).toHaveText('52%')
  const before = await digest(page)

  await page.reload()

  // the photographs, in order, with the wall back on the one it was on
  await expect(page.locator('.photo-list .ph')).toHaveCount(2)
  await expect(row(page, 'sample')).toHaveCount(1)
  await expect(row(page, 'camera')).toHaveCount(1)
  await expect(row(page, 'camera')).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, 'sample')).toHaveAttribute('aria-pressed', 'false')
  await expect(count(page)).toHaveText('2 / 2')

  // the mount, the words and the numbers
  await expect(chip(page, '拍立得')).toHaveAttribute('aria-pressed', 'true')
  await expect(field(page, '主标题')).toHaveValue('回来了')
  await expect(readout(page, 'scale')).toHaveText('52%')
  // ...and the numbers are still recognised as an *edit* of 拍立得 rather than as
  // 拍立得 itself: the marker is part of what a session remembers
  await expect(page.locator('#controls')).toHaveAttribute('data-adjusted', 'true')

  // and the poster is the poster, to the pixel: the same template, the same
  // words, the same numbers, and the same file decoded from the same bytes
  expect(await digest(page)).toBe(before)
})

test('the restored photograph is the file that was stored, EXIF and all', async ({ page }) => {
  await page.goto('/')
  await load(page, [CAMERA_BY_ITSELF])
  await chip(page, '样张').click()
  await expect(page.locator('canvas#cv')).toBeVisible()

  /**
   * Ink in the bottom band, which on 样张 (a flat white card, a white mat, no
   * words typed) can only be the plate. The plate is drawn from the
   * photograph's EXIF — so this is a read of the *bytes* that were kept, not of
   * anything the app remembered about them.
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

  const printed = await plateInk()
  expect(printed, 'the fixture printed no plate to begin with').toBeGreaterThan(0)

  await page.reload()

  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  expect(await plateInk(), 'the plate is empty after a reload — the bytes kept are not the file').toBe(
    printed,
  )
})

test('removing a photograph takes its bytes with it', async ({ page }) => {
  await page.goto('/')
  await load(page, sampleAndCamera)
  await expect(page.locator('.photo-list .ph')).toHaveCount(2)
  // the store write is deliberately not awaited by the app, so this waits for it
  await expect.poll(() => storedBytes(page)).toBe(2)

  await page.locator('.ph-del[aria-label="移除 camera"]').click()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect.poll(() => storedBytes(page)).toBe(1)
  // ...and the record agrees with the store, which is what makes the removal
  // survive: a reload shows one row, not two with one missing its bytes
  await page.reload()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect(row(page, 'sample')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('canvas#cv')).toBeVisible()
})

test('?demo=1 is a sandbox: one photograph, and the same one every reload', async ({ page }) => {
  // The bug this pins: the demo photograph used to be stored like any other, so
  // a reload of this URL restored the demo it had stored and then added a second
  // one — the list grew by one per refresh (1, 2, 3, 4…).
  await page.goto('/?demo=1')
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect(row(page, 'demo')).toHaveAttribute('aria-pressed', 'true')
  await expect(count(page)).toHaveText('1 / 1')

  for (let i = 0; i < 3; i++) {
    await page.reload()
    await expect(page.locator('.photo-list .ph'), `reload ${i + 1} grew the list`).toHaveCount(1)
    await expect(count(page)).toHaveText('1 / 1')
  }

  // And it wrote nothing at all: a sandbox, not a session with one photograph in
  // it. The record is the evidence — the bytes store would be the other half.
  const record = await page.evaluate(() => localStorage.getItem('frame-app-session-v1'))
  expect(record, 'a demo visit wrote a session record').toBeNull()
  expect(await storedBytes(page)).toBe(0)
})

test('a demo visit leaves a real session alone', async ({ page }) => {
  await page.goto('/')
  await load(page, sampleAndCamera)
  await row(page, 'camera').click()
  await chip(page, '拍立得').click()
  await expect(count(page)).toHaveText('2 / 2')

  // ...off to the demo, which generates a photograph of its own
  await page.goto('/?demo=1')
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)
  await expect(row(page, 'demo')).toHaveCount(1)

  // ...and back: the two photographs, the row that was on the wall, and the
  // mount. A generated photograph must not end up in the user's list to be
  // removed by hand.
  await page.goto('/')
  await expect(page.locator('.photo-list .ph')).toHaveCount(2)
  await expect(row(page, 'demo')).toHaveCount(0)
  await expect(row(page, 'camera')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, '拍立得')).toHaveAttribute('aria-pressed', 'true')
})

test('a session that cannot be stored costs the session and nothing else', async ({ page }) => {
  // Private modes and some webviews refuse IndexedDB outright, and the property
  // read itself is what throws. The app has to be exactly as usable — it just
  // forgets.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('refused')
      },
    })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await load(page, [CAMERA_BY_ITSELF])
  await expect(page.locator('canvas#cv')).toBeVisible()
  await expect(page.locator('.photo-list .ph')).toHaveCount(1)

  // The wall works, the record is still written (the photographs are listed
  // without bytes behind them), and nothing threw.
  await page.reload()
  await expect(page.locator('.photo-list .ph')).toHaveCount(0)
  await expect(page.locator('canvas#cv')).toBeHidden()
  expect(errors, `the page threw: ${errors.join(' | ')}`).toEqual([])
})

test('a refused localStorage leaves the app working, with nothing to come back to', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied')
      },
    })
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await load(page, [CAMERA_BY_ITSELF])
  await expect(page.locator('canvas#cv')).toBeVisible()
  await chip(page, '竖版故事').click()
  await expect(page.locator('canvas#cv')).toBeVisible()

  await page.reload()
  // back to the boot template and a bare wall: the app never had anywhere to
  // write, and it must not pretend otherwise
  await expect(page.locator('.photo-list .ph')).toHaveCount(0)
  await expect(chip(page, '经典')).toHaveAttribute('aria-pressed', 'true')
  expect(errors, `the page threw: ${errors.join(' | ')}`).toEqual([])
})
