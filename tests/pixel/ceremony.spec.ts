import { test, expect } from '@playwright/test'

test('the ceremony hides the chrome and states the dimensions', async ({ page }) => {
  // `__frameCeremony` lives behind the same `?dev=1` guard every other pixel
  // spec here uses — at `/` the handle is not installed.
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frameCeremony' in window)

  // The shell's three columns, each carrying focusable controls — the photo
  // list, the rail of styles, and `#save` — because half of what
  // `body.ceremony-open` has to do is keep those controls out of the tab order.
  // Nothing is fabricated here: a shell that loses a column fails this spec
  // rather than being papered over.
  await page.evaluate(() => {
    const mod = (window as any).__frameCeremony
    return mod.showCeremony('data:image/gif;base64,R0lGODlhAQABAAAAACw=', 2880, 3600, () => {})
  })

  await expect(page.locator('.ceremony')).toHaveCount(1)
  await expect(page.locator('.ceremony-dims')).toHaveText('2880 × 3600 PNG')

  // which column, if any, holds the focused element
  const focusedColumn = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return 'none'
      for (const sel of ['.photos', '.styles', '.dock']) {
        if (el.closest(sel)) return sel
      }
      return el.tagName
    })

  for (const column of ['.photos', '.styles', '.dock']) {
    // the column is present but receded — not removed, so nothing reflows
    expect(
      await page.locator(column).evaluate((el) => getComputedStyle(el).opacity),
      `${column} did not recede`,
    ).toBe('0')

    // ...and invisible, not merely transparent. `opacity: 0` alone leaves its
    // controls in the tab order, so a keyboard user tabbing during the ceremony
    // lands on controls they cannot see.
    await expect(page.locator(column)).toHaveCSS('visibility', 'hidden')
  }

  const tabbed: string[] = []
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    tabbed.push(await focusedColumn())
  }
  expect(tabbed).not.toContain('.photos')
  expect(tabbed).not.toContain('.styles')
  expect(tabbed).not.toContain('.dock')

  await page.locator('[data-act="done"]').click()
  await expect(page.locator('.ceremony')).toHaveCount(0)
  // ...and the chrome comes back: the wall is only borrowed for the ceremony
  await expect(page.locator('body')).not.toHaveClass(/ceremony-open/)
  await expect(page.locator('.dock')).toHaveCSS('visibility', 'visible')

  // every column is reachable again, not left stolen from the keyboard
  const seen = new Set<string>()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    seen.add(await focusedColumn())
  }
  for (const column of ['.photos', '.styles', '.dock']) {
    expect(seen, `${column} is unreachable by keyboard`).toContain(column)
  }
})
