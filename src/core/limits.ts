import { fitRect } from './geometry'
import { TEXT_FIT, TEXT_ASCENT, TEXT_DESCENT, baseSize, blockTop, textBoxHeight, textSpan } from './text'
import type { Rect, Size, TextAnchor, TextConfig } from './types'

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

/* -------------------------------------------------------------------------- */
/* 文字 — the type block's own ceilings                                        */
/* -------------------------------------------------------------------------- */

/**
 * The block's type, measured against the poster it is drawn on.
 *
 * Two independent ceilings and one rule between them, all closed forms over the
 * same `blockTop`/`textSpan` the renderer uses — the reason `text.ts` exports
 * those two rather than keeping them private:
 *
 *   `size`   every line may grow until the block, scaled uniformly, would fill
 *            the room its anchor leaves it. Uniform on purpose: a ceiling that
 *            solved each slot against the others would move whenever a
 *            *different* slider moved, and a slider whose maximum depends on
 *            another slider is a slider nobody can plan with.
 *   `dx/dy`  the block may move until its box touches a canvas edge. `dx` is
 *            the tighter of the two by a wide margin — a line may occupy 86% of
 *            the canvas, so there is only 7% of slack either side — and that is
 *            the honest answer: a poster with the words halfway off it is not a
 *            poster.
 *
 * The box is measured conservatively (0.9 of the first line's size above the
 * first baseline, 0.3 of the last line's below the last) rather than exactly.
 * Where a ceiling is a promise that something fits, the useful error is the one
 * that leaves a margin.
 */

/** The room an anchor leaves the block, in logical pixels. */
export function textRoom(
  size: Size,
  anchor: TextAnchor,
  frame: Rect,
  matBottom: number,
  k = 1,
): number {
  const { H } = size
  if (anchor === 'mat' && matBottom > 4 * k) {
    // the band's own depth below where the block starts: a caption that grows
    // upward over the photograph is a different design, not this ceiling
    return Math.max(0, H * k - blockTop({ slots: [], anchor }, size, 0, frame, k, matBottom))
  }
  // top hangs down, bottom grows up, center is centred: all three leave the same
  // 10% margin at each end, so all three get the same room
  return H * 0.9 * k
}

/** The factor every size in this block may be multiplied by and still fit. */
export function textScaleCeiling(
  size: Size,
  config: TextConfig,
  frame: Rect,
  matBottom: number,
): number {
  const box = textBoxHeight(config, size, 1)
  const room = textRoom(size, config.anchor, frame, matBottom)
  if (box <= 0) return Number.POSITIVE_INFINITY
  return room / box
}

/** Two decimals, on every number that leaves here as a slider bound. A ceiling
 *  is an `max` attribute in the DOM, and `7.000000000000001` is the same number
 *  wearing a lie about its precision. */
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** The largest this slot's `size` may be, with every other slot as it stands. */
export function sizeCeiling(
  size: Size,
  config: TextConfig,
  frame: Rect,
  matBottom: number,
  slotIndex: number,
): number {
  const slot = config.slots[slotIndex]
  if (!slot) return MIN_TEXT_SIZE
  const factor = textScaleCeiling(size, config, frame, matBottom)
  if (!Number.isFinite(factor)) return MAX_TEXT_SIZE
  return round2(clamp(slot.size * factor, MIN_TEXT_SIZE, MAX_TEXT_SIZE))
}

/**
 * Nudges a text block into the region where its type fits: every size down by
 * the same factor until the block fits the room its anchor leaves, then the
 * offsets inside the canvas.
 *
 * Returning the record it was handed when nothing needs to change is
 * load-bearing for the same reason it is in `settleFrame`: `setControl`'s
 * reference comparison is what tells "the user moved something" from "the app
 * re-derived the same record", and the 已调整 marker rides on that answer.
 */
export function settleText(
  size: Size,
  config: TextConfig,
  frame: Rect,
  matBottom: number,
): TextConfig {
  const factor = textScaleCeiling(size, config, frame, matBottom)
  const scaled = Number.isFinite(factor) && factor < 1 ? factor : 1
  const slots = config.slots.map((s) => ({
    ...s,
    size: clamp(s.size * scaled, MIN_TEXT_SIZE, MAX_TEXT_SIZE),
  }))
  const bounds = textOffsetBounds(size, { ...config, slots }, frame, matBottom)
  const dx = clamp(config.dx ?? 0, bounds.x.min, bounds.x.max)
  const dy = clamp(config.dy ?? 0, bounds.y.min, bounds.y.max)

  const same =
    dx === (config.dx ?? 0) &&
    dy === (config.dy ?? 0) &&
    slots.every((s, i) => s.size === config.slots[i]?.size)
  return same ? config : { ...config, slots, dx, dy }
}

/** Below this a line is not legible at the app's own preview size, and above
 *  `MAX` it is a graphic rather than a caption; both are the record's units,
 *  where 34 is 经典's title. */
export const MIN_TEXT_SIZE = 4
export const MAX_TEXT_SIZE = 160

/**
 * Where the block may be nudged to, as percentages of the canvas.
 *
 * `frame` is the photograph's box — the block's anchor is measured from it for
 * `'mat'` — and the box is the block's own, conservative as above.
 */
export function textOffsetBounds(
  size: Size,
  config: TextConfig,
  frame: Rect,
  matBottom: number,
): OffsetBounds {
  const span = textSpan(config, size, 1)
  const y0 = blockTop(config, size, span, frame, 1, matBottom)
  const bases = config.slots.map((s) => baseSize(s.size, size.H))
  const first = bases[0] ?? 0
  const last = bases[bases.length - 1] ?? 0
  const top = y0 - first * TEXT_ASCENT
  const bottom = y0 + span + last * TEXT_DESCENT

  // A line is fitted to `TEXT_FIT` of the width, so the block can never be
  // wider than that share of the canvas and can never be shifted by more than
  // what is left.
  const dxMax = 50 * (1 - TEXT_FIT)
  // `dy` moves the block down by this share of the canvas's height, so the box
  // may move until its top or its bottom meets an edge.
  const dyMin = (-100 * top) / size.H
  const dyMax = (100 * (size.H - bottom)) / size.H

  return {
    // Never inverted, like `offsetBounds`: a block already against an edge has
    // no room that way, and the honest answer is a range at zero.
    x: { min: round2(Math.min(-dxMax, 0)), max: round2(Math.max(dxMax, 0)) },
    y: { min: round2(Math.min(dyMin, 0)), max: round2(Math.max(dyMax, 0)) },
  }
}
