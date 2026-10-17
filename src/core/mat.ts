import { drawBlurredPhoto, type PhotoSource } from './background'
import type { Rect } from './types'

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.beginPath()
  ctx.moveTo(r.x + rad, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad)
  ctx.closePath()
}

const BEVEL_ALPHA = 0.09

/** The mat's own surface: the white card. Split out so a blurred 白边 can wear the
 *  same card over a different surface — the card's edge is a card's edge either
 *  way. The card carries no line of its own: a mat's bevel is cut at the *window*
 *  (see `drawBevel`), and a hairline 5px inside the card's edge is a frame drawn on
 *  paper that has no frame — invisible on the three sides the photograph covers,
 *  and a very legible one in the bottom band. */
function matSurface(
  ctx: CanvasRenderingContext2D,
  mat: Rect,
  radius: number,
  shadow: number,
  k: number,
): void {
  ctx.save()
  if (shadow > 0) {
    const sh = shadow / 100
    ctx.shadowColor = `rgba(0,0,0,${(0.75 * sh).toFixed(3)})`
    ctx.shadowBlur = 60 * k * sh
    ctx.shadowOffsetY = 16 * k * sh
  }
  ctx.fillStyle = '#FFFFFF'
  roundedRect(ctx, mat, Math.max(0, radius * k))
  ctx.fill()
  ctx.restore()
}

/**
 * The mat's bevel, and the only line a mount has: one hairline round the *window*,
 * where the paper is actually cut.
 *
 * Drawn on the frame's own boundary at half a pixel, so half the stroke falls on the
 * paper and half under the photograph — which is drawn next and covers it. What is
 * left is the cut, on the paper, at the picture's edge. It is offered only where
 * there is a mount (three sides or the band), because a poster with no mat has no
 * window to cut.
 */
export function drawBevel(ctx: CanvasRenderingContext2D, frame: Rect, radius: number, k: number): void {
  ctx.save()
  ctx.strokeStyle = `rgba(28,27,24,${BEVEL_ALPHA})`
  ctx.lineWidth = 1 * k
  roundedRect(ctx, frame, Math.max(0, radius * k))
  ctx.stroke()
  ctx.restore()
}

export function drawMat(
  ctx: CanvasRenderingContext2D,
  mat: Rect,
  radius: number,
  shadow: number,
  k: number,
): void {
  matSurface(ctx, mat, radius, shadow, k)
}

/**
 * 白边, filled with the photograph instead of white: the picture, blurred, bleeding
 * off its own edge.
 *
 * The card is the *whole* rect the photograph is cropped into, so the border shows
 * the part of the picture just outside the frame — which is what makes it read as
 * the same photograph running past its edge rather than as a frame with a colour in
 * it. The blur scales with the border's own width (`blurWidth`), because a 16px
 * border and a 100px border want different amounts of softness and the number the
 * user has is the width.
 *
 * Clipped *and* padded: the clip keeps the card's rounded shape, and the padding
 * keeps the blur sampling the photograph rather than the void outside the bitmap.
 * A blur pulls colour in from beyond the rect it is given, so a card-sized bitmap
 * blurred by a border-sized amount has its outer edge fading into *transparency* —
 * which composites with the white fill underneath and leaves a pale rim where the
 * border should be. The backdrop in `drawBackground` pads for the same reason.
 */
export function drawBlurredMat(
  ctx: CanvasRenderingContext2D,
  mat: Rect,
  radius: number,
  shadow: number,
  photo: PhotoSource,
  blur: number,
  k: number,
): void {
  // the card's own drop shadow first, so it falls *under* the blurred surface
  ctx.save()
  if (shadow > 0) {
    const sh = shadow / 100
    ctx.shadowColor = `rgba(0,0,0,${(0.75 * sh).toFixed(3)})`
    ctx.shadowBlur = 60 * k * sh
    ctx.shadowOffsetY = 16 * k * sh
  }
  ctx.fillStyle = '#FFFFFF'
  roundedRect(ctx, mat, Math.max(0, radius * k))
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundedRect(ctx, mat, Math.max(0, radius * k))
  ctx.clip()
  drawBlurredPhoto(ctx, mat, photo, blur, 1, blur * 3 + 8)
  ctx.restore()
}

/** How much blur a blurred 白边 gets, from the border it is filling.
 *
 *  0.8× the widest side, so a 16px mat gets a light blur (the picture, softened)
 *  and a 104px bottom band a heavy one (a colour the picture is made of) — the
 *  border's own width is the only number the record has, and it is the right one:
 *  the wider the border, the more the blur has to hide. 12 is a floor, because below
 *  it a blur is not a blur at all. */
export function blurWidth(mat: number, matBottom: number, k: number): number {
  return Math.max(12, Math.max(mat, matBottom) * 0.8) * k
}
