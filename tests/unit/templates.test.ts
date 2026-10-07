import { describe, it, expect } from 'vitest'
import { TEMPLATES, validateTemplate, getTemplate } from '../../src/core/templates'
import { fitRect, matRect, resolveSize } from '../../src/core/geometry'

/** Takes a built-in off `TEMPLATES` (index 0 is `classic`), corrupts exactly
 *  one field, and returns the copy. Shared by every describe that needs a
 *  record which is real everywhere except the field under test. */
const corrupt = (change: (t: any) => void, index = 0): unknown => {
  const copy = structuredClone(TEMPLATES[index]!)
  change(copy)
  return copy
}

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

/**
 * The composition invariant: a template's mat has to lie inside the canvas it
 * is mounted on.
 *
 * `fitRect` centres the photograph in the canvas at `scale` percent of it, and
 * `matRect` grows that frame by `mat` on three sides and by `mat + matBottom`
 * below. Those four numbers are authored independently in a template record and
 * nothing in the data model ties them together, so the two can be written in a
 * combination that cannot fit: 样张 shipped at `scale: 78` with the deepest mat
 * in the set (86 + 150) and needed 2145px of canvas where the app renders 1440,
 * putting the card's bottom edge — and, once Task 16 laid the plate out in that
 * band, the plate — 78px below the poster. Nothing noticed for as long as the
 * clipped strip stayed empty, which is exactly what a template's deepest margin
 * normally is.
 *
 * So the guard is the general form of that bug rather than a pin on one
 * template's numbers: every built-in is laid out at the size the app actually
 * renders it, through the same `fitRect`/`matRect` the renderer uses (imported,
 * not restated — a copy here could drift from the implementation and pass while
 * the poster crops).
 */
describe('the mat fits the canvas it is mounted on', () => {
  /**
   * The app renders one canvas per template per scale: `resolveSize(ratio,
   * state.longEdge)` with `state.longEdge` at its default 1440 — 1152×1440 for
   * 样张 — as the `k = 1` preview the user is looking at and as the `k = 2` and
   * `k = 4` export canvases, which are that geometry multiplied through. It is
   * the only size the app produces, and the one the defect was visible at. The
   * 480×600 the goldens are rendered at is a probe size the app never uses, and
   * a mat of 236px cannot fit a 600px canvas at any scale that leaves a
   * photograph on it — so it would answer a question nobody asked.
   */
  const LONG_EDGE = 1440

  /** Float arithmetic, not a slack budget: the real margins here run from
   *  样张's 8.8px to hundreds, so this only absorbs the last bit of a double. */
  const EPS = 1e-9

  for (const t of TEMPLATES) {
    it(`${t.id}: the mat lies within the canvas`, () => {
      const size = resolveSize(t.canvas.ratio, LONG_EDGE)
      // The photo aspect that leaves the least room is the canvas's own.
      // `fitRect` shrinks the frame to fit, so the frame is at its tallest when
      // the photo is at least as tall as the canvas and at its widest when it
      // is at least as wide; because it is centred, every margin is
      // `(canvas - frame) / 2`. The canvas's own aspect is the one aspect that
      // maxes both dimensions at once — any narrower photo relaxes the width,
      // any wider one relaxes the height, and neither tightens the other. It is
      // also the photo the app itself is handed for a fixed ratio, since
      // `resolveSize` derives `size` from the same `aspectOf`. The sample
      // fixture would *not* do: at 640×1074 it is taller than 4:5, so it leaves
      // the horizontal margins — and any left/right overflow — untested.
      const aspect = size.W / size.H
      // k = 2 as well as k = 1: the arithmetic is scale-free today, and the
      // export is the artifact nobody looks at again — if a later change ever
      // rounds the layout box per scale, it is the export that crops first.
      for (const k of [1, 2]) {
        const box = { W: size.W * k, H: size.H * k }
        const frame = fitRect(box, aspect, t.frame.scale, 0, 0)
        const mat = matRect(frame, t.frame.mat, t.frame.matBottom, k)
        const over = {
          left: -mat.x,
          top: -mat.y,
          right: mat.x + mat.w - box.W,
          bottom: mat.y + mat.h - box.H,
        }
        const worst = Math.max(over.left, over.top, over.right, over.bottom)
        const px = (n: number) => `${n.toFixed(1)}px`
        expect(
          worst,
          `${t.id} at k=${k}: the mat (${px(mat.w)}×${px(mat.h)} at ${px(mat.x)},${px(mat.y)}) ` +
            `overflows the ${box.W}×${box.H} canvas — left ${px(over.left)}, top ${px(over.top)}, ` +
            `right ${px(over.right)}, bottom ${px(over.bottom)}. ` +
            `frame.scale ${t.frame.scale} + mat ${t.frame.mat} + matBottom ${t.frame.matBottom} cannot coexist.`,
        ).toBeLessThanOrEqual(EPS)
      }
    })
  }
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

  it('rejects NaN in a frame value', () => {
    // `typeof NaN === 'number'`, so a bare type check admits it; `fitRect` then
    // hands `drawImage` a non-finite rect and the canvas draws nothing at all
    expect(validateTemplate(corrupt((t) => { t.frame.scale = NaN }))).toEqual({
      ok: false,
      error: 'frame.scale must be finite',
    })
  })

  it('rejects Infinity in a frame value', () => {
    expect(validateTemplate(corrupt((t) => { t.frame.matBottom = Infinity }))).toEqual({
      ok: false,
      error: 'frame.matBottom must be finite',
    })
  })

  it('rejects a non-numeric background.blur', () => {
    expect(validateTemplate(corrupt((t) => { t.background.blur = '28' }))).toEqual({
      ok: false,
      error: 'background.blur must be a number',
    })
  })

  it('rejects NaN in background.darken', () => {
    expect(validateTemplate(corrupt((t) => { t.background.darken = NaN }))).toEqual({
      ok: false,
      error: 'background.darken must be finite',
    })
  })

  it('rejects NaN in background.zoom', () => {
    expect(validateTemplate(corrupt((t) => { t.background.zoom = NaN }))).toEqual({
      ok: false,
      error: 'background.zoom must be finite',
    })
  })

  it('rejects text.slots = [null]', () => {
    // the verified crash: this record passed the old gate and then threw
    // inside `drawText` at `values[slot.id]`
    expect(validateTemplate(corrupt((t) => { t.text.slots = [null] }))).toEqual({
      ok: false,
      error: 'text.slots[0] must be an object',
    })
  })

  it('rejects a non-object slot, naming its index', () => {
    expect(validateTemplate(corrupt((t) => { t.text.slots[1] = 'title' }))).toEqual({
      ok: false,
      error: 'text.slots[1] must be an object',
    })
  })

  it('rejects a slot carrying no id, naming its index', () => {
    expect(
      validateTemplate(
        corrupt((t) => { t.text.slots[1] = { size: 34, weight: 700, color: '#ffffff' } }),
      ),
    ).toEqual({ ok: false, error: 'invalid text.slots[1].id' })
  })

  it('rejects a slot whose id is not a TextSlotId', () => {
    expect(validateTemplate(corrupt((t) => { t.text.slots[0].id = 'caption' }))).toEqual({
      ok: false,
      error: 'invalid text.slots[0].id',
    })
  })

  it('rejects slots that are not an array at all', () => {
    expect(validateTemplate(corrupt((t) => { t.text.slots = 'title' }))).toEqual({
      ok: false,
      error: 'slots must be an array',
    })
  })

  it('rejects a non-boolean premium', () => {
    // spec-sheet is the built-in that actually carries `premium`
    expect(validateTemplate(corrupt((t) => { t.premium = 'no' }, 8))).toEqual({
      ok: false,
      error: 'premium must be a boolean',
    })
  })

  it('rejects a null text instead of throwing', () => {
    // `null` is the one presence value that made the validator itself throw:
    // `o.text !== undefined` admits it, then `tx.anchor` dereferences null
    expect(validateTemplate(corrupt((t) => { t.text = null }))).toEqual({
      ok: false,
      error: 'text must be an object',
    })
  })

  it('rejects a null plate instead of throwing', () => {
    expect(validateTemplate(corrupt((t) => { t.plate = null }, 8))).toEqual({
      ok: false,
      error: 'plate must be an object',
    })
  })
})

