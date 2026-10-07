import { drawBackground } from './background'
import { aspectOf, cover, fitRect, matRect } from './geometry'
import { drawMat, roundedRect } from './mat'
import { drawText } from './text'
import type { RenderInput, Rect } from './types'

const PHOTO_OVERDRAW = 1

export function render(input: RenderInput): void {
  const { ctx, size, k, template, photos, text, exif } = input
  const photo = photos[0] ?? null

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const backgroundSource = photo
    ? { el: photo.preview ?? photo.el, width: photo.width, height: photo.height }
    : null
  drawBackground(ctx, size, template.background, backgroundSource, k)

  // The spine draws in device pixels: `size` is logical and `k` is the scale
  // of the canvas being drawn into, so the layout box is scaled once here.
  // The sibling modules scale only their own absolute measures (blur, radius,
  // inset, mat) by the `k` they are handed.
  const box = { W: size.W * k, H: size.H * k }
  let frame: Rect | null = null

  if (photo) {
    const aspect = aspectOf(template.canvas.ratio, photo)
    frame = fitRect(box, aspect, template.frame.scale, 0, 0)

    const mat = matRect(frame, template.frame.mat, template.frame.matBottom, k)
    const inset = 1 * k
    drawMat(
      ctx,
      {
        x: mat.x + inset,
        y: mat.y + inset,
        w: Math.max(1, mat.w - inset * 2),
        h: Math.max(1, mat.h - inset * 2),
      },
      // logical units — `drawMat` multiplies the radius by k itself — and the
      // 1 is the same 1px inset above, before that scaling
      Math.max(0, template.frame.radius + template.frame.mat - 1),
      template.frame.shadow,
      k,
    )

    // photo, clipped to its rounded rect and drawn 1px oversized so the clip
    // can never reveal a seam. `preview` is the downscale for on-screen
    // rendering; export passes photos without one, so `el` is used there.
    const src = photo.preview ?? photo.el
    ctx.save()
    roundedRect(ctx, frame, template.frame.radius * k)
    ctx.clip()
    const g = PHOTO_OVERDRAW * k
    const c = cover(photo.width, photo.height, frame.w + g * 2, frame.h + g * 2, 1)
    ctx.drawImage(
      src,
      frame.x - g + (frame.w + g * 2 - c.w) / 2,
      frame.y - g + (frame.h + g * 2 - c.h) / 2,
      c.w,
      c.h,
    )
    ctx.restore()
  }

  if (template.text && frame) {
    // `size` is logical and `frame` is already in device pixels, as for the mat
    drawText(ctx, size, template.text, text, frame, k)
  }

  void exif // the plate arrives in Task 16

  ctx.restore()
}
