import { test, expect } from '@playwright/test'

test('the dock offers exactly one primary action', async ({ page }) => {
  await page.goto('/')
  // On screen, not in the DOM: 保存 is drawn twice — the dock's, which is the
  // one on a desk, and the top bar's, which is the one on a phone — and exactly
  // one of them is ever visible (see `app.css`). Two primary actions a user can
  // see would be two answers to \"what does this screen do\".
  await expect(page.locator('.btn-primary:visible')).toHaveCount(1)
  await expect(page.locator('.btn-primary:visible')).toHaveText('保存')
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

/**
 * `.drop` is a plain `div` whose click handler opens `#file`, and `#file` is
 * `hidden`. For a keyboard-only visitor that left the app's primary action —
 * the only way to put a photo on the wall — with no route to it at all: not a
 * tab stop, not activatable. Hence `tabindex="0"`, `role="button"`, and the
 * Enter/Space handler in `wireInput`; all three are asserted here, because any
 * one of them alone still leaves the door shut.
 *
 * The picker itself is the OS's and invisible to this test. What is observable
 * is the click the app sends to `#file`, which is the whole of what the app
 * does in response — so that is what the stub counts.
 */
test('the drop zone can be reached and opened from the keyboard alone', async ({ page }) => {
  await page.goto('/')

  // Reachable: Tab lands on it. Clicking it first would prove nothing — the
  // question is whether the keyboard can get there without a pointer.
  let reached = false
  for (let i = 0; i < 5 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.id === 'drop')
  }
  expect(reached, 'Tab never lands on #drop — it is not in the tab order').toBe(true)

  // Operable: Enter and Space do what a click does.
  await page.evaluate(() => {
    const input = document.querySelector('#file') as HTMLInputElement
    ;(window as any).__opens = 0
    input.click = () => {
      ;(window as any).__opens += 1
    }
  })

  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await page.click('#drop')

  expect(await page.evaluate(() => (window as any).__opens)).toBe(3)
})

/**
 * This guard used to read "there is no adjustments control in stages 1-4" — no
 * element containing 调整, no `input[type=range]` anywhere in the dock. The 画面
 * panel is a later stage's work and is exactly the surface that test said was
 * absent, so the claim about *stages* is retired. What replaces it is the claim
 * that still has content: the sliders that exist are the panel's, they all
 * carry a name, and there is no second place in this app that adjusts a poster.
 *
 * `tests/pixel/controls.spec.ts` is where the panel itself is answered for —
 * which controls each template gets, that a drag reaches the wall, and that
 * 存为模板 keeps the numbers.
 */
test('the two panels between them are the adjustment surface, and nothing else is', async ({
  page,
}) => {
  await page.goto('/')

  // 画面 first: 经典 is the boot mount and a blur one, so all eight rows are on —
  // five for the mount and three for 后景.
  const mount = page.locator('#control-row input[type="range"]')
  await expect(mount).toHaveCount(8)

  const labels = await mount.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  for (const label of labels) {
    expect(label, 'a slider with no accessible name').toBeTruthy()
    // one row per slider, with its own readout beside it
    await expect(page.locator(`#controls .ctl:has(input[aria-label="${label}"])`)).toHaveCount(1)
    await expect(page.locator(`#controls .ctl:has(input[aria-label="${label}"]) .ctl-val`)).toHaveCount(1)
  }

  // 文字 next: two for the block's position, one per slot the template prints —
  // and every one of them in the 文字 panel, not loose in the dock.
  await page.locator('.mode', { hasText: '文字' }).click()
  const type = page.locator('#field-row input[type="range"]')
  await expect(type).toHaveCount(4)
  expect(await type.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
    '水平',
    '垂直',
    '副标题字号',
    '主标题字号',
  ])

  // No slider anywhere else, and no two of them share a name: two slots both
  // showing 字号 would be two sliders a screen reader cannot tell apart.
  const all = page.locator('input[type="range"]')
  expect(await all.evaluateAll((els) => els.filter((e) => !e.closest('#panels')).length)).toBe(0)
  const names = await all.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  expect(new Set(names).size, 'two sliders share a name').toBe(names.length)
})
