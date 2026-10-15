import { SYSTEM_STACK, stackOf } from './fonts'
import type { Rect, Size, TextConfig, TextSlot, TextSlotId } from './types'

/** Line advance between two baselines, as a multiple of the taller of the two
 *  lines it separates — the same half-leading idea CSS line boxes use. */
const LINE = 1.15

/** How much of the canvas's width a line may occupy — the fit rule
 *  `drawText` honours, and the reason the panel's horizontal ceiling is
 *  `50·(1 − FIT)`: a block can never be wider than this share of the canvas, so
 *  it can never be shifted sideways by more than the rest. Shared with
 *  `src/core/limits.ts` rather than repeated, because a ceiling derived from a
 *  different number than the renderer uses is a ceiling that lies. */
export const TEXT_FIT = 0.86

/** A line's size in logical pixels, from the record's own units: `size` is a
 *  percentage, so 34 is 34% of a fifth of the canvas's height. The one place
 *  that conversion happens, shared with the ceilings in `limits.ts`. */
export function baseSize(size: number, H: number): number {
  return (size / 100) * H * 0.2
}

export function frameFont(size: number, weight: number, family?: string): string {
  return `${weight} ${size}px ${family === undefined ? SYSTEM_STACK : stackOf(family)}`
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

/** How much of a line's size sits above its baseline, and below it. Estimates
 *  rather than metrics — the ceilings that use them are promises that something
 *  fits, and where a promise is approximate the useful error is the one that
 *  leaves a margin. Shared with `src/core/limits.ts`, which derives every 文字
 *  bound from the same two numbers the box below is measured with. */
export const TEXT_ASCENT = 0.9
export const TEXT_DESCENT = 0.3

/** The first and last line's sizes in logical pixels, in draw order, for a block
 *  declared as `config` declares it. */
function lineBases(config: TextConfig, H: number, k: number): number[] {
  const seen = new Set<TextSlotId>()
  const bases: number[] = []
  for (const slot of config.slots) {
    if (seen.has(slot.id)) continue
    seen.add(slot.id)
    bases.push(baseSize(slot.size, H) * k)
  }
  return bases
}

/**
 * The block's height in logical pixels, from the slots as DECLARED rather than
 * as drawn, and from their unfitted sizes.
 *
 * That is a deliberate upper bound, and it is what the 文字 panel's sliders are
 * measured against: a ceiling computed from the words currently typed would move
 * every time a character was added — a slider whose `max` changes under the
 * pointer is a slider nobody can drag. So the panel promises "this fits, whatever
 * you type", and `measureToFit` inside `drawText` is left to honour it by
 * shrinking a long line.
 */
export function textSpan(config: TextConfig, size: Size, k: number): number {
  const bases = lineBases(config, size.H, k)
  let span = 0
  for (let i = 1; i < bases.length; i++) span += Math.max(bases[i - 1]!, bases[i]!) * LINE
  return span
}

/**
 * The block's box, top to bottom: the first line's ascent, the baselines, and the
 * last line's descent.
 *
 * `textSpan` alone is zero for a single line, and a single line half the height
 * of the canvas on a 150px band is exactly the case the ceilings exist for — so
 * the room a block has is measured against this and not against the span.
 */
export function textBoxHeight(config: TextConfig, size: Size, k: number): number {
  const bases = lineBases(config, size.H, k)
  if (bases.length === 0) return 0
  return (bases[0] ?? 0) * TEXT_ASCENT + textSpan(config, size, k) + (bases[bases.length - 1] ?? 0) * TEXT_DESCENT
}

/**
 * Where the block's first baseline sits, before `dx`/`dy` — the anchor's own
 * arithmetic, in the one place the renderer and the panel's ceilings can both
 * read it.
 *
 * `frame` and `matBottom`-derived distances are DEVICE pixels, `size` is
 * logical, and `k` bridges them — the two units `drawText` documents at length.
 */
export function blockTop(
  config: TextConfig,
  size: Size,
  span: number,
  frame: Rect,
  k: number,
  matBottom = 0,
): number {
  const { H } = size
  if (config.anchor === 'mat' && matBottom > 4 * k) {
    // the white band below the photo: the block starts 62% down it, which
    // reads as optically centred rather than mathematically centred.
    return frame.y + frame.h + matBottom * k * 0.62
  }
  if (config.anchor === 'top') return H * 0.10 * k
  if (config.anchor === 'center') return H * 0.50 * k - span / 2
  // 'bottom', and 'mat' on a template with no bottom mat to speak of: never
  // place text into a band too thin to hold it.
  return H * 0.90 * k - span
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
    const base = baseSize(slot.size, H) * k
    lines.push({
      slot,
      raw,
      fitted: measureToFit(ctx, raw, maxW, (s) => frameFont(s, slot.weight, slot.family), base),
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

  // The anchor places the block and `dx`/`dy` move it from there, as a share of
  // the canvas — the two halves of "where the words go", and the reason the panel
  // offers an anchor *and* a nudge rather than eight presets.
  const y0 = blockTop(config, size, span, frame, k, matBottom) + ((config.dy ?? 0) / 100) * H * k
  const cx = W * 0.5 * k + ((config.dx ?? 0) / 100) * W * k

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  lines.forEach(({ slot, raw, fitted }, i) => {
    const y = y0 + offsets[i]!
    ctx.font = frameFont(fitted, slot.weight, slot.family)
    if (slot.stroke) {
      ctx.lineWidth = fitted * 0.14
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(raw, cx, y)
    }
    ctx.fillStyle = slot.color
    ctx.fillText(raw, cx, y)
  })

  ctx.restore()
}
