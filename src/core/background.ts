import { cover, mountRect } from './geometry'
import type { Background, Rect, Size, Template } from './types'

type Source = { el: CanvasImageSource; width: number; height: number }

/** A photograph to draw from, in the shape `drawBackground` and `drawBlurredMat`
 *  both take. Exported for `mat.ts`, which fills a mat with the same blur. */
export type PhotoSource = Source

/**
 * The photograph, cover-cropped and blurred, filling `rect` — the one place the
 * blur is performed.
 *
 * 带背景 uses it for the whole canvas, with `pad`: a blur pulls colour in from
 * outside the crop it is given, so the backdrop is drawn larger than the canvas and
 * left to hang over. A blurred 白边 uses it for the card, with no pad and a clip
 * instead, because what is outside the card is not drawn at all.
 */
export function drawBlurredPhoto(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  photo: Source,
  blur: number,
  zoom: number,
  pad: number,
): void {
  const w = rect.w + pad * 2
  const h = rect.h + pad * 2
  const c = cover(photo.width, photo.height, w, h, zoom)
  const x = rect.x + (w - c.w) / 2 - pad
  const y = rect.y + (h - c.h) / 2 - pad

  ctx.save()
  if (typeof ctx.filter !== 'undefined') {
    ctx.filter = `blur(${blur}px)`
    ctx.drawImage(photo.el, x, y, c.w, c.h)
  } else {
    // Engines without ctx.filter (older Safari): blur by upscaling a
    // downscaled copy through the smoothing filter.
    const div = Math.max(4, blur / 2)
    const tw = Math.max(8, Math.round(c.w / div))
    const th = Math.max(8, Math.round(c.h / div))
    const tmp = document.createElement('canvas')
    tmp.width = tw
    tmp.height = th
    const tc = tmp.getContext('2d')
    if (tc) {
      tc.drawImage(photo.el, 0, 0, tw, th)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(tmp, x, y, c.w, c.h)
    }
  }
  ctx.restore()
}

/**
 * The rectangle a poster is *delivered* as.
 *
 * For 带背景 this is the whole canvas: the poster is the paper, and the file is the
 * paper. 无背景 (`mount`) is the exception, and it is the whole point of the mode — a
 * 1000×1000 poster whose photograph and border measure 800×800 is delivered at
 * 800×800, because the paper around the mount is not part of the picture, so it is
 * not part of the file.
 *
 * One function, deliberately. The screen canvas, the export, the area budget in
 * `export.ts` and the size printed under the poster all ask this, and they have to
 * agree: a preview that showed a card while the file carried a field around it
 * would be the app lying about what it is about to write.
 */
export function outputRect(size: Size, template: Template, aspect: number): Rect {
  // `aspect <= 0` is "there is no photograph" — `main.ts` and `export.ts` pass 0
  // when the list is empty. There is no mount to measure and `render` draws none, so
  // the canvas is the answer rather than a zero-width crop.
  if (template.background.mode !== 'mount' || !(aspect > 0)) {
    return { x: 0, y: 0, w: size.W, h: size.H }
  }
  return mountRect(size, aspect, template.frame)
}
/**
 * Where the window sits inside the canvas, as a translation. Zero for every mode
 * but 无背景, where the canvas has been moved onto the mount: the layout is still
 * measured in the template's own canvas, and the delivery is that canvas seen
 * through a window positioned over the card.
 */
export function outputOrigin(size: Size, template: Template, aspect: number): { x: number; y: number } {
  const r = outputRect(size, template, aspect)
  return { x: -r.x, y: -r.y }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: Size,
  bg: Background,
  photo: Source | null,
  k: number,
): void {
  const { W, H } = size

  // Nothing to draw from. The wall is the app's own empty slate — or the sheet a
  // record carries, so a white card with no photograph on it is already a white
  // card.
  if (!photo) {
    ctx.fillStyle = bg.color ?? '#2a3238'
    ctx.fillRect(0, 0, W * k, H * k)
    return
  }

  // 无背景 — nothing behind the photograph: the card, on transparency wherever the
  // card does not reach. A record with a `color` gets that sheet instead (样张,
  // whose plate is printed on it), which shows only in a rounded card's corners.
  //
  // The clear is load-bearing. 带背景 paints the whole canvas, so `render` never has
  // to clear it — without this, a re-draw would leave the *previous* backdrop
  // underneath a record that has no background at all, and the export would carry
  // one the poster does not have.
  if (bg.mode === 'mount') {
    if (bg.color) {
      ctx.fillStyle = bg.color
      ctx.fillRect(0, 0, W * k, H * k)
    } else {
      ctx.clearRect(0, 0, W * k, H * k)
    }
    return
  }

  const zoom = (bg.zoom ?? 100) / 100
  const darken = bg.darken ?? 0

  // 带背景 — the photograph as its own backdrop, over the whole canvas.
  const blur = (bg.blur ?? 0) * k
  ctx.save()
  drawBlurredPhoto(ctx, { x: 0, y: 0, w: W * k, h: H * k }, photo, blur, zoom, blur * 3 + 8)
  ctx.restore()

  if (darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darken / 100})`
    ctx.fillRect(0, 0, W * k, H * k)
  }
}
