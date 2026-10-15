import { describe, it, expect } from 'vitest'
import { activePhoto, addPhotos, removePhoto, selectPhoto, type PhotoList } from '../../src/ui/photos'
import type { Photo } from '../../src/core/types'

/**
 * The photograph list's rules, without a browser.
 *
 * What is easy to get wrong here is not the appending: it is which photograph
 * the wall points at after a deletion, and what "no photographs" means. Both
 * are index arithmetic over a list that shifts under the index, both are
 * invisible until the day a user deletes the photograph they are looking at,
 * and both are decidable in `node` if the rules are kept out of the DOM —
 * which is the only reason `src/ui/photos.ts` is split the way it is.
 */

const photo = (name: string): Photo =>
  ({ el: {} as HTMLImageElement, width: 100, height: 100, name, exif: null }) as Photo

const list = (...names: string[]): PhotoList => ({
  photos: names.map(photo),
  active: 0,
})

/** The photograph the wall is on, as a name — the identity every case below is
 *  actually about, since two entries can share one. */
const shown = (l: PhotoList): string | null => activePhoto(l)?.name ?? null

describe('activePhoto', () => {
  it('answers the photograph at the active index, and null for an empty list', () => {
    expect(shown({ photos: [], active: 0 })).toBeNull()
    expect(shown({ photos: [photo('a'), photo('b')], active: 1 })).toBe('b')
    // an index past the end is a hole, not a crash: the list is mutated by
    // index and `active` is corrected on every mutation, but a record read back
    // from somewhere else must still degrade rather than throw
    expect(shown({ photos: [photo('a')], active: 7 })).toBeNull()
  })
})

describe('addPhotos', () => {
  it('appends and puts the wall on the first of the batch', () => {
    const next = addPhotos(list('a'), [photo('b'), photo('c')])
    expect(next.photos.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(shown(next)).toBe('b')
  })

  it('keeps the photographs already in the list, in order', () => {
    const before = list('a', 'b')
    before.active = 1
    const next = addPhotos(before, [photo('c')])
    expect(next.photos.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(shown(next)).toBe('c')
  })

  it('is a no-op for an empty batch, by reference', () => {
    // A drop that carried no files must not repaint the wall, and the caller
    // decides that by comparing references.
    const before = list('a')
    expect(addPhotos(before, [])).toBe(before)
  })

  it('does not mutate the list it was handed', () => {
    const before = list('a')
    addPhotos(before, [photo('b')])
    expect(before.photos.map((p) => p.name)).toEqual(['a'])
    expect(before.active).toBe(0)
  })
})

describe('selectPhoto', () => {
  it('moves the wall to the index', () => {
    expect(shown(selectPhoto(list('a', 'b', 'c'), 2))).toBe('c')
  })

  it('is a no-op for the photograph already on, by reference', () => {
    const before = list('a', 'b')
    expect(selectPhoto(before, 0)).toBe(before)
  })

  it('ignores an index that is not in the list', () => {
    const before = list('a', 'b')
    expect(selectPhoto(before, 9)).toBe(before)
    expect(selectPhoto(before, -1)).toBe(before)
  })
})

describe('removePhoto', () => {
  it('hands the removed photograph back so its blob URL can be released', () => {
    const before = list('a', 'b', 'c')
    const { removed, list: after } = removePhoto(before, 1)
    expect(removed?.name).toBe('b')
    expect(after.photos.map((p) => p.name)).toEqual(['a', 'c'])
  })

  it('keeps the wall on the same photograph when one before it goes', () => {
    // The index of every entry after the hole shifts down one: without the
    // correction the wall would jump to a different photograph, which is the
    // whole failure this arithmetic exists to prevent.
    const before: PhotoList = { photos: [photo('a'), photo('b'), photo('c')], active: 2 }
    expect(shown(removePhoto(before, 0).list)).toBe('c')
    expect(shown(removePhoto(before, 1).list)).toBe('c')
  })

  it('lands on the photograph that took the active slot when the active one goes', () => {
    const before: PhotoList = { photos: [photo('a'), photo('b'), photo('c')], active: 1 }
    expect(shown(removePhoto(before, 1).list)).toBe('c')
  })

  it('lands on the new last photograph when the last one was the active one', () => {
    const before: PhotoList = { photos: [photo('a'), photo('b'), photo('c')], active: 2 }
    expect(shown(removePhoto(before, 2).list)).toBe('b')
  })

  it('leaves the wall where it is when something after the active one goes', () => {
    const before: PhotoList = { photos: [photo('a'), photo('b'), photo('c')], active: 0 }
    expect(shown(removePhoto(before, 2).list)).toBe('a')
  })

  it('settles on an empty list, with nothing to show and nothing to crash', () => {
    // The app's default state is a bare wall, so the last deletion is a return
    // to the state the app boots in rather than an error.
    const { removed, list: after } = removePhoto(list('a'), 0)
    expect(removed?.name).toBe('a')
    expect(after.photos).toEqual([])
    expect(after.active).toBe(0)
    expect(shown(after)).toBeNull()
  })

  it('ignores an index that is not in the list, and hands nothing back', () => {
    const before = list('a', 'b')
    expect(removePhoto(before, 5).list).toBe(before)
    expect(removePhoto(before, 5).removed).toBeNull()
  })

  it('does not mutate the list it was handed', () => {
    const before: PhotoList = { photos: [photo('a'), photo('b')], active: 1 }
    removePhoto(before, 0)
    expect(before.photos.map((p) => p.name)).toEqual(['a', 'b'])
    expect(before.active).toBe(1)
  })

  it('survives a run of deletions: the wall is never on nothing while something is left', () => {
    // The invariant, over every order of removals rather than over the three or
    // four cases above: while the list holds a photograph, `activePhoto` answers
    // one, and it is the photograph the index has always meant.
    // Every sequence below removes all four, so the loop's last assertion is a
    // claim about four deletions and not three: an index that is not in the
    // list is a no-op, which is covered above.
    for (const order of [
      [0, 0, 0, 0],
      [1, 1, 1, 0],
      [2, 2, 0, 0],
      [3, 0, 0, 0],
      [2, 0, 1, 0],
    ]) {
      let l: PhotoList = { photos: [photo('a'), photo('b'), photo('c'), photo('d')], active: 2 }
      for (const i of order) {
        l = removePhoto(l, i).list
        if (l.photos.length > 0) {
          expect(shown(l), `after removing ${i} from ${JSON.stringify(l.photos.map((p) => p.name))}`).not.toBeNull()
        }
        expect(l.active).toBeGreaterThanOrEqual(0)
        expect(l.active).toBeLessThanOrEqual(Math.max(0, l.photos.length - 1))
      }
      expect(l.photos).toEqual([])
    }
  })
})
