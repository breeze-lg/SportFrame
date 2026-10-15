import {
  clamp,
  frameRect,
  matCeiling,
  matSumCeiling,
  offsetBounds,
  scaleCeiling,
  settleFrame,
  type OffsetBounds,
} from '../core/limits'
import type { Size, Template } from '../core/types'

/**
 * 画面 — the sliders that decide how the mount sits on the wall, and the one
 * record they write.
 *
 * Every template carries its geometry as constants (`frame.scale`, `mat`,
 * `matBottom`, `ox`, `oy`, `background.zoom`…), and until this module existed
 * the only way to change one was to edit `src/core/templates.ts`. That is the
 * right shape for the nine built-ins — they are the product's own
 * recommendation — and the wrong shape for a user who wants their photograph
 * larger, or a fatter mat.
 *
 * The split here is deliberate and it is the same split `fields.ts` makes:
 *
 * - `controlSpecs` / `setControl` are pure functions over a `Template` and a
 *   `ControlContext`. No DOM, no state, no canvas. The whole of the write path
 *   — including the clamping that keeps a mount inside its canvas — is
 *   therefore testable in `node`, and `tests/unit/controls.test.ts` sweeps
 *   every control on every built-in through it.
 * - `renderControls` / `syncControls` are the sliders, and know nothing.
 *
 * The record a control writes is a COPY. `state.template` is usually one of the
 * `TEMPLATES` singletons, and a slider that mutated one would change 经典 for
 * the rest of the session — the rail's own chip included. Writing a copy is
 * also what makes 存为模板 carry the numbers for free: what the user saves is
 * the record they were looking at, not a reference to what it came from.
 */

export type ControlId = 'scale' | 'ox' | 'oy' | 'mat' | 'matBottom' | 'zoom' | 'blur' | 'darken'

export type ControlSpec = {
  id: ControlId
  label: string
  min: number
  max: number
  step: number
  value: number
  unit: string
}

/**
 * What a control needs to know about the poster it is adjusting. `size` is the
 * canvas at `k = 1` — the layout box the ceilings are measured against — and
 * `aspect` is the photograph's, which is what decides the frame's rectangle at
 * a given scale. The rect is derived, never passed: a context carrying both the
 * scale and the rect could disagree with itself, and `fitRect` is the only
 * thing entitled to an opinion about where a frame lands.
 */
export type ControlContext = { size: Size; aspect: number }

/**
 * The range a bound becomes, once a slider has to offer it: whole numbers,
 * inward. One helper, used by `controlSpecs` *and* by `settleTemplate`, because
 * the two have to agree — a record settled to 5.714 sitting beside a slider
 * whose maximum is 5 is a readout and a thumb that describe different posters,
 * and the next drag then moves the mount a step the user did not ask for.
 *
 * Never inverted: both bounds are built around zero (`offsetBounds`), so
 * `ceil(min) ≤ 0 ≤ floor(max)` holds for every input.
 */
function inRange(b: OffsetBounds): OffsetBounds {
  return {
    x: { min: Math.ceil(b.x.min), max: Math.floor(b.x.max) },
    y: { min: Math.ceil(b.y.min), max: Math.floor(b.y.max) },
  }
}

/** The floor for 前景大小, and the three 后景 ranges. Every other ceiling comes
 *  from the layout (`limits.ts`); these are the numbers the layout has no
 *  opinion about — a photograph that fills a tenth of the wall is not a
 *  *geometry* failure, and the background's blur and darkening never touch the
 *  mat at all. */
const SCALE_MIN = 20
const ZOOM = { min: 100, max: 220 }
const BLUR = { min: 0, max: 80 }
const DARKEN = { min: 0, max: 90 }

const LABELS: Record<ControlId, { label: string; unit: string }> = {
  scale: { label: '前景大小', unit: '%' },
  ox: { label: '水平位置', unit: '%' },
  oy: { label: '垂直位置', unit: '%' },
  mat: { label: '白边', unit: 'px' },
  matBottom: { label: '下白边', unit: 'px' },
  zoom: { label: '后景放大', unit: '%' },
  blur: { label: '后景虚化', unit: 'px' },
  darken: { label: '后景压暗', unit: '%' },
}

