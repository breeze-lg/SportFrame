import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readStoredTheme, resolveTheme } from '../../src/ui/theme'

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

/**
 * The first-paint script in `index.html` cannot import `theme.ts` — a module is
 * deferred, which is the whole defect it exists to fix — so the storage key is
 * written out twice: once as `KEY` in `src/ui/theme.ts`, once as a literal in
 * the head. Two copies of a string that must agree, with no compiler between
 * them, is exactly the kind of pair that drifts silently: rename one and the
 * module keeps working while every returning visitor's first paint goes light.
 *
 * So the pair is pinned mechanically. The key this asks for comes from
 * `readStoredTheme()` itself, not from a third copy; the one it looks for comes
 * from parsing the shipped `index.html`.
 */
describe('the first-paint script reads the key theme.ts reads', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('index.html reads the same localStorage key as readStoredTheme', () => {
    const asked: string[] = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        asked.push(k)
        return null
      },
    })
    readStoredTheme()
    expect(asked).toHaveLength(1)

    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const inline = /localStorage\.getItem\(\s*'([^']+)'\s*\)/.exec(html)
    expect(inline, 'index.html has no inline localStorage read').not.toBeNull()
    expect(inline?.[1]).toBe(asked[0])
  })
})
