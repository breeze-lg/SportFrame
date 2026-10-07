import type { Ratio, Template, TextAnchor } from './types'

const RATIOS: Ratio[] = ['4:5', '1:1', '3:2', '16:9', '9:16', 'orig']
const ANCHORS: TextAnchor[] = ['top', 'bottom', 'center', 'mat']

export type Validation = { ok: true; value: Template } | { ok: false; error: string }

/**
 * The gate in front of every template that did not come from this file — the
 * custom ones restored from `localStorage` in Task 13 fit that description, and
 * a hand-edited or half-written record must not reach the renderer. Checks the
 * fields the renderer dereferences without a guard; anything optional is only
 * checked when present, so a minimal record is still valid.
 */
export function validateTemplate(t: unknown): Validation {
  if (typeof t !== 'object' || t === null) return { ok: false, error: 'not an object' }
  const o = t as Record<string, unknown>

  if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'missing id' }
  if (typeof o.name !== 'string' || !o.name) return { ok: false, error: 'missing name' }

  const layout = o.layout as Record<string, unknown> | undefined
  if (!layout || typeof layout.kind !== 'string') return { ok: false, error: 'missing layout' }
  if (!['single', 'split', 'grid'].includes(layout.kind)) {
    return { ok: false, error: 'unknown layout kind' }
  }

  const canvas = o.canvas as Record<string, unknown> | undefined
  if (!canvas || !RATIOS.includes(canvas.ratio as Ratio)) {
    return { ok: false, error: 'invalid ratio' }
  }

  const bg = o.background as Record<string, unknown> | undefined
  if (!bg || !['blur', 'solid', 'none'].includes(bg.mode as string)) {
    return { ok: false, error: 'invalid background mode' }
  }

  const f = o.frame as Record<string, unknown> | undefined
  if (!f) return { ok: false, error: 'missing frame' }
  for (const key of ['scale', 'radius', 'mat', 'matBottom', 'shadow']) {
    if (typeof f[key] !== 'number') return { ok: false, error: `frame.${key} must be a number` }
  }

  if (o.text !== undefined) {
    const tx = o.text as Record<string, unknown>
    if (!ANCHORS.includes(tx.anchor as TextAnchor)) return { ok: false, error: 'invalid anchor' }
    if (!Array.isArray(tx.slots)) return { ok: false, error: 'slots must be an array' }
  }

  if (o.plate !== undefined) {
    const p = o.plate as Record<string, unknown>
    if (typeof p.enabled !== 'boolean') return { ok: false, error: 'plate.enabled must be boolean' }
    if (!Array.isArray(p.fields)) return { ok: false, error: 'plate.fields must be an array' }
  }

  return { ok: true, value: t as Template }
}

/**
 * Every layout is `{ kind: 'single' }` on purpose. `Layout` also declares
 * `split` and `grid`, but `render` draws one photo and ignores `template.layout`
 * entirely — collage is spec stages 5-6 and out of this plan's scope — so a
 * collage record here would silently render as a single-photo poster.
 *
 * `polaroid`, `postcard` and `spec-sheet` anchor their text to `'mat'`, which
 * `drawText` does not implement yet. Task 12 adds the geometry and the test
 * that proves it; declaring the anchor now is how these records say what they
 * are meant to look like.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: '经典',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 28, darken: 30, zoom: 118 },
    frame: { scale: 72, radius: 8, mat: 0, matBottom: 0, shadow: 45 },
    text: {
      anchor: 'bottom',
      slots: [
        { id: 'sub', size: 14, weight: 500, color: '#ffffff' },
        { id: 'title', size: 34, weight: 700, color: '#ffffff', stroke: true },
      ],
    },
  },
  {
    id: 'polaroid',
    name: '拍立得',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 36, darken: 14, zoom: 134 },
    frame: { scale: 64, radius: 0, mat: 16, matBottom: 104, shadow: 38 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 26, weight: 400, color: '#2b2b2b' }] },
  },
  {
    id: 'magazine',
    name: '杂志封面',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 46, darken: 54, zoom: 130 },
    frame: { scale: 58, radius: 0, mat: 0, matBottom: 0, shadow: 24 },
    text: {
      anchor: 'top',
      slots: [
        { id: 'title', size: 46, weight: 700, color: '#ffffff', stroke: true },
        { id: 'sub', size: 19, weight: 500, color: '#ffffff' },
      ],
    },
  },
  {
    id: 'cinema',
    name: '电影感',
    layout: { kind: 'single' },
    canvas: { ratio: '16:9' },
    background: { mode: 'blur', blur: 62, darken: 64, zoom: 148 },
    frame: { scale: 62, radius: 4, mat: 0, matBottom: 0, shadow: 55 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 24, weight: 500, color: '#f4f2ee' }],
    },
  },
  {
    id: 'postcard',
    name: '明信片',
    layout: { kind: 'single' },
    canvas: { ratio: '3:2' },
    background: { mode: 'blur', blur: 40, darken: 12, zoom: 126 },
    frame: { scale: 72, radius: 2, mat: 18, matBottom: 74, shadow: 30 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 28, weight: 400, color: '#333333' }] },
  },
  {
    id: 'minimal',
    name: '留白',
    layout: { kind: 'single' },
    canvas: { ratio: '1:1' },
    background: { mode: 'blur', blur: 48, darken: 6, zoom: 126 },
    frame: { scale: 56, radius: 26, mat: 0, matBottom: 0, shadow: 20 },
  },
  {
    id: 'square',
    name: '社媒方形',
    layout: { kind: 'single' },
    canvas: { ratio: '1:1' },
    background: { mode: 'blur', blur: 30, darken: 32, zoom: 120 },
    frame: { scale: 78, radius: 10, mat: 0, matBottom: 0, shadow: 44 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 32, weight: 700, color: '#ffffff', stroke: true }],
    },
  },
  {
    id: 'story',
    name: '竖版故事',
    layout: { kind: 'single' },
    canvas: { ratio: '9:16' },
    background: { mode: 'blur', blur: 34, darken: 36, zoom: 132 },
    frame: { scale: 60, radius: 14, mat: 0, matBottom: 0, shadow: 40 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 30, weight: 700, color: '#ffffff', stroke: true }],
    },
  },
  {
    id: 'spec-sheet',
    name: '样张',
    premium: true,
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'solid', color: '#FFFFFF' },
    frame: { scale: 78, radius: 0, mat: 86, matBottom: 150, shadow: 0 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 24, weight: 400, color: '#1C1B18' }] },
    plate: {
      enabled: true,
      fields: ['focal', 'aperture', 'shutter', 'iso'],
      color: '#3A3833',
      align: 'center',
    },
  },
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
