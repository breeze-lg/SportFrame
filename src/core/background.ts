import { cover } from './geometry'
import type { Background, Size } from './types'

type Source = { el: CanvasImageSource; width: number; height: number }

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: Size,
  bg: Background,
  photo: Source | null,
  k: number,
): void {
  const { W, H } = size

  if (!photo || bg.mode === 'none') {
    ctx.fillStyle = bg.mode === 'solid' && bg.color ? bg.color : '#2a3238'
    ctx.fillRect(0, 0, W * k, H * k)
    return
  }

  if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color ?? '#2a3238'
    ctx.fillRect(0, 0, W * k, H * k)
    return
  }

  const blur = (bg.blur ?? 0) * k
  const pad = blur * 3 + 8
  const zoom = (bg.zoom ?? 100) / 100
  const c = cover(photo.width, photo.height, W * k + pad * 2, H * k + pad * 2, zoom)
  const x = (W * k + pad * 2 - c.w) / 2 - pad
  const y = (H * k + pad * 2 - c.h) / 2 - pad

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

  const darken = bg.darken ?? 0
  if (darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darken / 100})`
    ctx.fillRect(0, 0, W * k, H * k)
  }
}
