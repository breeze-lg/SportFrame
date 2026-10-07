import { test, expect } from '@playwright/test'

test('the ceremony hides the chrome and states the dimensions', async ({ page }) => {
  // `__frameCeremony` lives behind the same `?dev=1` guard every other pixel
  // spec here uses — at `/` the handle is not installed.
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frameCeremony' in window)

  // `body.ceremony-open .dock { opacity: 0 }` is the rule under test, and the
  // dock markup itself is Task 10's. Stand one in only while it is absent, so
  // this pins the shipped rule without pre-empting the shell.
  await page.evaluate(() => {
    if (!document.querySelector('.dock')) {
      const dock = document.createElement('aside')
      dock.className = 'dock'
      document.body.appendChild(dock)
    }
  })

  await page.evaluate(() => {
    const mod = (window as any).__frameCeremony
    return mod.showCeremony('data:image/gif;base64,R0lGODlhAQABAAAAACw=', 2880, 3600, () => {})
  })

  await expect(page.locator('.ceremony')).toHaveCount(1)
  await expect(page.locator('.ceremony-dims')).toHaveText('2880 × 3600 PNG')

  // the dock is present but receded — not removed, so nothing reflows
  const dockOpacity = await page.locator('.dock').evaluate(
    (el) => getComputedStyle(el).opacity,
  )
  expect(dockOpacity).toBe('0')

  await page.locator('[data-act="done"]').click()
  await expect(page.locator('.ceremony')).toHaveCount(0)
  // ...and the chrome comes back: the wall is only borrowed for the ceremony
  await expect(page.locator('body')).not.toHaveClass(/ceremony-open/)
})
