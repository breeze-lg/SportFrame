import type { Rect, Size, TextConfig, TextSlot, TextSlotId } from './types'

// Chinese text renders from the system stack and never gets a webfont:
// shipping a CJK webfont costs megabytes. Do not add one.
const CJK_FAMILY = '-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif'

/** Line advance between two baselines, as a multiple of the taller of the two
 *  lines it separates — the same half-leading idea CSS line boxes use. */
const LINE = 1.15

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

type Line = { slot: TextSlot; raw: string; fitted: number }

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
 *
 * Slots STACK. The anchor names where the block sits and every line after the
 * first is advanced from the one before it by the taller of the two lines'
 * sizes, so two slots can no more collide than two lines of a paragraph can.
 * Which end of the block the anchor names depends on the anchor, and each is
 * the end that reads correctly on a poster:
 *
 *   `top`     the first line starts at the top margin; the block hangs down
 *   `mat`     the block starts 62% into the white band beneath the photo
 *   `center`  the block is centred on the canvas, by its own extent
 *   `bottom`  the LAST line ends at the bottom margin; the block grows up
 *
 * `bottom` growing *upward* is what keeps a title and a subtitle off the same
 * baseline — the pair 经典 declares. Anchoring the block's first line at the
 * margin instead would draw both of them there, because nothing else in this
 * function separates two lines.
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

  // Every slot carrying a value, measured before anything is drawn: where the
  // block goes depends on the sizes inside it, because `center` and `bottom`
  // place the block by its extent rather than by its first line.
  const lines: Line[] = []
  const seen = new Set<TextSlotId>()
  for (const slot of config.slots) {
    const raw = values[slot.id]
    // Nothing forbids a repeated id in a slot list, and a repeat is one line —
    // not the same words printed twice, over each other.
    if (!raw || seen.has(slot.id)) continue
    seen.add(slot.id)
    const base = (slot.size / 100) * H * 0.20 * k
    lines.push({
      slot,
      raw,
      fitted: measureToFit(ctx, raw, maxW, (s) => frameFont(s, slot.weight), base),
    })
  }
  if (lines.length === 0) return

  // Each line's baseline as an offset from the block's first. A step is the
  // advance of the *taller* of the two lines it separates, because that is what
  // a line box does: the gap has to clear the taller neighbour's ascent, not
  // just the previous line's. Advancing by the previous line alone is right for
  // a big line above a small one and wrong the other way round — 经典 declares
  // its 14px subtitle above its 34px title, and a 14px advance there drew the
  // title straight through the subtitle it was supposed to sit under.
  let span = 0
  const offsets = lines.map((line, i) => {
    if (i > 0) span += Math.max(lines[i - 1]!.fitted, line.fitted) * LINE
    return span
  })

  let y0: number
  if (config.anchor === 'mat' && matBottom > 4 * k) {
    // the white band below the photo: the block starts 62% down it, which
    // reads as optically centred rather than mathematically centred. `frame` is
    // device pixels (see above), so `matBottom * k` is the one conversion.
    y0 = frame.y + frame.h + matBottom * k * 0.62
  } else if (config.anchor === 'top') {
    y0 = H * 0.10 * k
  } else if (config.anchor === 'center') {
    y0 = H * 0.50 * k - span / 2
  } else {
    // 'bottom', and 'mat' on a template with no bottom mat to speak of: never
    // place text into a band too thin to hold it.
    y0 = H * 0.90 * k - span
  }

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  lines.forEach(({ slot, raw, fitted }, i) => {
    const y = y0 + offsets[i]!
    ctx.font = frameFont(fitted, slot.weight)
    if (slot.stroke) {
      ctx.lineWidth = fitted * 0.14
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(raw, W * 0.5 * k, y)
    }
    ctx.fillStyle = slot.color
    ctx.fillText(raw, W * 0.5 * k, y)
  })

  ctx.restore()
}
