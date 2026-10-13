import { cover } from '../core/geometry'
import type { Photo, Template } from '../core/types'

/** The chip's box in CSS pixels, and the scale its print is cut at. */
const CHIP_W = 50
const CHIP_H = 62
const CHIP_DPR = 2

/**
 * The chip's print: the user's own photograph, cover-cropped to the chip box —
 * the treatment `design/style-direction.html` specifies for `.print .rawshot`
 * (`background-size: cover; background-position: 50% 44%`), and the reason the
 * rail reads as a rack of prints rather than a row of blank mounts.
 *
 * Cropped here, once, rather than handing the browser the photograph as a CSS
 * background: nine chips sharing one `url()` would carry nine copies of the
 * same multi-megabyte string through style recalculation, and the browser would
 * re-crop a 27 MP source nine times on every repaint. `cover` is the same
 * crop arithmetic the poster's own blur background uses, so the rack and the
 * wall agree about what the photograph looks like.
 *
 * The 44% vertical bias is the design's and it is deliberate: a crop centred
 * dead-on a portrait cuts the top off, which is where a face usually is.
 *
 * Memoised on the source URL, because `paintRail` runs on every pick and the
 * photograph — unlike the rail — has not changed. Returns `null` with no
 * photograph, which leaves the chip as the blank mount the default state wants.
 */
let thumbCache: { src: string; url: string | null } | null = null

export function chipThumb(photo: Photo | null): string | null {
  if (!photo || photo.width <= 0 || photo.height <= 0) return null
  const src = photo.el.src
  if (thumbCache && thumbCache.src === src) return thumbCache.url

  let url: string | null = null
  const c = document.createElement('canvas')
  c.width = CHIP_W * CHIP_DPR
  c.height = CHIP_H * CHIP_DPR
  const ctx = c.getContext('2d')
  if (ctx) {
    const box = cover(photo.width, photo.height, c.width, c.height, 1)
    // Both offsets are negative by construction (`cover` never returns a box
    // smaller than the canvas) and match CSS `background-position` semantics:
    // 0% is the image's top-left edge flush with the box's, 50%/44% is the one
    // the design asks for.
    ctx.drawImage(
      photo.preview ?? photo.el,
      (c.width - box.w) * 0.5,
      (c.height - box.h) * 0.44,
      box.w,
      box.h,
    )
    url = c.toDataURL('image/png')
  }
  thumbCache = { src, url }
  return url
}

/**
 * The template rail: one chip per template, drawn as a print rather than a
 * labelled button — the wall is the interface, and the rail is the rack of
 * mounts beside it. `thumb` is the photograph, cropped to the chip (see
 * `chipThumb`); the name is carried on `title` for a pointer and on
 * `aria-label` for everything that reads the page rather than looking at it.
 *
 * `aria-pressed` rather than `aria-selected`: these are toggle buttons in a
 * group, and `selected` is only meaningful inside a listbox or grid.
 *
 * `customIds` marks the templates the user saved. The list arrives merged, so
 * this is the one thing the rail cannot derive: a built-in and a copy of it are
 * the same record apart from the id and the name. `.custom` is the marker, and
 * it is deliberately not `.brass` — brass belongs to premium and to nothing
 * else — see `app.css`.
 *
 * A saved chip also carries a × (`onDelete`). Built-ins never do: they are the
 * product's own nine, and this rail is the only way to choose a mount, so a
 * control that could remove one would be a control that could empty the
 * product. Which templates are the user's is already known here, so the rule
 * is enforced in the one place that draws the affordance — the handler behind
 * it refuses a built-in id as well (see `removeSaved` in `main.ts`).
 */
export function renderRail(
  host: HTMLElement,
  templates: Template[],
  activeId: string | null,
  onPick: (id: string) => void,
  customIds: ReadonlySet<string> = new Set(),
  onDelete?: (id: string) => void,
  thumb: string | null = null,
): void {
  host.textContent = ''
  for (const t of templates) {
    const saved = customIds.has(t.id)

    // Every chip rides in a mount, so the × a saved one carries can be the
    // chip's *sibling* rather than nested in it: a button cannot hold another
    // button, and the chip has to stay one. The × is drawn over the chip's own
    // corner (`app.css`), but it is not inside the chip in the DOM, so the
    // mount carries no handler and neither control has to stop propagation.
    const mount = document.createElement('span')
    mount.className = 'mount'

    const b = document.createElement('button')
    b.className = 'print' + (t.id === activeId ? ' on' : '')
    if (t.premium) b.classList.add('brass')
    if (saved) b.classList.add('custom')
    b.type = 'button'
    b.title = t.name
    // The print itself. Inline rather than a class, because the image is the
    // user's and a stylesheet cannot know its URL; `--surface` behind it stays
    // the chip's colour until a photograph exists. `.photo` is what tells
    // `app.css` there is picture content under the marks.
    if (thumb) {
      b.style.backgroundImage = `url("${thumb}")`
      b.classList.add('photo')
    }
    b.setAttribute('aria-label', t.name)
    b.setAttribute('aria-pressed', t.id === activeId ? 'true' : 'false')
    b.addEventListener('click', () => onPick(t.id))
    mount.appendChild(b)

    // The × is drawn for a template the user saved and for nothing else: the
    // nine built-ins are the product's own, and a rail that could remove them
    // is a rail that could empty itself. `onDelete` is optional so the rail
    // still renders — read-only — for a caller with nothing to delete.
    if (saved && onDelete) {
      const del = document.createElement('button')
      del.className = 'del'
      del.type = 'button'
      del.textContent = '×'
      del.title = `删除模板 ${t.name}`
      del.setAttribute('aria-label', `删除模板 ${t.name}`)
      del.addEventListener('click', () => onDelete(t.id))
      mount.appendChild(del)
    }

    host.appendChild(mount)
  }
}
