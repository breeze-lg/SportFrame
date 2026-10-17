import { drawBlurredPhoto } from '../core/background'
import type { Photo, Template } from '../core/types'
import { BACKGROUND_MODES, matFillPanel, type BackgroundMode } from './controls'
import { styleThumb } from './rail'

/**
 * The bar under the poster: which of the two posters you are making, and — in
 * 无背景 — what its border is made of.
 *
 * It is here rather than in the 画面 panel because both questions are questions
 * about the *whole picture*, and the only honest way to ask them is with the
 * picture: 带背景 and 无背景 differ in size before they differ in anything else (see
 * `outputRect`), and a preview is the only control that can say so. The panel keeps
 * the numbers, which are numbers.
 *
 * Same split as everywhere else in `src/ui/`: `modeBar` is a pure view model over a
 * record and a photograph, `renderModeBar` builds the DOM once, and `syncModeBar`
 * updates it — one function per job, because the discs are *revealed* with a
 * transition when 无背景 is chosen, and an element rebuilt on every paint would
 * never animate.
 */

/** 白边's two surfaces, as the two discs that show them. */
export const MAT_FILLS: { id: 'white' | 'blur'; label: string; blur: boolean }[] = [
  { id: 'white', label: '白边', blur: false },
  { id: 'blur', label: '模糊', blur: true },
]

export type ModeThumb = {
  id: BackgroundMode
  label: string
  /** The preview, as a data URL — `styleThumb`'s, at the *delivery* size, so the two
   *  thumbs are not the same shape and not the same size. */
  url: string | null
  w: number
  h: number
  on: boolean
}

export type MatDisc = {
  id: 'white' | 'blur'
  label: string
  /** 模糊's own bitmap: the photograph, blurred, which the CSS clips into a disc. */
  url: string | null
  on: boolean
  enabled: boolean
}

export type ModeBar = {
  modes: ModeThumb[]
  discs: MatDisc[]
  /** Are the discs out? They are revealed rather than toggled, so this is the state
   *  the transition runs towards. */
  discsOut: boolean
}

/** One blurred disc bitmap per photograph, kept: a paint happens on every edit and
 *  re-rendering a blur for each of them would be work for a picture that has not
 *  changed. */
const discs = new WeakMap<Photo, string | null>()

/**
 * The photograph, blurred, as a square bitmap for 模糊's disc. 96 device pixels is
 * the disc's own box at 2×; the CSS clips it into a circle, and this deliberately
 * does *not*: a circle drawn inside a circle leaves the outer sliver of the bitmap
 * transparent, which the disc's own paper shows through as a rim where the border
 * should be. One clip, in the one place that knows the disc's shape.
 */
export function blurDisc(photo: Photo): string | null {
  const known = discs.get(photo)
  if (known !== undefined) return known
  let url: string | null = null
  try {
    const box = 96
    const c = document.createElement('canvas')
    c.width = box
    c.height = box
    const ctx = c.getContext('2d')
    if (ctx) {
      const src = photo.preview ?? photo.el
      const source = { el: src, width: photo.width, height: photo.height }
      drawBlurredPhoto(ctx, { x: 0, y: 0, w: box, h: box }, source, box * 0.12, 1.1, box * 0.5)
      url = c.toDataURL('image/png')
    }
  } catch {
    // A canvas that will not encode is a disc with no picture in it. The label under
    // it still says what it is, and the choice still works.
    url = null
  }
  discs.set(photo, url)
  return url
}

export function modeBar(t: Template, photo: Photo | null, longEdge: number): ModeBar {
  const fills = matFillPanel(t)
  return {
    modes: BACKGROUND_MODES.map((m) => {
      const thumb = styleThumb({ ...t, background: { ...t.background, mode: m.id } }, photo, longEdge)
      return { id: m.id, label: m.label, url: thumb.url, w: thumb.w, h: thumb.h, on: t.background.mode === m.id }
    }),
    discsOut: fills.shown,
    discs: MAT_FILLS.map((f) => ({
      id: f.id,
      label: f.label,
      url: f.blur && photo ? blurDisc(photo) : null,
      on: fills.blur === f.blur,
      enabled: fills.enabled,
    })),
  }
}

