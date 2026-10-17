import { describe, it, expect } from 'vitest'
import {
  MAX_BYTES,
  MAX_PHOTOS,
  loadSession,
  makeRoom,
  restoredActive,
  saveSession,
  sessionOf,
  type Session,
  type StoredPhoto,
} from '../../src/ui/session'
import { createState } from '../../src/ui/state'
import { TEMPLATES } from '../../src/core/templates'
import type { Photo } from '../../src/core/types'

/**
 * The session record: what a refresh comes back to.
 *
 * The bytes themselves live in IndexedDB, which does not exist in this
 * environment and is the browser suite's business (`tests/pixel/session.spec.ts`
 * reloads a page and looks). What is here is the part that has to be right
 * without a browser: the record's own shape — which is read back from
 * `localStorage` and therefore from a source that can hold anything — and the
 * eviction policy, which decides what the user loses.
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

const photo = (name: string): Photo =>
  ({ el: {} as HTMLImageElement, width: 100, height: 100, name, exif: null }) as Photo

const stored = (key: string, bytes: number, name = key): StoredPhoto => ({ key, bytes, name })

const record = (over: Partial<Session> = {}): Session => ({
  template: null,
  text: {},
  photos: [],
  active: 0,
  ...over,
})

describe('saveSession / loadSession', () => {
  it('round-trips a record', () => {
    const s = memoryStorage()
    const before = record({ template: TEMPLATES[0]!, text: { title: '回来了' }, photos: [stored('p1', 10)], active: 0 })
    expect(saveSession(s, before)).toBe(true)
    expect(loadSession(s)).toEqual(before)
  })

  it('answers null for a store it cannot read, or one with nothing in it', () => {
    expect(loadSession(null)).toBeNull()
    expect(loadSession(memoryStorage())).toBeNull()
  })

  it('answers null rather than throwing when the store throws', () => {
    // Safari private mode throws on access rather than answering null, which is
    // why every read here is a `try`.
    const s = memoryStorage()
    s.getItem = () => { throw new Error('denied') }
    expect(loadSession(s)).toBeNull()
    s.getItem = () => '{not json'
    expect(loadSession(s)).toBeNull()
    expect(loadSession(s)).toBeNull()
  })

  it('answers null for a record that is not an object', () => {
    for (const raw of ['3', '"x"', 'null', '[]', 'true']) {
      const s = memoryStorage()
      s.setItem('frame-app-session-v1', raw)
      expect(loadSession(s), raw).toBeNull()
    }
  })

  it('reports a refused write instead of throwing', () => {
    const s = memoryStorage()
    s.setItem = () => { throw new Error('quota') }
    expect(saveSession(s, record())).toBe(false)
  })

  it('keeps each field that is good and drops each one that is not', () => {
    // The record is not this app's own bytes: it can be an older build's shape,
    // an extension's edit, or half a write. One bad field must cost one field.
    const s = memoryStorage()
    s.setItem(
      'frame-app-session-v1',
      JSON.stringify({
        template: { ...TEMPLATES[0], frame: { ...TEMPLATES[0]!.frame, scale: 'nope' } },
        text: { title: '好的', sub: '', sign: 7, sideways: 'x' },
        photos: [stored('p1', 10), { key: '', name: 'empty' }, { key: 'p2' }, null, 'x'],
        active: 99,
      }),
    )
    const got = loadSession(s)
    expect(got).not.toBeNull()
    expect(got!.template).toBeNull()
    expect(got!.text).toEqual({ title: '好的' })
    expect(got!.photos).toEqual([stored('p1', 10)])
    // an active index past the end is not an index: the wall comes back on the
    // first photograph rather than on nothing
    expect(got!.active).toBe(0)
  })

  it('keeps an active index that is in range', () => {
    const s = memoryStorage()
    s.setItem(
      'frame-app-session-v1',
      JSON.stringify({ photos: [stored('p1', 1), stored('p2', 1)], active: 1 }),
    )
    expect(loadSession(s)!.active).toBe(1)
  })

  it('drops a photo entry whose size is not a number, rather than losing the entry', () => {
    const s = memoryStorage()
    s.setItem(
      'frame-app-session-v1',
      JSON.stringify({ photos: [{ key: 'p1', name: 'a', bytes: NaN }], active: 0 }),
    )
    expect(loadSession(s)!.photos).toEqual([{ key: 'p1', name: 'a', bytes: 0 }])
  })
})

describe('sessionOf', () => {
  it('is one entry per photograph in list order, whatever is actually stored', () => {
    const state = createState()
    state.photos = [photo('a'), photo('b')]
    state.active = 1
    state.text = { title: '喂' }

    const s = sessionOf(state)
    expect(s.photos).toEqual([
      // neither has bytes behind it: `putBytes` is what fills these in, and a
      // photograph whose store has not landed is one a reload loses
      { key: '', name: 'a', bytes: 0 },
      { key: '', name: 'b', bytes: 0 },
    ])
    expect(s.active).toBe(1)
    expect(s.text).toEqual({ title: '喂' })
  })

  it('carries the template record itself, so a tuned mount comes back tuned', () => {
    const tuned = { ...TEMPLATES[0]!, frame: { ...TEMPLATES[0]!.frame, scale: 48 } }
    const state = createState({ template: tuned })
    expect(sessionOf(state).template).toEqual(tuned)
  })
})

describe('makeRoom', () => {
  const caps = { photos: 3, bytes: 100 }

  it('drops nothing when there is room', () => {
    expect(makeRoom([stored('p1', 10)], 10, caps)).toEqual({ drop: [], fits: true })
  })

  it('drops the oldest first when the count is at its cap', () => {
    const held = [stored('p1', 1), stored('p2', 1), stored('p3', 1)]
    expect(makeRoom(held, 1, caps)).toEqual({ drop: ['p1'], fits: true })
  })

  it('drops as many as the size needs, oldest first', () => {
    const held = [stored('p1', 40), stored('p2', 40), stored('p3', 10)]
    // 90 held + 20 incoming = 110 > 100: the head goes, and that is enough
    expect(makeRoom(held, 20, caps)).toEqual({ drop: ['p1'], fits: true })
    // 90 + 50 = 140, then 50 + 50 = 100 — the first drop is enough, and the
    // cap is inclusive
    expect(makeRoom(held, 50, caps)).toEqual({ drop: ['p1'], fits: true })
    // 90 + 61 = 151, then 50 + 61 = 111 — still over, so the second head goes
    expect(makeRoom(held, 61, caps)).toEqual({ drop: ['p1', 'p2'], fits: true })
  })

  it('treats the caps as inclusive', () => {
    expect(makeRoom([stored('p1', 70)], 30, caps)).toEqual({ drop: [], fits: true })
    expect(makeRoom([stored('p1', 71)], 30, caps)).toEqual({ drop: ['p1'], fits: true })
  })

  it('refuses a photograph bigger than the whole budget', () => {
    // Dropping everything and then failing is the failure mode this flag
    // exists to prevent: the caller has to know before it evicts on behalf of
    // a write that cannot succeed.
    const held = [stored('p1', 10), stored('p2', 10)]
    expect(makeRoom(held, 101, caps)).toEqual({ drop: ['p1', 'p2'], fits: false })
  })

  it('holds at the real caps', () => {
    const held = Array.from({ length: MAX_PHOTOS }, (_, i) => stored(`p${i}`, 1024))
    expect(makeRoom(held, 1024).drop).toEqual(['p0'])
    const heavy = [stored('p1', MAX_BYTES - 10)]
    expect(makeRoom(heavy, 10).drop).toEqual([])
    expect(makeRoom(heavy, 11).drop).toEqual(['p1'])
  })

  it('does not mutate the list it was handed', () => {
    const held = [stored('p1', 1), stored('p2', 1)]
    makeRoom(held, 1, caps)
    expect(held.map((p) => p.key)).toEqual(['p1', 'p2'])
  })
})

describe('restoredActive', () => {
  it('is the photograph that was on the wall, when it survived', () => {
    expect(restoredActive([0, 1, 2], 1)).toBe(1)
  })

  it('falls back to the nearest survivor before it', () => {
    // Two photographs that did not come back take their indices with them, and
    // the wall lands on the one that used to be just above them.
    expect(restoredActive([0, 3], 2)).toBe(0)
    expect(restoredActive([1, 2], 0)).toBe(0)
  })

  it('lands on the first row when nothing before it survived', () => {
    expect(restoredActive([2, 3], 0)).toBe(0)
    expect(restoredActive([], 0)).toBe(0)
    expect(restoredActive([5], 9)).toBe(0)
  })
})
