import { test, expect, type Page } from '@playwright/test'

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

  /**
   * The first paint, with the module script blocked outright.
   *
   * `initTheme()` runs from a deferred module, so on its own it cannot paint the
   * first frame: a visitor whose system prefers dark would get a light wall,
   * then a 250ms fade to dark (app.css transitions background-color). The
   * remedy is the inline script in `index.html`'s head, and these tests hold it
   * to that job.
   *
   * Blocking the module is what makes the assertion mean something. Every
   * assertion here retries until it passes, so against a page where the module
   * still ran, "eventually dark" would hide the flash completely — the test
   * would pass on the bug. With the bundle aborted there is nothing left to
   * repaint the page, and `blocked` proves the abort actually happened: the
   * computed colour below is the colour that was painted.
   */
  const blockModule = async (page: Page): Promise<{ blocked: () => number }> => {
    let blocked = 0
    await page.route('**/assets/*.js', (route) => {
      blocked++
      return route.abort()
    })
    return { blocked: () => blocked }
  }

  test('a stored theme paints before the module script runs', async ({ page }) => {
    // System says light; the visitor said dark last visit.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('frame-app-theme', 'dark'))
    const bundle = await blockModule(page)
    await page.goto('/')

    expect(bundle.blocked()).toBeGreaterThan(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(25, 24, 21))
  })

  test('the system preference paints before the module script runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const bundle = await blockModule(page)
    await page.goto('/')

    expect(bundle.blocked()).toBeGreaterThan(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(25, 24, 21))
  })

  /**
   * The other half of the first paint: the head script runs before the
   * stylesheet link is even parsed (in `dist/index.html` the inline script is
   * above both `<script type="module">` and `<link rel="stylesheet">`), so
   * between the script and the stylesheet the document's `color-scheme` — the
   * UA's own chrome, not the wall — can come from nowhere else. Aborting both
   * the stylesheet and the module freezes the page inside that window: there is
   * no CSS to declare `color-scheme` and no module to re-apply it, which leaves
   * the inline `documentElement.style.colorScheme` as the only thing that can
   * answer. (`color-scheme` here is `normal` without it.)
   *
   * This test exists because the two above cannot see that line go missing:
   * `tokens.css` re-declares `color-scheme: dark` under
   * `:root[data-theme='dark']`, and the head script sets `data-theme`, so once
   * the stylesheet lands the computed value is dark whether or not the script
   * ever set it. There the assertion would hold on the bug; here it cannot.
   */
  test('the head script themes the document before the stylesheet lands', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('frame-app-theme', 'dark'))
    let stylesheets = 0
    await page.route('**/assets/*.css', (route) => {
      stylesheets++
      return route.abort()
    })
    const bundle = await blockModule(page)
    await page.goto('/')

    expect(bundle.blocked()).toBeGreaterThan(0)
    expect(stylesheets).toBeGreaterThan(0)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
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
