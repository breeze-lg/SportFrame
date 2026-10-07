import { test, expect } from '@playwright/test'

test('the dock offers exactly one primary action', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.btn-primary')).toHaveCount(1)
  await expect(page.locator('.btn-primary')).toHaveText('保存')
})

/**
 * The default state is bare wall, and that is a claim about the whole stage.
 *
 * `#cv` ships with no `width`/`height` and nothing drawn, so it is a
 * transparent 300×150 box — but `box-shadow: var(--deep)` paints around that
 * box regardless, and in light theme that is a wide dark smudge floating
 * mid-wall, in exactly the state this shell exists to define. The frame is a
 * 4:5 portrait mat; a landscape 300×150 smudge is a rendering fault.
 *
 * `app.css` hides `canvas#cv:not([width])`. The second test is what makes the
 * guard safe rather than a stranding hazard: sizing the canvas for a photo
 * assigns `canvas.width`, which is a reflected attribute (verified against the
 * browser: the assignment writes `width="…"` and the `:not([width])` guard
 * releases), so the first `canvas.width = …` reveals the canvas again.
 */
test('the default state shows a bare wall, not an undrawn canvas', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas#cv')).toBeHidden()
})

test('sizing the canvas reveals it — the guard cannot strand a drawn canvas', async ({ page }) => {
  await page.goto('/')
  const revealed = await page.evaluate(async () => {
    const c = document.querySelector('canvas#cv') as HTMLCanvasElement
    const before = getComputedStyle(c).visibility
    c.width = 400
    c.height = 500
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return {
      before,
      attribute: c.getAttribute('width'),
      after: getComputedStyle(c).visibility,
    }
  })
  expect(revealed.before).toBe('hidden')
  expect(revealed.attribute).toBe('400')
  expect(revealed.after).toBe('visible')
})

test('there is no adjustments control in stages 1-4', async ({ page }) => {
  await page.goto('/')
  // Non-exact: a literal <button>调整</button> is not the only shape this
  // returns in. A heading 调整参数, or a compound label, contains the same
  // characters and must fail this guard too.
  await expect(page.getByText('调整', { exact: true })).toHaveCount(0)
  await expect(page.getByText('调整')).toHaveCount(0)
  // A slider with no text at all — the shape an adjustments panel actually
  // ships as — carries none of that text, so the range input is counted
  // separately.
  await expect(page.locator('input[type="range"]')).toHaveCount(0)
})
