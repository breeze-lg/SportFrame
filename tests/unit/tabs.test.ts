import { describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../src/core/templates'
import { filterRail, inTab, tabsFor } from '../../src/ui/tabs'

/**
 * The collections above the rack. Everything here is a property of the template
 * records rather than a list somebody maintains, which is the only reason a tab
 * can be trusted to agree with the chips under it — so the tests are about the
 * partition holding for the templates that actually ship, not about the switch
 * statement being written a particular way.
 */
describe('tabsFor', () => {
  it('shows 我的 only when there is something in it', () => {
    expect(tabsFor(0)).toEqual(['all', 'full', 'bordered', 'plate'])
    expect(tabsFor(2)).toEqual(['all', 'full', 'bordered', 'plate', 'mine'])
  })
})

describe('inTab', () => {
  it('partitions the built-ins into mats and full-bleed, with no template in both', () => {
    const full = TEMPLATES.filter((t) => inTab(t, 'full', false))
    const bordered = TEMPLATES.filter((t) => inTab(t, 'bordered', false))

    expect(full.length + bordered.length, 'a template is in both or in neither').toBe(
      TEMPLATES.length,
    )
    expect(full.map((t) => t.id)).toContain('classic')
    expect(bordered.map((t) => t.id)).toContain('polaroid')
    // the same record cannot be a mat and a full-bleed at once, which is what
    // makes the two tabs a partition rather than two overlapping answers
    for (const t of full) expect(inTab(t, 'bordered', false), t.id).toBe(false)
  })

  it('puts 样张, and only 样张, in 参数牌', () => {
    expect(TEMPLATES.filter((t) => inTab(t, 'plate', false)).map((t) => t.id)).toEqual([
      'spec-sheet',
    ])
  })

  it('fills 我的 from the caller\'s verdict, because a saved copy is the same record', () => {
    const saved = { ...TEMPLATES[0]!, id: 'custom-1', name: '副本' }
    const ids = new Set(['custom-1'])

    expect(filterRail([...TEMPLATES, saved], 'mine', ids).map((t) => t.id)).toEqual(['custom-1'])
    // ...and the same record, with a caller that does not know it was saved, is
    // not in 我的: the rail is what knows, and it says so rather than guessing
    // from the shape.
    expect(inTab(saved, 'mine', false)).toBe(false)
  })

  it('is the whole rack, in order, for 全部', () => {
    expect(filterRail(TEMPLATES, 'all', new Set())).toEqual(TEMPLATES)
  })

  it('leaves no tab empty, so no tab is a dead end', () => {
    for (const tab of tabsFor(0)) {
      expect(filterRail(TEMPLATES, tab, new Set()).length, tab).toBeGreaterThan(0)
    }
  })
})
