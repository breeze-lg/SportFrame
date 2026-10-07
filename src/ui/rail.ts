import type { Template } from '../core/types'

/**
 * The template rail: one chip per template, drawn as a blank print rather than
 * a labelled button — the wall is the interface, and the rail is the rack of
 * mounts beside it. The name is carried on `title` for a pointer and on
 * `aria-label` for everything that reads the page rather than looking at it.
 *
 * `aria-pressed` rather than `aria-selected`: these are toggle buttons in a
 * group, and `selected` is only meaningful inside a listbox or grid.
 */
export function renderRail(
  host: HTMLElement,
  templates: Template[],
  activeId: string | null,
  onPick: (id: string) => void,
): void {
  host.textContent = ''
  for (const t of templates) {
    const b = document.createElement('button')
    b.className = 'print' + (t.id === activeId ? ' on' : '')
    if (t.premium) b.classList.add('brass')
    b.type = 'button'
    b.title = t.name
    b.setAttribute('aria-label', t.name)
    b.setAttribute('aria-pressed', t.id === activeId ? 'true' : 'false')
    b.addEventListener('click', () => onPick(t.id))
    host.appendChild(b)
  }
}
