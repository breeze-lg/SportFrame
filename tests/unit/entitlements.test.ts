import { describe, it, expect } from 'vitest'
import { isUnlocked, canExport } from '../../src/entitlements'
import { TEMPLATES } from '../../src/core/templates'

const premium = TEMPLATES.find((t) => t.premium)!
const free = TEMPLATES.find((t) => !t.premium)!

describe('entitlements — v1 ships nothing gated', () => {
  it('unlocks premium templates in v1', () => {
    expect(isUnlocked(premium)).toBe(true)
  })

  it('unlocks free templates', () => {
    expect(isUnlocked(free)).toBe(true)
  })

  it('permits any export in v1', () => {
    expect(canExport(premium, 4).ok).toBe(true)
    expect(canExport(free, 2).ok).toBe(true)
  })
})
