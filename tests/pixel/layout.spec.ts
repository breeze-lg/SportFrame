import { test, expect, type Page } from '@playwright/test'

/**
 * The shell's shape, as geometry rather than as a screenshot.
 *
 * Three claims, and each one is a decision a user asked for by name: the
 * photographs are the left column, the styles are the rack under the wall in
 * the middle, and 保存 is in the top right corner. A stylesheet can lose any of
 * them in a one-line edit that no other test would notice — the panels would
 * still exist, still be wired, and still pass every behavioural spec.
 *
 * `boundingBox()` rather than a golden: these are relationships between boxes
 * (left of, below, corner of) and they stay true at any window size, which a
 * committed image of one viewport would not.
 */

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox()
  if (!b) throw new Error(`no box for ${selector}`)
  return b
}

test('the photographs are a column on the left', async ({ page }) => {
  await page.goto('/')

  const photos = await box(page, '.photos')
  const stage = await box(page, '.stage')
  const dock = await box(page, '.dock')

  expect(photos.x + photos.width, 'the photograph list is not left of the wall').toBeLessThanOrEqual(
    stage.x + 1,
  )
  expect(stage.x + stage.width, 'the wall is not left of the adjustments').toBeLessThanOrEqual(
    dock.x + 1,
  )
  // It takes the full height: it is a column of the shell, not a panel in one.
  expect(photos.height).toBeGreaterThan(page.viewportSize()!.height * 0.9)

  // The drop zone lives with the photographs, not with the styles or the save.
  await expect(page.locator('.photos #drop')).toHaveCount(1)
  await expect(page.locator('.photos #file')).toHaveCount(1)
})

test('the styles are a rack under the wall, in the middle column', async ({ page }) => {
  await page.goto('/')

  const stage = await box(page, '.stage')
  const wall = await box(page, '.wall')
  const styles = await box(page, '.styles')

  // inside the middle column...
  expect(styles.x).toBeGreaterThanOrEqual(stage.x - 1)
  expect(styles.x + styles.width).toBeLessThanOrEqual(stage.x + stage.width + 1)
  // ...across it...
  expect(styles.width).toBeGreaterThan(stage.width * 0.9)
  // ...and below the wall, which is the whole of "中间的下侧"
  expect(styles.y, 'the rack is not under the wall').toBeGreaterThanOrEqual(wall.y + wall.height - 1)
  expect(wall.height, 'the wall is not the larger half of the stage').toBeGreaterThan(styles.height)

  // Centred under the poster: the gap to the first chip and the gap after the
  // last one are the same. This is `justify-content: center` seen from outside —
  // measured from the chips, because the rail element itself spans the column.
  // Each chip rides in its own `.mount`, so the first and last chips are the
  // first and last mounts' children.
  const first = await box(page, '#rail .mount:first-child .print')
  const last = await box(page, '#rail .mount:last-child .print')
  const before = first.x - styles.x
  const after = styles.x + styles.width - (last.x + last.width)
  expect(Math.abs(before - after), `the rack is off centre: ${before} / ${after}`).toBeLessThan(30)
})

test('保存 is in the top right corner', async ({ page }) => {
  await page.goto('/')

  const dock = await box(page, '.dock')
  const save = await box(page, '#save')
  const view = page.viewportSize()!

  // in the rightmost column, and at its top — the two together are "top right"
  expect(save.x).toBeGreaterThanOrEqual(dock.x)
  expect(save.x + save.width).toBeLessThanOrEqual(view.width + 1)
  expect(save.y, '保存 is not at the top of the right column').toBeLessThan(dock.y + 80)
  expect(save.y, '保存 is not near the top of the screen').toBeLessThan(view.height * 0.15)

  // and it is the primary action: 存为模板 is the secondary beside it
  await expect(page.locator('#save')).toHaveClass(/btn-primary/)
  await expect(page.locator('#saveTpl')).not.toHaveClass(/btn-primary/)
  const tpl = await box(page, '#saveTpl')
  expect(tpl.y).toBeCloseTo(save.y, -1)
  expect(tpl.x).toBeGreaterThan(save.x + save.width - 1)

  // the panels it serves are below it, still in the same column
  for (const sel of ['#fields', '#controls']) {
    const b = await box(page, sel)
    expect(b.x, `${sel} left the right column`).toBeGreaterThanOrEqual(dock.x - 1)
    expect(b.y, `${sel} is above 保存`).toBeGreaterThan(save.y)
  }
})

test('on a phone the wall keeps the top and the panels scroll under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const wall = await box(page, '.wall')
  const styles = await box(page, '.styles')
  const photos = await box(page, '.photos')
  const dock = await box(page, '.dock')

  // wall (with its rack) → photographs → adjustments
  expect(styles.y).toBeGreaterThan(wall.y)
  expect(photos.y, 'the photographs are not under the wall on a phone').toBeGreaterThan(
    styles.y + styles.height - 1,
  )
  expect(dock.y, 'the adjustments are not the last column on a phone').toBeGreaterThan(
    photos.y + photos.height - 1,
  )

  // The wall keeps the top of the screen rather than being squeezed by the two
  // panels below it — the failure the caps exist to prevent.
  expect(wall.height, 'the wall lost the top of the screen').toBeGreaterThan(844 * 0.3)

  // Each capped panel scrolls instead of growing: its content is taller than
  // the box it was given.
  for (const sel of ['.photos', '.dock']) {
    const scrolls = await page
      .locator(sel)
      .evaluate((el) => el.scrollHeight > el.clientHeight || el.clientHeight < 844 * 0.65)
    expect(scrolls, `${sel} is not capped`).toBe(true)
  }
})
