import type { Ratio, Template, TextAnchor, TextSlotId } from './types'

const RATIOS: Ratio[] = ['4:5', '1:1', '3:2', '16:9', '9:16', 'orig']
const ANCHORS: TextAnchor[] = ['top', 'bottom', 'center', 'mat']
const SLOT_IDS: TextSlotId[] = ['title', 'sub', 'sign']

export type Validation = { ok: true; value: Template } | { ok: false; error: string }

/**
 * The gate in front of every template that did not come from this file — the
 * custom ones restored from `localStorage` in Task 13 fit that description, and
 * a hand-edited or half-written record must not reach the renderer. Checks the
 * fields the renderer dereferences without a guard; anything optional is only
 * checked when present, so a minimal record is still valid.
 *
 * Numbers must be *finite*: `typeof NaN === 'number'`, so a NaN that got past
 * the type check would sail through `fitRect` and `drawImage` as a blank
 * poster. `text.slots[]` is checked element by element because `drawText`
 * reads `slot.id` off every entry it iterates — a `null` there is a
 * `TypeError` at render time, not a cosmetic flaw.
 */
export function validateTemplate(t: unknown): Validation {
  if (typeof t !== 'object' || t === null) return { ok: false, error: 'not an object' }
  const o = t as Record<string, unknown>

  if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'missing id' }
  if (typeof o.name !== 'string' || !o.name) return { ok: false, error: 'missing name' }
  // optional: absent is fine, but a number in a copy's line is a `[object
  // Object]` under the poster rather than a sentence, so a present one has to
  // be a string
  if (o.tagline !== undefined && typeof o.tagline !== 'string') {
    return { ok: false, error: 'tagline must be a string' }
  }
  // optional: absent is fine, but `'no'` and `0` are not booleans and both
  // read the wrong way round at the entitlement gate
  if (o.premium !== undefined && typeof o.premium !== 'boolean') {
    return { ok: false, error: 'premium must be a boolean' }
  }

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
  if (!bg || !['blur', 'mount'].includes(bg.mode as string)) {
    return { ok: false, error: 'invalid background mode' }
  }
  // optional: a `mount` template legitimately omits all three
  for (const key of ['blur', 'darken', 'zoom']) {
    const v = bg[key]
    if (v === undefined) continue
    if (typeof v !== 'number') return { ok: false, error: `background.${key} must be a number` }
    if (!Number.isFinite(v)) return { ok: false, error: `background.${key} must be finite` }
  }
  // The sheet 样张 lays its photograph on, and the one place `color` is read. A
  // control never writes it; refused rather than repaired when it is not
  // `#rrggbb`, because `fillStyle` *ignores* a value it cannot parse and keeps the
  // last one — an unvalidated colour is a poster silently painted in whatever was
  // set before it.
  if (bg.color !== undefined) {
    if (typeof bg.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(bg.color)) {
      return { ok: false, error: 'background.color must be #rrggbb' }
    }
  }

  const f = o.frame as Record<string, unknown> | undefined
  if (!f) return { ok: false, error: 'missing frame' }
  for (const key of ['scale', 'radius', 'mat', 'matBottom', 'shadow']) {
    if (typeof f[key] !== 'number') return { ok: false, error: `frame.${key} must be a number` }
    if (!Number.isFinite(f[key])) return { ok: false, error: `frame.${key} must be finite` }
  }
  // optional, unlike the five above: a record written before the 画面 panel
  // existed carries no offset, and absent means centred — which is what it
  // drew. A NaN that *is* present still has to be refused, for the reason the
  // loop above refuses one: `fitRect` would hand `drawImage` a non-finite rect.
  for (const key of ['ox', 'oy']) {
    const v = f[key]
    if (v === undefined) continue
    if (typeof v !== 'number') return { ok: false, error: `frame.${key} must be a number` }
    if (!Number.isFinite(v)) return { ok: false, error: `frame.${key} must be finite` }
  }
  // 白边's surface. Optional like the offsets — every record written before it
  // existed has no such field and means paper white — but a *present* value has to
  // be a boolean, because `render` reads it as `matBlur && backgroundSource`: a
  // string `'false'` would draw the blurred border it says it is not.
  if (f.matBlur !== undefined && typeof f.matBlur !== 'boolean') {
    return { ok: false, error: 'frame.matBlur must be a boolean' }
  }

  if (o.text !== undefined) {
    const tx = o.text as Record<string, unknown> | null
    if (typeof tx !== 'object' || tx === null) return { ok: false, error: 'text must be an object' }
    if (!ANCHORS.includes(tx.anchor as TextAnchor)) return { ok: false, error: 'invalid anchor' }
    // optional, like the frame's offsets: a record written before the 文字 panel
    // could move a block has none, and absent means on its anchor — which is what
    // it drew. A NaN that *is* present still has to be refused: the block would
    // land nowhere at all.
    for (const key of ['dx', 'dy']) {
      const v = tx[key]
      if (v === undefined) continue
      if (typeof v !== 'number') return { ok: false, error: `text.${key} must be a number` }
      if (!Number.isFinite(v)) return { ok: false, error: `text.${key} must be finite` }
    }
    if (!Array.isArray(tx.slots)) return { ok: false, error: 'slots must be an array' }
    // `drawText` reads `slot.id` off every element without a guard, so a bare
    // `null` here is the one malformed record that crashes rather than
    // degrades. Name the offending index: a slot list is long enough that
    // "invalid text" would leave the developer counting entries by hand.
    for (let i = 0; i < tx.slots.length; i++) {
      const slot = tx.slots[i] as Record<string, unknown> | null
      if (typeof slot !== 'object' || slot === null) {
        return { ok: false, error: `text.slots[${i}] must be an object` }
      }
      if (!SLOT_IDS.includes(slot.id as TextSlotId)) {
        return { ok: false, error: `invalid text.slots[${i}].id` }
      }
      // an unknown family id is not an error — `stackOf` answers the system
      // stack for anything it does not know, on purpose, because a record may
      // come from a build with more fonts than this one
      if (slot.family !== undefined && typeof slot.family !== 'string') {
        return { ok: false, error: `text.slots[${i}].family must be a string` }
      }
    }
  }

  if (o.plate !== undefined) {
    const p = o.plate as Record<string, unknown> | null
    if (typeof p !== 'object' || p === null) return { ok: false, error: 'plate must be an object' }
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
 * `polaroid`, `postcard` and `spec-sheet` anchor their text to `'mat'`, the
 * white band below the photograph: `drawText` places a slot at 62% of
 * `frame.matBottom` when the template carries a bottom mat, and falls through
 * to `'bottom'` when it carries none. `tests/pixel/mat-anchor.spec.ts` is where
 * that geometry is pinned, including which anchor a matless template gets.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: '经典',
    tagline: '照片压在虚化的自己上，四周收一圈白',
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
    tagline: '厚下边，一次成像的即时感',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 36, darken: 14, zoom: 134 },
    frame: { scale: 64, radius: 0, mat: 16, matBottom: 104, shadow: 38 },
    // 手写体: a polaroid's caption is written on it with a pen, and the app
    // should say so with the one face that means that. Every other style keeps
    // its body face and lets the user pick — see the 文字 panel.
    text: {
      anchor: 'mat',
      slots: [{ id: 'title', size: 26, weight: 400, color: '#2b2b2b', family: 'hanzipen' }],
    },
  },
  {
    id: 'magazine',
    name: '杂志封面',
    tagline: '顶上一个大标题，封面感',
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
    tagline: '16:9 宽银幕，底子压暗',
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
    tagline: '3:2 横构图，下面一条白边写一句',
    layout: { kind: 'single' },
    canvas: { ratio: '3:2' },
    background: { mode: 'blur', blur: 40, darken: 12, zoom: 126 },
    frame: { scale: 72, radius: 2, mat: 18, matBottom: 74, shadow: 30 },
    // 楷体, for the same reason: a postcard is written by hand.
    text: {
      anchor: 'mat',
      slots: [{ id: 'title', size: 28, weight: 400, color: '#333333', family: 'kaiti' }],
    },
  },
  {
    id: 'minimal',
    name: '留白',
    tagline: '圆角相纸，一个字也不写',
    layout: { kind: 'single' },
    canvas: { ratio: '1:1' },
    background: { mode: 'blur', blur: 48, darken: 6, zoom: 126 },
    frame: { scale: 56, radius: 26, mat: 0, matBottom: 0, shadow: 20 },
  },
  {
    id: 'square',
    name: '社媒方形',
    tagline: '方幅，铺满信息流',
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
    tagline: '9:16 竖屏，标题压在画面底',
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
    tagline: '白卡纸，相机参数印在下面',
    premium: true,
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'mount', color: '#FFFFFF' },
    // `scale` is not free: `matRect` grows the frame by `mat` on three sides and
    // by `mat + matBottom` below, so the card fits its canvas only while
    // `mat + matBottom ≤ H·(1 - scale/100)/2`. This template carries the deepest
    // mat in the set (86 + 150 = 236) and at 78 needed 2145px of canvas where
    // the app renders 1440 — its bottom edge, and the plate laid out in it, fell
    // off the poster. 66 leaves 8.8px of slack at 1440 and keeps the mock's
    // proportions; `tests/unit/templates.test.ts` is the guard that says so.
    frame: { scale: 66, radius: 0, mat: 86, matBottom: 150, shadow: 0 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 24, weight: 400, color: '#1C1B18' }] },
    plate: {
      enabled: true,
      // The camera first, then the exposure: `drawPlate` puts the one field
      // that is a name on its own line above the values, which is the shape a
      // camera's own watermark uses and the reason this list is not in the
      // order the numbers are read in. `camera` is 样张's only chance to print
      // it — the other eight templates carry no plate at all.
      fields: ['camera', 'focal', 'aperture', 'shutter', 'iso'],
      color: '#3A3833',
      // Left, not centre: the spec plate is a caption, and a caption is read
      // from its own left margin. Centring it also made the band unavailable
      // for anything else (see `drawPlate`).
      align: 'left',
    },
  },
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
