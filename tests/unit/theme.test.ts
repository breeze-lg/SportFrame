import { describe, it, expect } from 'vitest'
import { resolveTheme } from '../../src/ui/theme'

describe('resolveTheme', () => {
  it('honours a stored preference over the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('ignores a stored value that is not a known theme', () => {
    expect(resolveTheme('sepia', true)).toBe('dark')
    expect(resolveTheme('', false)).toBe('light')
  })
})
