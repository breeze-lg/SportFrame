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

const BEVEL_INSET = 5
const BEVEL_ALPHA = 0.09

export function drawMat(
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

  // the bevel: a 1px line inset from the mat edge, on the mat surface
  const inset = BEVEL_INSET * k
  ctx.save()
  ctx.strokeStyle = `rgba(28,27,24,${BEVEL_ALPHA})`
  ctx.lineWidth = 1 * k
  roundedRect(
    ctx,
    { x: mat.x + inset, y: mat.y + inset, w: mat.w - inset * 2, h: mat.h - inset * 2 },
    Math.max(0, radius * k),
  )
  ctx.stroke()
  ctx.restore()
}
