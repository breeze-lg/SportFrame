import { sizeCeiling, textOffsetBounds } from '../core/limits'
import type { Rect, Size, TextAnchor, TextConfig, TextSlot, TextSlotId } from '../core/types'

/**
 * 文字 — the words, the type they are set in, and where the block sits.
 *
 * The panel is one input per slot the template declares (that rule has not
 * changed and should not: a field for a slot nothing draws is a control that
 * accepts typing and changes nothing), plus, per slot, the two things that
 * decide how it looks: the **face** (`src/core/fonts.ts`) and the **size**. The
 * block's position is one set of controls for the whole block, above the slots,
 * because that is what a position is — the words move together, the way a
 * paragraph does.
 *
 * Same split as every other panel in this app: `wordsPanel` is the model — pure
 * data in, pure data out, including the ceilings the sliders are bounded by —
 * and `renderFields` is the dumb DOM half. What the ceilings are *derived from*
 * is `src/core/limits.ts`, which reads the same `blockTop`/`textSpan` the
 * renderer does; a maximum computed anywhere else would be a second opinion
 * about where the words land.
 *
 * The values are the app's (`state.text`) and the typography is the template's
 * (`slot.size`, `slot.family`) — the same line as 画面 draws between the mount's
 * numbers and the photograph.
 */

const LABELS: Record<TextSlotId, string> = {
  title: '主标题',
  sub: '副标题',
  sign: '署名',
}

const PLACEHOLDERS: Record<TextSlotId, string> = {
  title: '给这张照片一句话',
  sub: '补一行说明',
  sign: '署名',
}

const ANCHOR_LABELS: Record<TextAnchor, string> = {
  top: '顶部',
  mat: '白边',
  center: '居中',
  bottom: '底部',
}

/** What the ceilings need: the canvas the poster is drawn at, the photograph's
 *  box inside it, and the depth of the band under it. The panel asks the same
 *  question the renderer answers. */
export type TypeContext = { size: Size; frame: Rect; matBottom: number }

export type FontOption = { group: string; id: string; label: string }

export type SlotSpec = {
  index: number
  id: TextSlotId
  label: string
  placeholder: string
  value: string
  size: number
  sizeMin: number
  sizeMax: number
  family: string
}

export type WordsPanel = {
  slots: SlotSpec[]
  anchors: { id: TextAnchor; label: string }[]
  anchor: TextAnchor
  dx: number
  dy: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  families: FontOption[]
}

/** The value the picker shows for a slot that has no family of its own. */
export const DEFAULT_FAMILY = 'default'

export function wordsPanel(
  config: TextConfig,
  values: Partial<Record<TextSlotId, string>>,
  ctx: TypeContext,
  families: FontOption[],
): WordsPanel {
  const slots: SlotSpec[] = []
  const seen = new Set<TextSlotId>()
  config.slots.forEach((slot: TextSlot, index: number) => {
    // the same rule `drawText` and `fields` have always applied: a repeated id is
    // one line, so it is one block of controls
    if (seen.has(slot.id)) return
    seen.add(slot.id)
    slots.push({
      index,
      id: slot.id,
      label: LABELS[slot.id],
      placeholder: PLACEHOLDERS[slot.id],
      value: values[slot.id] ?? '',
      size: slot.size,
      sizeMin: 0,
      sizeMax: sizeCeiling(ctx.size, config, ctx.frame, ctx.matBottom, index),
      family: slot.family ?? DEFAULT_FAMILY,
    })
  })

  const bounds = textOffsetBounds(ctx.size, config, ctx.frame, ctx.matBottom)

  return {
    slots,
    // 白边 is offered only where there is a band to put words in. A matless style
    // falls through to `bottom` in `blockTop` anyway, so the button would be a
    // choice that changes nothing — the failure 后景 and 留白's 文字 already refuse.
    anchors: (['top', 'mat', 'center', 'bottom'] as TextAnchor[])
      .filter((a) => a !== 'mat' || ctx.matBottom > 4)
      .map((id) => ({ id, label: ANCHOR_LABELS[id] })),
    anchor: config.anchor,
    dx: config.dx ?? 0,
    dy: config.dy ?? 0,
    xMin: bounds.x.min,
    xMax: bounds.x.max,
    yMin: bounds.y.min,
    yMax: bounds.y.max,
    families,
  }
}

