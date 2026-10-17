import { drawBackground, outputOrigin } from './background'
import { aspectOf, cover, fitRect, matRect } from './geometry'
import { drawMat, drawBlurredMat, drawBevel, blurWidth, roundedRect } from './mat'
import { drawPlate } from './plate'
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

  // The aspect the mount is laid out with. `aspectOf` reads the photograph only
  // for the `orig` ratio; with no photograph there is no mount and no crop, so the
  // 0 is never read.
  const aspect = photo ? aspectOf(template.canvas.ratio, photo) : 0

  // 无照片 is delivered as the mount's own box: the same layout — `size` is never
  // touched, so every measurement below still happens against the template's
  // canvas — seen through a window that has been translated onto the card. The
  // translation is the whole of the crop: the caller sizes the canvas to
  // `outputRect`, and both come from one function, so a preview cannot show a card
  // while the file carries a field around it.
  if (photo) {
    const origin = outputOrigin(size, template, aspect)
    ctx.translate(origin.x * k, origin.y * k)
  }

  drawBackground(ctx, size, template.background, backgroundSource, k)

  // The spine draws in device pixels: `size` is logical and `k` is the scale
  // of the canvas being drawn into, so the layout box is scaled once here.
  // The sibling modules scale only their own absolute measures (blur, radius,
  // inset, mat) by the `k` they are handed.
  const box = { W: size.W * k, H: size.H * k }
  let frame: Rect | null = null

  if (photo) {
    // The offsets are the 画面 panel's 水平位置/垂直位置. They were always
    // `fitRect`'s parameters and never anything else's business — the renderer
    // passed 0,0 and nobody could move a photograph off centre. They stay
    // optional in the record (see `Frame`) so a template saved before the panel
    // existed still loads and still means what it drew.
    frame = fitRect(
      box,
      aspect,
      template.frame.scale,
      template.frame.ox ?? 0,
      template.frame.oy ?? 0,
    )

    const mat = matRect(frame, template.frame.mat, template.frame.matBottom, k)
    // The card *is* the mount's rect — no inset. It used to be pulled in 1px on every
    // side, which is invisible wherever the mat is there to hide it and visible
    // exactly where it is not: with 白边 at 20 and 下白边 at 104, the bottom band came
    // out a pixel narrower than the photograph on both sides, and a pixel high.
    const card = mat
    // logical units — `drawMat` multiplies the radius by k itself
    const cardRadius = Math.max(0, template.frame.radius + template.frame.mat)
    if (template.frame.matBlur && backgroundSource) {
      // 白边 in the photograph rather than in white: the border is the picture
      // itself, blurred, bleeding past its own edge. `blurWidth` scales with the
      // border, because the number the record carries is its width.
      drawBlurredMat(
        ctx,
        card,
        cardRadius,
        template.frame.shadow,
        backgroundSource,
        blurWidth(template.frame.mat, template.frame.matBottom, k),
        k,
      )
    } else {
      drawMat(ctx, card, cardRadius, template.frame.shadow, k)
    }

    // The bevel: the window's cut, on the frame's own boundary, drawn after the card
    // and before the photograph — so the picture covers the inner half of the stroke
    // and only the cut shows on the paper. Only where there is a mount: a poster with
    // no mat at all has no window to cut, and a line round the picture would be a
    // frame nothing asked for.
    if (template.frame.mat + template.frame.matBottom > 0) {
      drawBevel(ctx, frame, template.frame.radius, k)
    }

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
    // `size` is logical and `frame` is already in device pixels, as for the mat;
    // `matBottom` is logical like `size`, which is why `drawText` scales it.
    drawText(ctx, size, template.text, text, frame, k, template.frame.matBottom)
  }

  if (template.plate && frame) {
    // The band is the mat's bottom strip: the same `matRect` the mat was drawn
    // from, cut at the photo's bottom edge, so the plate can never be laid out
    // over the photograph or past the mat. Device pixels, as for everything
    // derived from `frame`.
    const mat = matRect(frame, template.frame.mat, template.frame.matBottom, k)
    const bandTop = frame.y + frame.h + template.frame.mat * k
    const band = {
      // `mat` spans `frame.x - mat*k` to `frame.x + frame.w + mat*k`, so the
      // bottom strip inset by its own side walls starts at `frame.x` — the
      // frame's own left edge, which is the canvas centre line either side of
      // it. `frame.x + mat * k` would slide the plate one full mat to the
      // right: 86px off centre for 样张 at k=1, 172px at k=2.
      x: frame.x,
      y: bandTop,
      w: frame.w,
      h: Math.max(1, mat.y + mat.h - bandTop),
    }
    drawPlate(ctx, template.plate, exif, band, k)
  }

  ctx.restore()
}
