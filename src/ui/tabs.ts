import type { Template } from '../core/types'

/**
 * The collections the rack is filtered by — the row of names above the styles,
 * and the reason a strip of nine pictures is navigable once it is fifteen.
 *
 * Each one is a property of the record rather than a list somebody maintains:
 * 满幅 is a mount with no mat at all, 有白边 is one with a mat, 参数牌 is one that
 * prints the camera's own settings, 我的 is what the user saved. That is the
 * whole design of this file — a tab that could disagree with the chip it is
 * showing would be a second list of the templates, and the first thing to go
 * stale when one is added.
 *
 * `all` is first and always present, because it is the answer to "where did my
 * ninth style go".
 */
export type TabId = 'all' | 'full' | 'bordered' | 'plate' | 'mine'

const LABELS: Record<TabId, string> = {
  all: '全部',
  full: '满幅',
  bordered: '有白边',
  plate: '参数牌',
  mine: '我的',
}

export function labelOf(tab: TabId): string {
  return LABELS[tab]
}

/**
 * The tabs the strip shows, in order. 我的 appears only once there is something
 * in it: a tab that opens on nothing is a dead end, and every other tab is
 * non-empty by construction — the nine built-ins cover 满幅, 有白边 and 参数牌
 * between them (`tests/unit/tabs.test.ts` is what keeps that true).
 */
export function tabsFor(savedCount: number): TabId[] {
  const base: TabId[] = ['all', 'full', 'bordered', 'plate']
  return savedCount > 0 ? [...base, 'mine'] : base
}

/** Is this template in this collection? `custom` is the one thing the record
 *  cannot answer — a saved copy is the same shape as the template it came
 *  from — so it is passed in, the same way `renderRail` takes it. */
export function inTab(t: Template, tab: TabId, custom: boolean): boolean {
  switch (tab) {
    case 'all':
      return true
    case 'full':
      return t.frame.mat === 0 && t.frame.matBottom === 0
    case 'bordered':
      return t.frame.mat > 0 || t.frame.matBottom > 0
    case 'plate':
      return t.plate?.enabled === true
    case 'mine':
      return custom
  }
}

/** The templates a tab shows, in the order they were handed in. */
export function filterRail(
  templates: Template[],
  tab: TabId,
  customIds: ReadonlySet<string>,
): Template[] {
  // `all` short-circuits rather than filtering: it is the default, and the
  // default should not be able to lose a template to a rule about mats.
  if (tab === 'all') return templates
  return templates.filter((t) => inTab(t, tab, customIds.has(t.id)))
}

/**
 * The strip itself: one button per tab, named rather than drawn — unlike the
 * chips below it, a tab *is* a word, and the only way to say 参数牌 in a picture
 * is to write it.
 *
 * `aria-pressed` rather than `aria-selected` for the same reason the rail uses
 * it: these are toggle buttons in a group, and `selected` only means something
 * inside a listbox.
 */
export function renderTabs(
  host: HTMLElement,
  tabs: TabId[],
  active: TabId,
  onPick: (tab: TabId) => void,
): void {
  host.textContent = ''
  for (const tab of tabs) {
    const b = document.createElement('button')
    b.className = 'tab' + (tab === active ? ' on' : '')
    b.type = 'button'
    b.textContent = LABELS[tab]
    b.setAttribute('aria-pressed', tab === active ? 'true' : 'false')
    b.addEventListener('click', () => onPick(tab))
    host.appendChild(b)
  }
}
