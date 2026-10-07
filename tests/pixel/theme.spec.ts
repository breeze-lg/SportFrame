import { test, expect } from '@playwright/test'

const RGB = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`

test.describe('themes', () => {
  test('light theme paints the wall colour', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(233, 232, 227))
  })

  test('dark theme paints the wall colour', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(25, 24, 21))
  })

  test('--mat is identical in both themes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/')
      const mat = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mat').trim().toUpperCase()
      )
      expect(mat, `--mat in ${scheme}`).toBe('#FFFFFF')
    }
  })

  test('theme-color meta follows --wall in both themes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/')
      const [meta, wall] = await page.evaluate(() => [
        document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
        getComputedStyle(document.documentElement).getPropertyValue('--wall'),
      ])
      expect(meta.toUpperCase(), `theme-color in ${scheme}`).toBe(wall.trim().toUpperCase())
    }
  })
})
