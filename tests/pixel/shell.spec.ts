import { test, expect } from '@playwright/test'

test('the dock offers exactly one primary action', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.btn-primary')).toHaveCount(1)
  await expect(page.locator('.btn-primary')).toHaveText('保存')
})

test('there is no adjustments control in stages 1-4', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('调整', { exact: true })).toHaveCount(0)
})
