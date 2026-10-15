import { cover } from '../core/geometry'
import type { Photo } from '../core/types'

/**
 * The photograph list — the left column, and the model behind it.
 *
 * Split the way the rest of this app's panels are split: the three functions
 * under `PhotoList` are pure and take a list, an index and nothing else, so the
 * rules that are easy to get wrong (which photograph the wall points at after a
 * deletion, and what "no photographs" means) are testable in `node`; the DOM
 * half below is the list itself and knows nothing.
 */

export type PhotoList = { photos: Photo[]; active: number }

/**
 * The photograph on the wall.
 *
 * It lives here rather than beside the app's state because a `PhotoList` is all
 * it needs — the app's state happens to be one, and so does every list this
 * module's functions are tested against.
 *
 * There is no stored `exif` beside it anywhere: the camera plate reads the
 * active photograph's own EXIF, and a second copy of that is a value that goes
 * stale the moment the user switches photographs, which is the one thing a list
 * makes routine.
 */
export function activePhoto(list: PhotoList): Photo | null {
  return list.photos[list.active] ?? null
}

/**
 * Appends a batch and puts the wall on the *first* of it.
 *
 * A batch rather than a single file because the picker takes several, and one
 * event per file would repaint the wall — and re-render every style preview —
 * once per photograph. The first of the batch is the choice: it is the one the
 * user picked first, and with a single file (the common case) it is the only
 * one, so there is no rule here that shows up in normal use.
 */
export function addPhotos(list: PhotoList, added: Photo[]): PhotoList {
  if (added.length === 0) return list
  return { photos: [...list.photos, ...added], active: list.photos.length }
}

/**
 * Drops one photograph and hands it back, so the caller can release the blob
 * URL it is holding (`releasePhoto`) — the list owns that lifetime now.
 *
 * The active index has to keep pointing at the *same* photograph, which is the
 * whole difficulty: every entry after the hole shifts down one, so an index
 * past the removed one is off by one until it is corrected, and removing the
 * active photograph has to leave the wall on something real. The remaining
 * photograph at that position is the one that was after it; at the end of the
 * list there is none, so it lands on the new last one. An empty list is not an
 * error state — the app's default state is a bare wall — so it settles on 0 and
 * `activePhoto` answers `null`.
 */
export function removePhoto(
  list: PhotoList,
  index: number,
): { list: PhotoList; removed: Photo | null } {
  const removed = list.photos[index]
  if (!removed) return { list, removed: null }
  const photos = list.photos.filter((_, i) => i !== index)
  let active = list.active
  if (photos.length === 0) active = 0
  else if (index < active) active -= 1
  else if (index === active) active = Math.min(index, photos.length - 1)
  return { list: { photos, active }, removed }
}

/** Puts the wall on one of the list. An index that is not there is ignored. */
export function selectPhoto(list: PhotoList, index: number): PhotoList {
  if (index < 0 || index >= list.photos.length || index === list.active) return list
  return { ...list, active: index }
}

/** The list's thumbnail box in CSS pixels, and the scale its print is cut at. */
const THUMB = 46
const THUMB_DPR = 2

/** The crop's vertical bias, as CSS `background-position` would read it: a crop
 *  centred dead-on a portrait cuts the top off, which is where a face usually
 *  is. The rail's chips use the same 44%, from the design sheet. */
const THUMB_BIAS = 0.44

/**
 * One photograph, cover-cropped to a square for the list.
 *
 * Cut here rather than handed to the browser as a CSS `background` over the
 * photo's own URL: a dozen rows sharing one `url()` would carry a dozen copies
 * of the same multi-megabyte string through style recalculation, and the
 * browser would re-crop a 27 MP source per row on every repaint. `cover` is the
 * same crop arithmetic the poster's blur background uses, so the list and the
 * wall agree about what a photograph looks like.
 *
 * Memoised on the source URL, because the list is repainted on every add and
 * every switch, and the photograph has not changed.
 */
const thumbs = new Map<string, string | null>()

export function photoThumb(photo: Photo): string | null {
  if (photo.width <= 0 || photo.height <= 0) return null
  const src = photo.el.src
  // `has` rather than a truthy read: a canvas that would not hand back a data
  // URL caches its `null`, and re-cutting it on every repaint would be a
  // failure this list repeats for as long as the photo is in it.
  if (thumbs.has(src)) return thumbs.get(src) ?? null

  let url: string | null = null
  const c = document.createElement('canvas')
  c.width = THUMB * THUMB_DPR
  c.height = THUMB * THUMB_DPR
  const ctx = c.getContext('2d')
  if (ctx) {
    const box = cover(photo.width, photo.height, c.width, c.height, 1)
    // Both offsets are negative by construction — `cover` never returns a box
    // smaller than the canvas — and match `background-position` semantics.
    ctx.drawImage(
      photo.preview ?? photo.el,
      (c.width - box.w) * 0.5,
      (c.height - box.h) * THUMB_BIAS,
      box.w,
      box.h,
    )
    url = c.toDataURL('image/png')
  }
  thumbs.set(src, url)
  return url
}

/** Forgets a photograph's thumbnail when it leaves the list, so a session that
 *  loads and drops its way through a folder does not accumulate bitmaps for
 *  photographs nothing can draw any more. */
export function forgetThumb(photo: Photo): void {
  thumbs.delete(photo.el.src)
}

/**
 * The list itself: one row per photograph loaded this session, the one on the
 * wall marked, each row removable.
 *
 * The row is a button and a sibling `×`, never a button inside a button — the
 * same shape the rail's saved templates use, and for the same reason. The name
 * carries every claim: `aria-pressed` for the wall's own photograph, and a
 * `title` with the dimensions, because a 46px crop of a 640×1074 file says
 * nothing about which file it is.
 */
export function renderPhotoList(
  host: HTMLElement,
  list: PhotoList,
  onSelect: (index: number) => void,
  onRemove: (index: number) => void,
): void {
  host.textContent = ''

  if (list.photos.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'ph-empty'
    empty.textContent = '还没有照片'
    host.appendChild(empty)
    return
  }

  list.photos.forEach((photo, i) => {
    const row = document.createElement('div')
    row.className = 'ph'
    row.dataset.index = String(i)

    const pick = document.createElement('button')
    pick.className = 'ph-pick' + (i === list.active ? ' on' : '')
    pick.type = 'button'
    pick.setAttribute('aria-pressed', i === list.active ? 'true' : 'false')
    pick.setAttribute('aria-label', photo.name)
    pick.title = `${photo.name} · ${photo.width}×${photo.height}`

    const shot = document.createElement('span')
    shot.className = 'ph-thumb'
    const thumb = photoThumb(photo)
    if (thumb) {
      shot.style.backgroundImage = `url("${thumb}")`
      shot.classList.add('shot')
    }
    pick.appendChild(shot)

    const name = document.createElement('span')
    name.className = 'ph-name'
    name.textContent = photo.name
    pick.appendChild(name)

    pick.addEventListener('click', () => onSelect(i))
    row.appendChild(pick)

    const del = document.createElement('button')
    del.className = 'ph-del'
    del.type = 'button'
    del.textContent = '×'
    del.title = `移除 ${photo.name}`
    del.setAttribute('aria-label', `移除 ${photo.name}`)
    del.addEventListener('click', () => onRemove(i))
    row.appendChild(del)

    host.appendChild(row)
  })
}
