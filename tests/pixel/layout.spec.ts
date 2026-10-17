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

  // and it is the primary action
  await expect(page.locator('#save')).toHaveClass(/btn-primary/)

  // 存为模板 is not beside it any more: it lives with the numbers it keeps, in
  // the 画面 panel's heading, which is also where 重置 is. Both are below 保存,
  // in the same column — the panel and the save are one column of work.
  await expect(page.locator('#saveTpl')).not.toHaveClass(/btn-primary/)
  for (const sel of ['#saveTpl', '#mount-reset']) {
    const b = await box(page, sel)
    expect(b.x, `${sel} left the right column`).toBeGreaterThanOrEqual(dock.x - 1)
    expect(b.y, `${sel} is above 保存`).toBeGreaterThan(save.y)
  }

  // the panels it serves are below it, still in the same column
  for (const sel of ['#modes', '#panels']) {
    const b = await box(page, sel)
    expect(b.x, `${sel} left the right column`).toBeGreaterThanOrEqual(dock.x - 1)
    expect(b.y, `${sel} is above 保存`).toBeGreaterThan(save.y)
  }
})

test('the poster is named under it, and the mount is a strip of collections', async ({ page }) => {
  await page.goto('/')

  // The caption is the poster's own margin: under the canvas, above the rack,
  // in the middle column. This is the reference editor's title block — the one
  // place the style that is on is legible in words.
  const wall = await box(page, '.wall')
  const cap = await box(page, '.poster-cap')
  const styles = await box(page, '.styles')
  expect(cap.y, 'the caption is not under the poster').toBeGreaterThanOrEqual(wall.y)
  expect(cap.y, 'the caption is not above the rack').toBeLessThanOrEqual(styles.y + 1)
  await expect(page.locator('#cap-name')).not.toBeEmpty()
  await expect(page.locator('#cap-tag')).not.toBeEmpty()

  // The collections sit above the chips, and one of them is on.
  const tabs = await box(page, '.tabs')
  const rail = await box(page, '.rail')
  expect(tabs.y, 'the collections are not above the rack').toBeLessThan(rail.y)
  await expect(page.locator('.tab.on')).toHaveCount(1)
})

test('on a phone the poster keeps the screen and the list is behind a button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  // the bar, then the stack: poster → caption → collections → rack → switch
  const bar = await box(page, '.topbar')
  const wall = await box(page, '.wall')
  const cap = await box(page, '.poster-cap')
  const styles = await box(page, '.styles')
  const dock = await box(page, '.dock')

  expect(wall.y).toBeGreaterThan(bar.y)
  expect(cap.y).toBeGreaterThan(wall.y)
  expect(styles.y).toBeGreaterThan(cap.y)
  expect(dock.y, 'the adjustments are not the last block on a phone').toBeGreaterThan(
    styles.y + styles.height - 1,
  )

  // 保存 is in the bar, not in a dock row, and the panel switch is the last row
  // on the screen — the reference's capsule at the foot.
  await expect(page.locator('#save-top')).toBeVisible()
  await expect(page.locator('.acts')).toBeHidden()
  const modes = await box(page, '.modes')
  expect(modes.y + modes.height).toBeLessThanOrEqual(844)
  expect(modes.y).toBeGreaterThan(dock.y)

  // The page itself does not scroll: the poster is what the screen is for, and a
  // stack that grew would put the switch that changes the mount below the fold.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight + 2,
  )
  expect(scrolls, 'the phone layout scrolls the page').toBe(false)
  expect(wall.height, 'the wall lost the top of the screen').toBeGreaterThan(844 * 0.3)

  // 照片 is a sheet behind the bar's button rather than a column, and the bare
  // wall carries its own way in for a first visit — a way in that lives behind a
  // button is no way in at all for someone who has never used the app.
  await expect(page.locator('#wall-empty')).toBeVisible()
  await expect(page.locator('#add-photo')).toBeVisible()
  await expect(page.locator('#photos')).toBeHidden()
  await page.locator('#photos-open').click()
  await expect(page.locator('#photos')).toBeVisible()
  await expect(page.locator('.photos #drop')).toHaveCount(1)
  await expect(page.locator('.photos #file')).toHaveCount(1)
  await expect(page.locator('#photos-open')).toHaveAttribute('aria-expanded', 'true')
  // ...and it closes from inside itself, because the sheet covers the button
  // that opened it — plus by tapping away.
  await expect(page.locator('#scrim')).toBeVisible()
  // to the right of the sheet, which is where the poster behind it is: the
  // scrim covers the whole viewport, so the middle of it is inside the sheet
  await page.locator('#scrim').click({ position: { x: 360, y: 300 } })
  await expect(page.locator('#photos')).toBeHidden()
  await page.locator('#photos-open').click()
  await page.locator('#photos-close').click()
  await expect(page.locator('#photos')).toBeHidden()
  await expect(page.locator('#photos-open')).toHaveAttribute('aria-expanded', 'false')
})
