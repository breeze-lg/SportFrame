/**
 * 文字 / 画面 — which of the two panels the screen is showing.
 *
 * They were stacked in the right-hand column until the rack of styles grew a
 * row of collections above it: three panels and a capsule of chips do not fit
 * a phone screen at once, and the fold is a bad place for the control that
 * changes the mount. Showing one at a time is what the reference editor does
 * with its row of tools, and it is also the honest shape — 文字 and 画面 are two
 * questions about the same poster, not two things the user reads at once.
 *
 * The switch is a *view*: it is not in the session record, and a refresh comes
 * back to it only as far as the panel it was on still exists. See `paintModes`
 * in `main.ts`.
 */
export type Mode = 'words' | 'frame'

export const MODES: { id: Mode; label: string }[] = [
  { id: 'words', label: '文字' },
  { id: 'frame', label: '画面' },
]

/** Does this mode have anything to show? `words` is whether the current
 *  template prints any typography at all — the same test `fields.ts` makes
 *  before it builds a row, and the reason the two cannot disagree. */
export function modeHasWork(mode: Mode, words: boolean): boolean {
  return mode === 'frame' || words
}

/**
 * The mode actually shown, given the one that was asked for. 留白 declares no
 * text slots, so 文字 on it would be an empty sheet over the poster; the mount is
 * always adjustable, so 画面 is the answer that always exists.
 */
export function modeFor(wanted: Mode, words: boolean): Mode {
  return modeHasWork(wanted, words) ? wanted : 'frame'
}

/**
 * The switch: one button per mode, the current one marked. A mode with nothing
 * behind it is drawn `disabled` with the reason on its `title` rather than left
 * live and inert — the same rule the rail follows for a chip that would print
 * nothing.
 */
export function renderModes(
  host: HTMLElement,
  active: Mode,
  words: boolean,
  onPick: (mode: Mode) => void,
): void {
  host.textContent = ''
  for (const mode of MODES) {
    const open = modeHasWork(mode.id, words)
    const b = document.createElement('button')
    b.className = 'mode' + (mode.id === active ? ' on' : '')
    b.type = 'button'
    b.textContent = mode.label
    b.disabled = !open
    if (!open) b.title = '这个样式不打印文字'
    b.setAttribute('aria-pressed', mode.id === active ? 'true' : 'false')
    b.setAttribute('aria-controls', 'panels')
    b.addEventListener('click', () => onPick(mode.id))
    host.appendChild(b)
  }
}
