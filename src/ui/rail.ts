import { resolveSize } from '../core/geometry'
import { render } from '../core/render'
import type { Photo, Template } from '../core/types'
import { deliverySize } from './export'

/** The chip's long edge in CSS pixels — the design sheet's 62px box — and the
 *  resolution its preview is rendered at. */
const CHIP_LONG = 62
const CHIP_DPR = 2

/**
 * A style's chip: the poster that style would make of the photograph in hand,
 * rendered and scaled down.
 *
 * The rail used to draw the photograph itself, cover-cropped to the chip
 * (`chipThumb`, the design sheet's `.print .rawshot`), which left nine chips
 * differing only by the selected ring — a rack that cannot say what any of the
 * styles looks like, which is the one thing a rack of styles is for. So the
 * chip is now a *render*: `render` at the poster's own layout size, drawn into
 * a canvas a chip's long edge across.
 *
 * The scale is what makes a miniature honest. `render` takes a logical `size`
 * and a device scale `k`, and every absolute measure in it — the mat, the
 * radius, the shadow, the blur, the type — is multiplied by `k`. So one
 * `k = chip / longEdge` renders *the same poster*, smaller, with no second
 * layout path and nothing re-tuned per size. (This is the piece the README used
 * to call impossible: the frame geometry is absolute pixels, but they are
 * absolute in `k`, and a chip is a small `k`.)
 *
 * `text: {}`, deliberately: the words belong to the user and not to the style
 * (see `fields.ts`), and re-rendering ten posters on every keystroke would be
 * the cost of a claim nobody made. What a chip has to show is the mount — the
 * mat, the backdrop, the ratio.
 */
export type StyleThumb = { url: string | null; w: number; h: number }

export function styleThumb(t: Template, photo: Photo | null, longEdge: number): StyleThumb {
  // The poster's own layout, from the same two inputs `draw` uses: the ratio
  // (against the photograph, for a saved `orig` template) and the long edge.
  const size = resolveSize(t.canvas.ratio, longEdge, photo ?? undefined)
  const k = (CHIP_LONG * CHIP_DPR) / longEdge
  // ...and the *delivery*, because 无背景 crops to the mount: a preview of that
  // poster is the card, not the canvas the card was laid out on. It is also why the
  // bitmap here can be smaller than the box — the two mode thumbs are drawn into the
  // same box, and the difference between them is the difference the app makes.
  const delivery = deliverySize(size, t, photo)
  const w = Math.max(1, Math.round(delivery.W * k))
  const h = Math.max(1, Math.round(delivery.H * k))
  return {
    // A poster is a photograph framed; with no photograph there is nothing to
    // preview. The box is still this template's own shape, which is the one
    // thing a blank chip can honestly say — 电影感 is a wide strip and 竖版故事
    // is a tall one before anything has been loaded.
    url: photo ? preview(t, photo, size, k, w, h) : null,
    // CSS pixels: the bitmap is CHIP_DPR times the box it is drawn into, so it
    // is exactly 1:1 on a retina screen and a clean 2:1 reduction on a 1× one.
    w: w / CHIP_DPR,
    h: h / CHIP_DPR,
  }
}

/**
 * The previews, keyed by everything that can change one: the template's
 * geometry, the photograph, and the box. Cleared oldest-first at a cap, because
 * a session that loads photographs and moves sliders would otherwise hold a
 * bitmap for every combination it passed through.
 */
const previews = new Map<string, string | null>()
const PREVIEW_CAP = 60

function preview(
  t: Template,
  photo: Photo,
  size: { W: number; H: number },
  k: number,
  w: number,
  h: number,
): string | null {
  const key = [
    t.id,
    t.canvas.ratio,
    JSON.stringify(t.frame),
    JSON.stringify(t.background),
    photo.el.src,
    `${w}x${h}`,
  ].join('|')
  if (previews.has(key)) return previews.get(key) ?? null

  let url: string | null = null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (ctx) {
    // The chip is a heavy reduction of the poster (a 1152px canvas into ~99px),
    // so the quality of the one resample in it is the whole of its legibility.
    ctx.imageSmoothingQuality = 'high'
    render({ ctx, size, k, template: t, photos: [photo], text: {}, exif: null })
    url = c.toDataURL('image/png')
  }

  if (previews.size >= PREVIEW_CAP) {
    const oldest = previews.keys().next().value
    if (oldest !== undefined) previews.delete(oldest)
  }
  previews.set(key, url)
  return url
}

/**
 * The template rail: one chip per template, drawn as a print rather than a
 * labelled button — the wall is the interface, and the rail is the rack of
 * mounts beside it. `thumb` answers with the *style's* own preview (`styleThumb`)
 * for a given template: a small render of the poster that template makes, and
 * the box it should be drawn in. The box is the template's canvas ratio, so the
 * rack says which styles are tall, wide or square even before there is a
 * photograph to fill them. The name is carried on `title` and `aria-label`.
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
  thumb?: (t: Template) => StyleThumb | null,
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
    // The chip that is on says so in words too, because its click does something
    // else from every other chip's — see the knob below.
    b.title = t.id === activeId ? `${t.name}（已在墙上，点击打开画面）` : t.name
    // The print itself. Inline rather than a class, because the image is the
    // user's photograph rendered through this template and a stylesheet cannot
    // know its URL; `--surface` behind it stays the chip's colour until a
    // photograph exists. `.photo` is what tells `app.css` there is picture
    // content under the marks.
    const shot = thumb?.(t) ?? null
    if (shot) {
      // The box is the template's canvas ratio, in CSS pixels. Set from the
      // preview rather than from a stylesheet constant so the runner stays
      // exactly as wide as the poster it shows.
      b.style.width = `${shot.w}px`
      b.style.height = `${shot.h}px`
      if (shot.url) {
        b.style.backgroundImage = `url("${shot.url}")`
        b.classList.add('photo')
      }
    }
    b.setAttribute('aria-label', t.name)
    b.setAttribute('aria-pressed', t.id === activeId ? 'true' : 'false')
    b.addEventListener('click', () => onPick(t.id))

    // The knob: the mark in the middle of the chip that is on.
    //
    // The reference editor draws a settings button there, and the gesture is
    // real here as well — picking the mount you are already on opens 画面, which
    // is where its numbers are. What it is *not* is a button: a control inside
    // the chip would be a button in a button, so the chip's own click is the
    // control and this is its mark. `aria-hidden`, because the chip has already
    // said everything about itself to assistive tech.
    if (t.id === activeId) {
      const knob = document.createElement('span')
      knob.className = 'knob'
      knob.setAttribute('aria-hidden', 'true')
      b.appendChild(knob)
    }

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
