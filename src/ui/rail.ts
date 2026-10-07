import type { Template } from '../core/types'

/**
 * The template rail: one chip per template, drawn as a blank print rather than
 * a labelled button — the wall is the interface, and the rail is the rack of
 * mounts beside it. The name is carried on `title` for a pointer and on
 * `aria-label` for everything that reads the page rather than looking at it.
 *
 * `aria-pressed` rather than `aria-selected`: these are toggle buttons in a
 * group, and `selected` is only meaningful inside a listbox or grid.
 *
 * `customIds` marks the templates the user saved. The list arrives merged, so
 * this is the one thing the rail cannot derive: a built-in and a copy of it are
 * the same record apart from the id and the name. `.custom` is the marker, and
 * it is deliberately not `.brass` — brass belongs to premium and to nothing
 * else — see `app.css`.
 *
 * A saved chip also carries a × (`onDelete`). Built-ins never do: they are the
 * product's own nine, and this rail is the only way to choose a mount, so a
 * control that could remove one would be a control that could empty the
 * product. Which templates are the user's is already known here, so the rule
 * is enforced in the one place that draws the affordance — the handler behind
 * it refuses a built-in id as well (see `removeSaved` in `main.ts`).
 */
export function renderRail(
  host: HTMLElement,
  templates: Template[],
  activeId: string | null,
  onPick: (id: string) => void,
  customIds: ReadonlySet<string> = new Set(),
  onDelete?: (id: string) => void,
): void {
  host.textContent = ''
  for (const t of templates) {
    const saved = customIds.has(t.id)

    // Every chip rides in a mount, so the × a saved one carries can be the
    // chip's *sibling* rather than nested in it: a button cannot hold another
    // button, and the chip has to stay one. The × is drawn over the chip's own
    // corner (`app.css`), but it is not inside the chip in the DOM, so the
    // mount carries no handler and neither control has to stop propagation.
    const mount = document.createElement('span')
    mount.className = 'mount'

    const b = document.createElement('button')
    b.className = 'print' + (t.id === activeId ? ' on' : '')
    if (t.premium) b.classList.add('brass')
    if (saved) b.classList.add('custom')
    b.type = 'button'
    b.title = t.name
    b.setAttribute('aria-label', t.name)
    b.setAttribute('aria-pressed', t.id === activeId ? 'true' : 'false')
    b.addEventListener('click', () => onPick(t.id))
    mount.appendChild(b)

    // The × is drawn for a template the user saved and for nothing else: the
    // nine built-ins are the product's own, and a rail that could remove them
    // is a rail that could empty itself. `onDelete` is optional so the rail
    // still renders — read-only — for a caller with nothing to delete.
    if (saved && onDelete) {
      const del = document.createElement('button')
      del.className = 'del'
      del.type = 'button'
      del.textContent = '×'
      del.title = `删除模板 ${t.name}`
      del.setAttribute('aria-label', `删除模板 ${t.name}`)
      del.addEventListener('click', () => onDelete(t.id))
      mount.appendChild(del)
    }

    host.appendChild(mount)
  }
}
