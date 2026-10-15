import { test, expect, type Page } from '@playwright/test'
import { TEMPLATES } from '../../src/core/templates'

/**
 * The premium surface, in the one state v1 can reach.
 *
 * Spec §10 ships nothing gated: `isUnlocked` answers true for every template,
 * so the plaque — premium *and* locked — never shows, and that absence is the
 * claim being tested rather than an untested gap. Two halves make the claim
 * whole, and neither passes alone:
 *
 *   1. the plaque is in the dock, after the rail, and hidden — the layout and
 *      the `[hidden]` guard, which is not free once `.plaque-row` sets its own
 *      `display`;
 *   2. the picker *rewrites* it, proven by taking a plaque that is already
 *      showing away. An element nothing ever writes looks identical to an
 *      element that is correctly hidden, and only a write can tell them apart.
 *
 * The locked copy itself ('样张 · 铜角装裱') is unreachable from this page, so
 * the rule that produces it is pinned in `tests/unit/plaque.test.ts`. The brass
 * corner on the premium chip is the rail's own marker and is pinned in
 * `tests/pixel/rail.spec.ts` — it was already implemented and is not re-added
 * here.
 */

const premium = TEMPLATES.find((t) => t.premium)!
const free = TEMPLATES.find((t) => !t.premium)!
const chip = (page: Page, name: string) => page.locator(`.print[aria-label="${name}"]`)
const plaque = (page: Page) => page.locator('#plaque')

test('the dock carries a plaque, and v1 shows it for nothing', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.styles .plaque-row')).toHaveCount(1)
  // directly after the rail: the plaque belongs to the chip that is selected
  await expect(page.locator('#rail + #plaque')).toHaveCount(1)

  // Hidden, not merely marked: `.plaque-row` sets `display`, and a rule without
  // the `[hidden]` guard would announce a lock to every visitor on a screen
  // where nothing is locked.
  await expect(plaque(page)).toBeHidden()
  await expect(plaque(page)).toHaveText('')

  // The premium template is the one the plaque exists for, and picking it is
  // the whole of what a lock would react to.
  await chip(page, premium.name).click()
  await expect(chip(page, premium.name)).toHaveClass(/\bon\b/)
  await expect(plaque(page)).toBeHidden()
  await expect(plaque(page)).toHaveText('')

  await chip(page, free.name).click()
  await expect(plaque(page)).toBeHidden()
  await expect(plaque(page)).toHaveText('')
})

test('picking a template takes a showing plaque away — the wiring is live', async ({ page }) => {
  await page.goto('/')

  // A plaque mid-announcement: the state a gate would produce, staged by hand
  // because v1 cannot produce it. Anything the picker leaves alone stays on
  // screen, so this fails if the plaque is only described in the markup.
  await page.evaluate(() => {
    const el = document.querySelector('#plaque') as HTMLElement
    el.textContent = '样张 · 铜角装裱'
    el.hidden = false
  })
  await expect(plaque(page)).toBeVisible()
  // and when it does show, it wears the premium brass and nothing else
  await expect(plaque(page)).toHaveCSS('color', 'rgb(138, 106, 47)')

  await chip(page, premium.name).click()
  await expect(plaque(page)).toBeHidden()
  await expect(plaque(page)).toHaveText('')
})
