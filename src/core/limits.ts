import { fitRect } from './geometry'
import type { Rect, Size } from './types'

/**
 * The arithmetic behind the 画面 controls: how large a photograph may be, how
 * deep a mat may go, and how far off centre the mount may sit, before it stops
 * lying inside the canvas it is drawn on.
 *
 * These are closed forms rather than a check on the drawn rect, because the
 * controls need them *before* anything is drawn: a slider's `max` is the
 * largest value that still fits, and that has to be computable without laying
 * out a poster. `tests/unit/limits.test.ts` is what keeps the closed forms
 * honest — it sweeps them against the same `fitRect`/`matRect` the renderer
 * uses, at both export scales.
 *
 * The layout they describe, from `render`:
 *
 *   frame = fitRect(box, aspect, scale, ox, oy)   the photograph's box
 *   mat   = matRect(frame, mat, matBottom, k)     the card under it, grown by
 *                                                 `mat` on three sides and by
 *                                                 `mat + matBottom` below
 *
 * `fitRect` centres the frame and clamps it to `scale` percent of the box on
 * both axes — it never returns a larger frame — so for every photo aspect:
 *
 *   frame.w ≤ W·scale/100     and     frame.h ≤ H·scale/100
 *
 * For the card to sit inside the canvas, `matRect`'s four edges then need:
 *
 *   frame.w + 2·mat             ≤ W      left and right walls
 *   frame.h + 2·mat             ≤ H      the top
 *   frame.h + 2·(mat+matBottom) ≤ H      the bottom
 *
 * Substituting the worst-case frame turns those into the constraints every
 * function here is derived from:
 *
 *   scale ≤ 100·(1 − 2·mat/W)
 *   scale ≤ 100·(1 − 2·(mat+matBottom)/H)
 *
 * The top's own constraint, `scale ≤ 100·(1 − 2·mat/H)`, is implied by the
 * bottom one whenever `matBottom ≥ 0`, so it is never restated.
 */

/** How far `fitRect` shifts the frame at offset ±100, as a fraction of the box.
 *  Read off `fitRect` rather than chosen here: the offset bounds below are only
 *  correct for the shift the layout actually applies. */
const SHIFT = 0.35

/** Float arithmetic, not a slack budget — the real margins in the built-in set
 *  run from 8.8px up, so this absorbs the last bit of a double and nothing
 *  else. */
const EPS = 1e-9

export type FrameGeometry = { scale: number; mat: number; matBottom: number }
export type Bounds = { min: number; max: number }
export type OffsetBounds = { x: Bounds; y: Bounds }

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * The largest `scale` at which this mat still fits this canvas — the ceiling
 * the 前景大小 slider stops at.
 */
export function scaleCeiling(size: Size, mat: number, matBottom: number): number {
  const m = Math.max(0, mat)
  const mb = Math.max(0, matBottom)
  const across = 100 * (1 - (2 * m) / size.W)
  const down = 100 * (1 - (2 * (m + mb)) / size.H)
  return Math.max(0, Math.min(across, down))
}

/**
 * The deepest mat the two side walls and the top leave room for at this scale.
 * The card is grown on both axes, so the tighter of the two speaks.
 */
export function matCeiling(size: Size, scale: number): number {
  return (Math.min(size.W, size.H) * (1 - scale / 100)) / 2
}

/**
 * The deepest `mat + matBottom` the bottom edge leaves room for at this scale.
 * Only the bottom grows by `matBottom`, so only `H` speaks here — this is the
 * constraint `TEMPLATES` states in prose for 样张, as a number.
 */
export function matSumCeiling(size: Size, scale: number): number {
  return (size.H * (1 - scale / 100)) / 2
}

/**
 * The offsets at which the *whole card* — mat included, `matBottom` and all —
 * still lies inside the canvas.
 *
 * `fitRect` moves the frame's centre by `offset/100 · SHIFT · box`, so the
 * frame's left edge sits at `W/2 + s·W − w/2` for `s = offset/100·SHIFT`;
 * holding that at `≥ mat`, and the right edge at `≤ W − mat`, gives the pair
 * below. The vertical pair is not symmetric: the card is deeper at the bottom
 * by `matBottom`, so the frame has to sit higher, and `y.max` is `matBottom`'s
 * worth of shift below `y.min`'s height.
 *
 * `rect` is the frame at offset zero — the layout's own centre — which is what
 * makes these bounds independent of the offset they are clamping.
 */
export function offsetBounds(
  size: Size,
  rect: Rect,
  mat: number,
  matBottom: number,
): OffsetBounds {
  const m = Math.max(0, mat)
  const mb = Math.max(0, matBottom)
  const xMax = (100 * (size.W / 2 - rect.w / 2 - m)) / (SHIFT * size.W)
  const yHigh = (100 * (size.H / 2 - rect.h / 2 - m - mb)) / (SHIFT * size.H)
  const yLow = -yHigh - (100 * mb) / (SHIFT * size.H)
  return {
    // Never inverted: a frame that fills its box has no room to move, and the
    // honest answer there is a range at zero rather than a negative one.
    x: { min: Math.min(-xMax, 0), max: Math.max(xMax, 0) },
    y: { min: Math.min(yLow, 0), max: Math.max(yHigh, 0) },
  }
}

/**
 * Does this geometry satisfy the constraints? The closed-form predicate, for a
 * caller that has the numbers but no laid-out rect.
 */
export function frameFits(size: Size, g: FrameGeometry): boolean {
  return (
    g.mat <= matCeiling(size, g.scale) + EPS &&
    g.mat + g.matBottom <= matSumCeiling(size, g.scale) + EPS
  )
}

/**
 * Nudges a geometry into the region where its mat fits, by lowering `scale` —
 * and only `scale`.
 *
 * Lowering the photograph is the one correction that cannot make a poster
 * worse. The alternative, cutting the mat down, silently overrides a number the
 * author chose, and a template whose mat is too deep is a template whose
 * *photograph* is too big. The ceiling rises monotonically as the scale falls,
 * so one pass is exact.
 *
 * Returning the geometry it was handed when nothing needs to change is
 * load-bearing, not an optimisation: `settleTemplate` and `setControl` compare
 * by reference to tell "the user moved something" from "the app re-derived the
 * same record", and the 已调整 marker rides on that answer.
 */
export function settleFrame(size: Size, g: FrameGeometry): FrameGeometry {
  const cap = scaleCeiling(size, g.mat, g.matBottom)
  if (g.scale <= cap) return g
  return { ...g, scale: cap }
}

/** The frame `fitRect` lays out for a frame of this scale, at the layout's own
 *  centre — the rect `offsetBounds` measures from. */
export function frameRect(size: Size, aspect: number, scale: number): Rect {
  return fitRect(size, aspect, scale, 0, 0)
}
