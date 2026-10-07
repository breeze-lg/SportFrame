import { describe, it, expect } from 'vitest'
import { TEMPLATES, validateTemplate, getTemplate } from '../../src/core/templates'

describe('TEMPLATES', () => {
  it('every built-in template validates', () => {
    for (const t of TEMPLATES) {
      expect(validateTemplate(t), t.id).toEqual({ ok: true, value: t })
    }
  })

  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks exactly one template premium in v1', () => {
    expect(TEMPLATES.filter((t) => t.premium).map((t) => t.id)).toEqual(['spec-sheet'])
  })

  it('getTemplate finds by id and returns undefined otherwise', () => {
    expect(getTemplate('classic')?.name).toBe('经典')
    expect(getTemplate('nope')).toBeUndefined()
  })
})

describe('validateTemplate', () => {
  it('rejects a non-object', () => {
    expect(validateTemplate(null).ok).toBe(false)
    expect(validateTemplate('x').ok).toBe(false)
  })

  it('rejects a missing id', () => {
    expect(validateTemplate({ name: 'x' }).ok).toBe(false)
  })

  it('rejects an unknown anchor', () => {
    const bad = { ...TEMPLATES[0], text: { anchor: 'sideways', slots: [] } }
    expect(validateTemplate(bad).ok).toBe(false)
  })

  it('accepts a minimal valid template', () => {
    const ok = validateTemplate({
      id: 'a',
      name: 'A',
      layout: { kind: 'single' },
      canvas: { ratio: '1:1' },
      background: { mode: 'blur' },
      frame: { scale: 70, radius: 0, mat: 0, matBottom: 0, shadow: 0 },
    })
    expect(ok.ok).toBe(true)
  })
})

describe('validateTemplate rejects a corrupted built-in', () => {
  // The gate in front of templates restored from localStorage (Task 13) has to
  // reject, not merely accept: a validator that returns `ok` for everything
  // passes every test that only ever feeds it built-in records. Each case
  // takes `classic` back off `TEMPLATES`, corrupts exactly one field, and
  // asserts the *reason*, so a rejection for the wrong field cannot be
  // mistaken for a rejection for the right one.
  const corrupt = (change: (t: any) => void): unknown => {
    const copy = structuredClone(TEMPLATES[0]!)
    change(copy)
    return copy
  }

  it('rejects a bad canvas ratio', () => {
    expect(validateTemplate(corrupt((t) => { t.canvas.ratio = '4:3' }))).toEqual({
      ok: false,
      error: 'invalid ratio',
    })
  })

  it('rejects a non-numeric frame value', () => {
    expect(validateTemplate(corrupt((t) => { t.frame.scale = '72' }))).toEqual({
      ok: false,
      error: 'frame.scale must be a number',
    })
  })

  it('rejects a bad background mode', () => {
    expect(validateTemplate(corrupt((t) => { t.background.mode = 'blurred' }))).toEqual({
      ok: false,
      error: 'invalid background mode',
    })
  })

  it('rejects an unknown layout kind', () => {
    expect(validateTemplate(corrupt((t) => { t.layout.kind = 'mosaic' }))).toEqual({
      ok: false,
      error: 'unknown layout kind',
    })
  })

  it('rejects a missing frame', () => {
    expect(validateTemplate(corrupt((t) => { delete t.frame }))).toEqual({
      ok: false,
      error: 'missing frame',
    })
  })

  it('rejects an empty id', () => {
    expect(validateTemplate(corrupt((t) => { t.id = '' }))).toEqual({
      ok: false,
      error: 'missing id',
    })
  })

  it('does not mutate the record it was handed', () => {
    const before = JSON.stringify(TEMPLATES[0])
    validateTemplate(TEMPLATES[0])
    expect(JSON.stringify(TEMPLATES[0])).toBe(before)
  })
})
