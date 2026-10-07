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
 * Draws the configured slots onto the canvas.
 *
 * Two units meet here, and they do not agree:
 *
 * - `size` is LOGICAL — the canvas's logical box, as `resolveSize` returns it.
 * - `frame` is DEVICE pixels. `render` scales the layout box by `k` before it
 *   fits the frame into it, so what arrives here is already multiplied out.
 *   The `'mat'` branch below depends on that: it adds the photo's device-space
 *   bottom edge to a `matBottom`-derived offset, and multiplying the sum by `k`
 *   again would push the text off the canvas at `k=2` and, at the `k=1` the
 *   preview uses, leave it wherever the arithmetic happened to land.
 *
 * Everything this function derives from `size`, it scales by `k` itself.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  size: Size,
  config: TextConfig,
  values: Partial<Record<TextSlotId, string>>,
  frame: Rect,
  k: number,
  matBottom = 0,
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
    if (config.anchor === 'mat' && matBottom > 4 * k) {
      // the white band below the photo: sit 62% down it, which reads as
      // optically centred rather than mathematically centred. `frame` is
      // device pixels (see above), so `matBottom * k` is the one conversion.
      y = frame.y + frame.h + matBottom * k * 0.62
    } else if (config.anchor === 'top') y = H * 0.10 * k + (slot.id === 'sub' ? fitted * 1.15 : 0)
    else if (config.anchor === 'center') y = H * 0.50 * k
    // 'bottom', and 'mat' on a template with no bottom mat to speak of: never
    // place text into a band too thin to hold it.
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
