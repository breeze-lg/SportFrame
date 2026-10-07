import type { Rect, Size, TextConfig, TextSlotId } from './types'

// Chinese text renders from the system stack and never gets a webfont:
// shipping a CJK webfont costs megabytes. Do not add one.
const CJK_FAMILY = '-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif'

export function frameFont(size: number, weight: number): string {
  return `${weight} ${size}px ${CJK_FAMILY}`
}

/**
 * Returns the largest size <= `size` at which `text` measures within
 * `maxWidth`. Measures with the very font it returns a size for, so the
 * caller can render at the returned size and get the width promised here.
 * `maxWidth` is the width to honour — not a value read from the canvas.
 */
export function measureToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: (size: number) => string,
  size: number,
): number {
  ctx.font = font(size)
  const w = ctx.measureText(text).width
  if (w <= maxWidth || w === 0) return size
  return size * (maxWidth / w)
}

/**
 * `frame` is the photo rect. It is unused until Task 12, which adds the
 * `'mat'` anchor and a `matBottom` parameter; the signature is already in
 * place so Task 12 changes the body only.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  size: Size,
  config: TextConfig,
  values: Partial<Record<TextSlotId, string>>,
  frame: Rect,
  k: number,
): void {
  const { W, H } = size
  const maxW = W * 0.86 * k

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  for (const slot of config.slots) {
    const raw = values[slot.id]
    if (!raw) continue

    const base = (slot.size / 100) * H * 0.20 * k
    const fitted = measureToFit(ctx, raw, maxW, (s) => frameFont(s, slot.weight), base)
    ctx.font = frameFont(fitted, slot.weight)

    let y: number
    if (config.anchor === 'top') y = H * 0.10 * k + (slot.id === 'sub' ? fitted * 1.15 : 0)
    else if (config.anchor === 'center') y = H * 0.50 * k
    // 'bottom' and, for now, 'mat' — the 'mat' anchor (text in the band
    // below the photo) needs the bottom-mat geometry and lands in Task 12.
    else y = H * 0.90 * k

    if (slot.stroke) {
      ctx.lineWidth = fitted * 0.14
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(raw, W * 0.5 * k, y)
    }
    ctx.fillStyle = slot.color
    ctx.fillText(raw, W * 0.5 * k, y)
  }

  ctx.restore()
}