export type WordsHandlers = {
  onInput: (id: TextSlotId, value: string) => void
  onSize: (index: number, size: number) => void
  onFamily: (index: number, family: string) => void
  onAnchor: (anchor: TextAnchor) => void
  onOffset: (axis: 'dx' | 'dy', value: number) => void
  /** Load a font file *for this slot* — the row's ＋ button. */
  onLoadFont: (index: number) => void
  onForgetFont: (family: string) => void
}

/** Two decimals at most, and no trailing `.0`: an offset is a percentage and a
 *  size is a number of the record's own units, and neither wants `2.0000001`. */
function short(v: number): string {
  return String(Math.round(v * 100) / 100)
}

/** How a row's value reads: a percentage, or a plain number of units. */
type Kind = 'pct' | 'int'

function show(kind: Kind, v: number): string {
  return kind === 'pct' ? `${short(v)}%` : String(Math.round(v))
}

function slider(
  name: string,
  value: number,
  min: number,
  max: number,
  step: number,
  kind: Kind,
  onInput: (v: number) => void,
  /** The accessible name, when the visible one is not enough. Two slots both
   *  show 字号, which a screen reader reads as two sliders called 字号 and no way
   *  to tell which line either belongs to. */
  aria = name,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'ctl'

  const label = document.createElement('span')
  label.className = 'ctl-name'
  label.textContent = name

  const input = document.createElement('input')
  input.className = 'ctl-range'
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  // How the readout reads, carried on the element so `syncFields` can put it
  // back without knowing which row it is looking at.
  input.dataset.format = kind
  input.setAttribute('aria-label', aria)
  input.addEventListener('input', () => onInput(Number(input.value)))

  const readout = document.createElement('span')
  readout.className = 'ctl-val'
  readout.textContent = show(kind, value)

  row.append(label, input, readout)
  return row
}

/**
 * Puts the panel's numbers back in step with a record that may have been
 * settled, without rebuilding the DOM — a slider re-created under the pointer
 * loses the drag, which is the same reason `syncControls` exists for 画面.
 *
 * It is also what keeps the panel from telling a comfortable lie: a size drag
 * that the settle clamps to something smaller has to read back as the number the
 * record actually holds, not the one the pointer asked for.
 */
export function syncFields(host: HTMLElement, panel: WordsPanel): void {
  const set = (el: Element | null | undefined, value: number, min: number, max: number) => {
    const input = el as HTMLInputElement | null
    if (!input) return
    input.min = String(min)
    input.max = String(max)
    if (Number(input.value) !== value) input.value = String(value)
    const out = input.parentElement?.querySelector('.ctl-val')
    if (out) out.textContent = show(input.dataset.format === 'pct' ? 'pct' : 'int', value)
  }

  const pos = host.querySelectorAll('.pos-block .ctl-range')
  set(pos[0], panel.dx, panel.xMin, panel.xMax)
  set(pos[1], panel.dy, panel.yMin, panel.yMax)

  host.querySelectorAll('.slot-block').forEach((block, i) => {
    const slot = panel.slots[i]
    if (!slot) return
    set(block.querySelector('.ctl-range'), slot.size, slot.sizeMin, slot.sizeMax)
    const pick = block.querySelector('.font-pick') as HTMLSelectElement | null
    if (pick && pick.value !== slot.family) pick.value = slot.family
  })
}

/**
 * Fills `host` with the whole 文字 panel — position block first, then one block
 * per slot — and returns how many slots it drew, so the caller can hide the
 * panel (heading included) at zero rather than leaving a label over nothing.
 *
 * `onInput` fires per keystroke and the caller redraws: the preview is one
 * `render` at 1152×1440, so deferring it would buy nothing and cost the
 * immediacy that makes the field feel connected to the poster.
 */
