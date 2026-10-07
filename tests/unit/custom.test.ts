import { describe, it, expect } from 'vitest'
import { loadCustom, saveCustom } from '../../src/ui/custom'
import { TEMPLATES } from '../../src/core/templates'

/**
 * The three functions under `src/ui/custom.ts` take `Storage | null` rather
 * than reaching for `window.localStorage`, which is what lets this suite run in
 * the `node` environment at all — there is no `localStorage` here to reach for.
 * A fake also buys the thing a real `localStorage` cannot be asked to do: throw
 * on demand.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

describe('custom templates', () => {
  it('round-trips a valid template', () => {
    const s = memoryStorage()
    expect(saveCustom(s, [TEMPLATES[0]!])).toBe(true)
    expect(loadCustom(s).map((t) => t.id)).toEqual([TEMPLATES[0]!.id])
  })

  it('returns an empty list when storage is unavailable', () => {
    expect(loadCustom(null)).toEqual([])
  })

  it('returns an empty list rather than throwing on corrupt json', () => {
    const s = memoryStorage()
    s.setItem('frame-app-custom-v1', '{not json')
    expect(loadCustom(s)).toEqual([])
  })

  it('drops entries that no longer validate', () => {
    const s = memoryStorage()
    s.setItem('frame-app-custom-v1', JSON.stringify([{ id: 'broken' }, TEMPLATES[0]]))
    expect(loadCustom(s).map((t) => t.id)).toEqual([TEMPLATES[0]!.id])
  })

  it('reports failure when setItem throws', () => {
    const s = memoryStorage()
    s.setItem = () => { throw new Error('quota') }
    expect(saveCustom(s, [TEMPLATES[0]!])).toBe(false)
  })

  // The stored bytes are not necessarily this app's bytes: Safari private mode
  // throws on access, an extension can rewrite the key, and a half-written
  // record is whatever the last write managed to land. Every one of those has
  // to come back as an empty (or shorter) list, never as a throw.
  it('returns an empty list rather than throwing when getItem throws', () => {
    const s = memoryStorage()
    s.getItem = () => { throw new Error('denied') }
    expect(loadCustom(s)).toEqual([])
  })

  it('returns an empty list when the stored value is not an array', () => {
    const s = memoryStorage()
    s.setItem('frame-app-custom-v1', JSON.stringify({ id: 'classic' }))
    expect(loadCustom(s)).toEqual([])
  })
})