/** Builds the bar once per document. Everything after this is `syncModeBar`, because
 *  the discs' reveal is a CSS transition on an element that has to stay where it is. */
export function renderModeBar(
  host: HTMLElement,
  bar: ModeBar,
  on: { mode: (m: BackgroundMode) => void; fill: (blur: boolean) => void },
): void {
  if (host.dataset.built !== '1') {
    host.textContent = ''

    const modes = document.createElement('div')
    modes.className = 'mode-row'
    modes.id = 'mode-thumbs'
    modes.setAttribute('role', 'group')
    modes.setAttribute('aria-label', '背景')
    for (const m of bar.modes) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'mode-thumb'
      b.dataset.mode = m.id
      // The preview: a poster of this photograph, made this way. The box is fixed
      // and the bitmap is not, so 无背景's smaller delivery simply *is* smaller —
      // the size difference is the point of the control, and this is how it reads.
      const img = document.createElement('img')
      img.alt = ''
      b.appendChild(img)
      const label = document.createElement('span')
      label.className = 'mode-label'
      label.textContent = m.label
      b.append(label)
      b.addEventListener('click', () => on.mode(m.id))
      modes.appendChild(b)
    }
    host.appendChild(modes)

    const row = document.createElement('div')
    row.className = 'disc-row'
    row.id = 'mat-discs'
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', '白边填充')
    for (const f of MAT_FILLS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'disc'
      b.dataset.fill = f.id
      const art = document.createElement('i')
      art.className = 'disc-art'
      b.appendChild(art)
      const label = document.createElement('span')
      label.className = 'disc-label'
      label.textContent = f.label
      b.append(label)
      b.addEventListener('click', () => on.fill(f.blur))
      row.appendChild(b)
    }
    host.appendChild(row)

    host.dataset.built = '1'
  }

  syncModeBar(host, bar)
}

const discRow = (host: HTMLElement): HTMLElement | null =>
  host.querySelector<HTMLElement>('.disc-row')

export function syncModeBar(host: HTMLElement, bar: ModeBar): void {
  for (const m of bar.modes) {
    const b = host.querySelector<HTMLElement>(`#mode-thumbs .mode-thumb[data-mode="${m.id}"]`)
    if (!b) continue
    b.classList.toggle('on', m.on)
    b.setAttribute('aria-pressed', m.on ? 'true' : 'false')
    const img = b.querySelector('img')
    if (img) {
      if (m.url && img.src !== m.url) img.src = m.url
      img.hidden = !m.url
      // CSS pixels, from `styleThumb`: the bitmap is the delivery's own shape, so a
      // cropped poster is drawn smaller in the same box.
      if (m.url) {
        img.style.width = `${Math.round(m.w)}px`
        img.style.height = `${Math.round(m.h)}px`
      }
    }
  }

  const row = discRow(host)
  if (row) {
    // The one animated thing in this app. A transition needs an element that keeps
    // its identity, which is why this is a state and not a rebuild.
    row.dataset.out = bar.discsOut ? 'true' : 'false'
    row.setAttribute('aria-hidden', bar.discsOut ? 'false' : 'true')
  }
  syncMatDiscs(host, bar.discs.some((d) => d.enabled))
  for (const d of bar.discs) {
    const b = host.querySelector<HTMLElement>(`.disc[data-fill="${d.id}"]`)
    if (!b) continue
    b.classList.toggle('on', d.on)
    b.setAttribute('aria-pressed', d.on ? 'true' : 'false')
    const art = b.querySelector<HTMLElement>('.disc-art')
    if (art) art.style.backgroundImage = d.url ? `url(${d.url})` : ''
  }
}

/**
 * The discs' own live-ness, which is the one thing about the bar that depends on a
 * *slider*: 白边 at 0 has no border to fill. Called from the slider write path, since
 * raising it is a drag and nothing may be rebuilt under one.
 */
export function syncMatDiscs(host: HTMLElement, enabled: boolean): void {
  for (const b of host.querySelectorAll<HTMLButtonElement>('.disc')) b.disabled = !enabled
}