export function renderFields(
  host: HTMLElement,
  panel: WordsPanel,
  handlers: WordsHandlers,
): number {
  host.textContent = ''

  if (panel.slots.length > 0) {
    const where = document.createElement('div')
    where.className = 'pos-block'

    const head = document.createElement('div')
    head.className = 'rail-h'
    const title = document.createElement('b')
    title.textContent = '位置'
    const note = document.createElement('span')
    note.className = 'h-note'
    note.textContent = '整块一起动'
    head.append(title, note)
    where.appendChild(head)

    // The anchor: four words, because which end of the poster the block hangs
    // from is a choice between four places and not a number. `.seg` is shared
    // with 画面's 背景 row — one look for "pick one of a few", in two panels.
    const anchors = document.createElement('div')
    anchors.className = 'seg'
    anchors.setAttribute('role', 'group')
    anchors.setAttribute('aria-label', '对齐位置')
    for (const a of panel.anchors) {
      const b = document.createElement('button')
      b.className = 'seg-btn' + (a.id === panel.anchor ? ' on' : '')
      b.type = 'button'
      b.textContent = a.label
      b.setAttribute('aria-pressed', a.id === panel.anchor ? 'true' : 'false')
      b.addEventListener('click', () => handlers.onAnchor(a.id))
      anchors.appendChild(b)
    }
    where.appendChild(anchors)

    where.appendChild(
      slider('水平', panel.dx, panel.xMin, panel.xMax, 0.5, 'pct', (v) => handlers.onOffset('dx', v)),
    )
    where.appendChild(
      slider('垂直', panel.dy, panel.yMin, panel.yMax, 0.5, 'pct', (v) => handlers.onOffset('dy', v)),
    )
    host.appendChild(where)
  }

  for (const slot of panel.slots) {
    const block = document.createElement('div')
    block.className = 'slot-block'

    // Which line this is. The typography rows below carry no word of it — a font
    // picker and a size slider are the same two controls for every slot — and an
    // input with a placeholder is not a label.
    const head = document.createElement('div')
    head.className = 'rail-h'
    const name = document.createElement('b')
    name.textContent = slot.label
    head.appendChild(name)
    block.appendChild(head)

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'field'
    input.id = `field-${slot.id}`
    input.value = slot.value
    input.placeholder = slot.placeholder
    // The placeholder disappears the moment there is a value, and a text input
    // has no visible label otherwise — so the name rides on the input itself.
    input.setAttribute('aria-label', slot.label)
    input.addEventListener('input', () => handlers.onInput(slot.id, input.value))
    block.appendChild(input)

    const type = document.createElement('div')
    type.className = 'slot-type'
    const pick = document.createElement('select')
    pick.className = 'font-pick'
    pick.setAttribute('aria-label', `${slot.label}字体`)
    let group = ''
    let bucket: HTMLOptGroupElement | null = null
    for (const f of panel.families) {
      if (f.group !== group) {
        group = f.group
        bucket = document.createElement('optgroup')
        bucket.label = f.group
        pick.appendChild(bucket)
      }
      const opt = document.createElement('option')
      opt.value = f.id
      opt.textContent = f.label
      bucket?.appendChild(opt)
    }
    // A record may name a face this session has not got — a font the user
    // removed, or one loaded on another machine. It is kept in the list and
    // marked, rather than silently reset to the default: the poster is still
    // drawing it, and a picker that says otherwise is lying about the wall.
    const known = panel.families.some((f) => f.id === slot.family)
    if (!known) {
      const opt = document.createElement('option')
      opt.value = slot.family
      opt.textContent = `${slot.family.replace(/^user:/, '')}（未加载）`
      pick.appendChild(opt)
    }
    pick.value = slot.family
    pick.addEventListener('change', () => handlers.onFamily(slot.index, pick.value))
    type.appendChild(pick)

    const add = document.createElement('button')
    add.className = 'btn btn-small'
    add.type = 'button'
    add.textContent = '＋'
    add.title = '加载字体文件（.ttf / .otf / .woff / .woff2）'
    add.setAttribute('aria-label', `${slot.label}加载字体`)
    add.addEventListener('click', () => handlers.onLoadFont(slot.index))
    type.appendChild(add)

    if (slot.family.startsWith('user:')) {
      const drop = document.createElement('button')
      drop.className = 'btn btn-small'
      drop.type = 'button'
      drop.textContent = '−'
      drop.title = '移除这个字体'
      drop.setAttribute('aria-label', `${slot.label}移除字体`)
      drop.addEventListener('click', () => handlers.onForgetFont(slot.family))
      type.appendChild(drop)
    }
    block.appendChild(type)

    block.appendChild(
      slider(
        '字号',
        slot.size,
        slot.sizeMin,
        slot.sizeMax,
        1,
        'int',
        (v) => handlers.onSize(slot.index, v),
        `${slot.label}字号`,
      ),
    )

    host.appendChild(block)
  }

  return panel.slots.length
}
