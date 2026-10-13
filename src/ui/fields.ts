import type { TextConfig, TextSlotId } from '../core/types'

/**
 * The words on the poster: one input per slot the *current template* declares.
 *
 * The list follows the template rather than the schema, and that is the whole
 * design decision here. A fixed row of three fields would show 副标题 under 留白,
 * which has no `text` config at all and prints nothing — a control that accepts
 * typing and changes nothing on the wall, which is the failure this app's
 * architecture spends its comments preventing. Asking the template which slots
 * it draws means **every field that exists is a field that prints**, and a
 * template with no typography gets no row at all.
 *
 * The values are the app's, not the template's: typing a title and then
 * switching 经典 → 拍立得 → 经典 leaves the words in place, because the template
 * chooses the typography and the user chose the words. `state.text` is that one
 * record; `render` reads the slots the template declares out of it and ignores
 * the rest.
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

/**
 * Fills `row` with one input per declared slot and returns how many it drew, so
 * the caller can hide its whole block (heading included) at zero rather than
 * leaving an empty label on the dock.
 *
 * `onInput` fires per keystroke and the caller redraws: the preview is one
 * `render` at 1152×1440 and takes no measurable time, so deferring it would buy
 * nothing and cost the immediacy that makes the field feel connected to the
 * poster.
 */
export function renderFields(
  row: HTMLElement,
  config: TextConfig | undefined,
  values: Partial<Record<TextSlotId, string>>,
  onInput: (id: TextSlotId, value: string) => void,
): number {
  row.textContent = ''
  const slots = config?.slots ?? []
  const drawn = new Set<TextSlotId>()

  for (const slot of slots) {
    // `validateTemplate` allows a repeated id in a slot list; one slot is one
    // input, and a second field writing the same key would be two boxes
    // fighting over one value.
    if (drawn.has(slot.id)) continue
    drawn.add(slot.id)

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'field'
    input.id = `field-${slot.id}`
    input.value = values[slot.id] ?? ''
    input.placeholder = PLACEHOLDERS[slot.id]
    // The placeholder disappears the moment there is a value, and a text input
    // has no visible label otherwise — so the name rides on the input itself.
    input.setAttribute('aria-label', LABELS[slot.id])
    input.addEventListener('input', () => onInput(slot.id, input.value))
    row.appendChild(input)
  }

  return drawn.size
}
