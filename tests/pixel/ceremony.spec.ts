import { test, expect } from '@playwright/test'

test('the ceremony hides the chrome and states the dimensions', async ({ page }) => {
  // `__frameCeremony` lives behind the same `?dev=1` guard every other pixel
  // spec here uses — at `/` the handle is not installed.
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frameCeremony' in window)

  // `body.ceremony-open .dock` is the rule under test, and the dock markup
  // itself is Task 10's. Stand one in only while it is absent, so this pins the
  // shipped rule without pre-empting the shell. It carries a focusable control
  // because half of what the rule has to do is keep it out of the tab order.
  await page.evaluate(() => {
    if (!document.querySelector('.dock')) {
      const dock = document.createElement('aside')
      dock.className = 'dock'
      const btn = document.createElement('button')
      btn.dataset.probe = 'dock'
      btn.textContent = '模板'
      dock.appendChild(btn)
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

  // ...and invisible, not merely transparent. `opacity: 0` alone leaves the
  // dock's controls in the tab order, so a keyboard user tabbing during the
  // ceremony lands on controls they cannot see.
  await expect(page.locator('.dock')).toHaveCSS('visibility', 'hidden')

  const tabbed: string[] = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    tabbed.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el?.dataset?.probe ?? el?.tagName ?? 'none'
      }),
    )
  }
  expect(tabbed).not.toContain('dock')

  await page.locator('[data-act="done"]').click()
  await expect(page.locator('.ceremony')).toHaveCount(0)
  // ...and the chrome comes back: the wall is only borrowed for the ceremony
  await expect(page.locator('body')).not.toHaveClass(/ceremony-open/)
  await expect(page.locator('.dock')).toHaveCSS('visibility', 'visible')

  // the dock is reachable again, not left stolen from the keyboard
  let reachable = false
  for (let i = 0; i < 4 && !reachable; i++) {
    await page.keyboard.press('Tab')
    reachable = await page.evaluate(() => !!document.activeElement?.closest('.dock'))
  }
  expect(reachable).toBe(true)
})