/**
 * The panel for this template: one slider per thing this template can actually
 * change, in the order a user meets them.
 *
 * 后景 is omitted entirely for a `solid` background, for the reason 文字 is
 * omitted for 留白: 样张 paints a flat white card, so a 后景虚化 slider there
 * would accept a drag and change nothing on the wall. A control that cannot
 * change the poster is the failure this app's architecture spends its comments
 * preventing, and the fix is the same one `fields.ts` applies — do not draw it.
 *
 * The 白边 pair is offered everywhere, including the templates that ship with
 * no mat at all. Raising it there adds a border that was not there before,
 * which is a change the wall shows.
 */
export function controlSpecs(t: Template, ctx: ControlContext): ControlSpec[] {
  const { frame, background } = t
  const { size } = ctx
  const rect = frameRect(size, ctx.aspect, frame.scale)

  const specs: ControlSpec[] = [
    {
      id: 'scale',
      ...LABELS.scale,
      step: 1,
      min: SCALE_MIN,
      // Whole numbers inward, like the offsets: a record settled onto 67.22
      // would sit above a slider whose maximum is 67.
      max: Math.floor(scaleCeiling(size, frame.mat, frame.matBottom)),
      value: frame.scale,
    },
  ]

  const bounds = inRange(offsetBounds(size, rect, frame.mat, frame.matBottom))
  specs.push(
    { id: 'ox', ...LABELS.ox, step: 1, min: bounds.x.min, max: bounds.x.max, value: frame.ox ?? 0 },
    { id: 'oy', ...LABELS.oy, step: 1, min: bounds.y.min, max: bounds.y.max, value: frame.oy ?? 0 },
    {
      id: 'mat',
      ...LABELS.mat,
      step: 1,
      min: 0,
      // both constraints: the side walls on `mat` alone, and the bottom edge on
      // `mat + matBottom`, which is where the template's own `matBottom` still
      // has to fit
      max: Math.floor(
        Math.min(matCeiling(size, frame.scale), matSumCeiling(size, frame.scale) - frame.matBottom),
      ),
      value: frame.mat,
    },
    {
      id: 'matBottom',
      ...LABELS.matBottom,
      step: 1,
      min: 0,
      max: Math.floor(matSumCeiling(size, frame.scale) - frame.mat),
      value: frame.matBottom,
    },
  )

  if (background.mode === 'blur') {
    specs.push(
      { id: 'zoom', ...LABELS.zoom, step: 1, ...ZOOM, value: background.zoom ?? 100 },
      { id: 'blur', ...LABELS.blur, step: 1, ...BLUR, value: background.blur ?? 0 },
      { id: 'darken', ...LABELS.darken, step: 1, ...DARKEN, value: background.darken ?? 0 },
    )
  }

  // A deep mat at a large scale leaves the two ceilings crossed — `mat` single
  // digits above `scale`, or a negative max. That is only reachable from a
  // record this app did not write (every write path settles), so the panel does
  // not refuse it; it just must not hand a range input `min="20" max="3"`,
  // which some engines clamp and others flip.
  return specs.map((s) => ({ ...s, min: Math.min(s.min, s.max), max: Math.max(s.min, s.max) }))
}

/**
 * The whole of the write path: set one control, clamped, and settle what
 * settling that disturbed.
 *
 * Clamping the *driven* control rather than pushing its neighbours around is
 * what keeps a drag legible — pulling 白边 further than the photograph's
 * headroom allows stops the mat, rather than shrinking the photograph out from
 * under the pointer. The one thing it cannot cover on its own is the offsets:
 * a larger photograph has less room to sit off centre, so raising 前景大小 can
 * leave an offset that is now out of bounds, and `settleTemplate` is what pulls
 * it back.
 *
 * Returns the record it was handed when the write would change nothing, so the
 * caller can tell a drag that landed on the value that was already there from
 * one that moved. The 已调整 marker and a redraw both hang off that answer.
 */
export function setControl(
  t: Template,
  id: ControlId,
  raw: number,
  ctx: ControlContext,
): Template {
  const spec = controlSpecs(t, ctx).find((s) => s.id === id)
  if (!spec) return t
  // A slider cannot produce a non-number, but a NaN that got this far would be
  // written into the record and refused by `validateTemplate` on the next load
  // — the saved template would disappear rather than the bad value never being
  // written. Refused here, where it is still one function's problem.
  if (!Number.isFinite(raw)) return t
  const v = clamp(Math.round(raw), spec.min, spec.max)
  if (v === spec.value) return t

  const frame = { ...t.frame }
  const background = { ...t.background }
  // Exhaustive by construction: `ControlId` names exactly these eight, and
  // the two groups are the record's two geometry blocks.
  switch (id) {
    case 'scale': frame.scale = v; break
    case 'ox': frame.ox = v; break
    case 'oy': frame.oy = v; break
    case 'mat': frame.mat = v; break
    case 'matBottom': frame.matBottom = v; break
    case 'zoom': background.zoom = v; break
    case 'blur': background.blur = v; break
    case 'darken': background.darken = v; break
  }

  return settleTemplate({ ...t, frame, background }, ctx)
}