describe('validateTemplate keeps the optional blocks optional', () => {
  it('validates every built-in, by id', () => {
    expect(TEMPLATES).toHaveLength(9)
    for (const t of TEMPLATES) {
      expect(validateTemplate(t), `built-in ${t.id} must validate`).toEqual({ ok: true, value: t })
    }
  })

  it('accepts a template with no text, no plate and no premium', () => {
    const minimal = getTemplate('minimal')
    expect(minimal?.text).toBeUndefined()
    expect(validateTemplate(structuredClone(minimal))).toEqual({ ok: true, value: minimal })
  })

  it('accepts text with an empty slot list', () => {
    const t = structuredClone(TEMPLATES[0]!)
    t.text!.slots = []
    expect(validateTemplate(t)).toEqual({ ok: true, value: t })
  })

  it('accepts a solid background with no blur, darken or zoom', () => {
    // spec-sheet is the built-in that omits all three
    const t = structuredClone(TEMPLATES[8]!)
    expect(t.background.blur).toBeUndefined()
    expect(validateTemplate(t)).toEqual({ ok: true, value: t })
  })
})

describe('validateTemplate checks enum fields by membership', () => {
  it('rejects a non-member canvas.ratio', () => {
    for (const ratio of ['4:3', 45, NaN, null, {}, '']) {
      expect(validateTemplate(corrupt((t) => { t.canvas.ratio = ratio }))).toEqual({
        ok: false,
        error: 'invalid ratio',
      })
    }
  })

  it('rejects a non-member layout.kind', () => {
    for (const kind of ['mosaic', 5, null]) {
      expect(validateTemplate(corrupt((t) => { t.layout.kind = kind })).ok).toBe(false)
    }
  })

  it('rejects a non-member text.anchor', () => {
    for (const anchor of ['sideways', 9, null]) {
      expect(validateTemplate(corrupt((t) => { t.text.anchor = anchor }))).toEqual({
        ok: false,
        error: 'invalid anchor',
      })
    }
  })

  it('rejects a non-member background.mode', () => {
    for (const mode of ['blurred', 9, null]) {
      expect(validateTemplate(corrupt((t) => { t.background.mode = mode }))).toEqual({
        ok: false,
        error: 'invalid background mode',
      })
    }
  })
})