/**
 * The record after its geometry has been made to fit the canvas: the scale is
 * lowered until the mat's headroom can hold it, and the offsets are pulled
 * inside the room that scale leaves.
 *
 * Called on every write, and on a new photograph, because the canvas a mount is
 * measured against can change under it (a saved template with an `orig` ratio
 * is sized from the photograph, not from a constant). Idempotent — a record
 * that already fits comes back as the same object, which is what lets
 * `paintAdjusted` treat "same object as the rail would hand you" as "unmoved".
 */
export function settleTemplate(t: Template, ctx: ControlContext): Template {
  const g = settleFrame(ctx.size, t.frame)
  // Floored, not merely lowered: `settleFrame` answers with the exact ceiling
  // (67.22 for 样张's mat) and the panel offers whole numbers, so a record kept
  // at the exact bound would sit just outside the range its own slider shows.
  // A lower scale can only widen the headroom, so this stays inside the fit.
  const scale = Math.floor(g.scale)
  const rect = frameRect(ctx.size, ctx.aspect, scale)
  const bounds = inRange(offsetBounds(ctx.size, rect, g.mat, g.matBottom))
  const ox = clamp(t.frame.ox ?? 0, bounds.x.min, bounds.x.max)
  const oy = clamp(t.frame.oy ?? 0, bounds.y.min, bounds.y.max)
  if (scale === t.frame.scale && ox === (t.frame.ox ?? 0) && oy === (t.frame.oy ?? 0)) return t
  return { ...t, frame: { ...t.frame, scale, ox, oy } }
}

/** The readout: one decimal at most, because a settled scale is a division's
 *  remainder and `67.22222222%` is not a number anyone asked for. */
function shown(v: number): string {
  return String(Math.round(v * 10) / 10)
}

/**
 * Builds the sliders, once per template. Not per keystroke and not per frame:
 * an `<input type="range">` replaced mid-drag loses the pointer, so the rows
 * are written here and only ever *updated* after this — `syncControls`.
 */
export function renderControls(
  host: HTMLElement,
  specs: ControlSpec[],
  onInput: (id: ControlId, value: number) => void,
): void {
  host.textContent = ''
  for (const s of specs) {
    const row = document.createElement('div')
    row.className = 'ctl'
    row.dataset.id = s.id

    const name = document.createElement('span')
    name.className = 'ctl-name'
    name.textContent = s.label

    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'ctl-range'
    input.dataset.id = s.id
    // The visible name is a sibling, not a wrapping `<label>`, because a label
    // around a range input also forwards clicks on the track to a target the
    // browser picks — and this is the one control whose whole job is the thumb.
    input.setAttribute('aria-label', s.label)
    input.addEventListener('input', () => onInput(s.id, Number(input.value)))

    const val = document.createElement('span')
    val.className = 'ctl-val'

    row.append(name, input, val)
    host.appendChild(row)
  }
  syncControls(host, specs)
}

/**
 * Pushes a fresh set of bounds and values onto the sliders that are already
 * there. Called after every write, because every write moves the ceilings: a
 * deeper mat lowers the scale's maximum, a larger photograph narrows the
 * offsets. A slider still offering last frame's maximum is a control that can
 * build a poster the renderer would crop.
 *
 * `value` is only assigned when it differs from what the DOM holds. Assigning
 * it unconditionally during a drag would fight the pointer for the thumb: the
 * browser has already moved the thumb to the pointer's position and this would
 * drag it back to the value the model had a moment ago.
 */
export function syncControls(host: HTMLElement, specs: ControlSpec[]): void {
  for (const s of specs) {
    const row = host.querySelector<HTMLElement>(`.ctl[data-id="${s.id}"]`)
    if (!row) continue
    const input = row.querySelector<HTMLInputElement>('input')
    const val = row.querySelector<HTMLElement>('.ctl-val')
    if (!input) continue
    input.min = String(s.min)
    input.max = String(s.max)
    input.step = String(s.step)
    if (Number(input.value) !== s.value) input.value = String(s.value)
    if (val) val.textContent = `${shown(s.value)}${s.unit}`
  }
}
