import { describe, it, expect } from 'vitest'
import { aspectOf, resolveSize } from '../../src/core/geometry'
import { frameFits, frameRect, radiusCeiling } from '../../src/core/limits'
import { TEMPLATES, getTemplate, validateTemplate } from '../../src/core/templates'
import { BACKGROUND_MODES, controlSpecs, matFillPanel, setBackgroundMode, setControl, setMatBlur, settleTemplate, type ControlContext, type ControlId } from '../../src/ui/controls'
import type { Template } from '../../src/core/types'

/**
 * 画面 — the write path, without a browser.
 *
 * The sliders are the part a user touches, and the part that can silently
 * produce a poster the renderer crops. So the claims here are about the record:
 * every control on every built-in, swept through its whole range, has to leave
 * a geometry that still fits its canvas — and the *only* thing that decides
 * that is `limits.ts`, which `tests/unit/limits.test.ts` pins against the real
 * layout. `tests/pixel/controls.spec.ts` is where the same panel is driven
 * through the DOM and checked against pixels.
 */

const LONG_EDGE = 1440

/** The context the panel is handed in the app: the canvas the wall is drawn at,
 *  and the aspect the photograph will be laid out with. `orig` aside, both
 *  derive from the template alone. */
function ctxFor(t: Template): ControlContext {
  const size = resolveSize(t.canvas.ratio, LONG_EDGE)
  return { size, aspect: aspectOf(t.canvas.ratio) }
}

const ALL: ControlId[] = ['scale', 'ox', 'oy', 'mat', 'matBottom', 'zoom', 'blur', 'darken']

/** The five the frame always has, restated rather than read off the module: a
 *  test that asked `controlSpecs` what its own first five are would pass for any
 *  five at all. */
const FRAME: ControlId[] = ['scale', 'ox', 'oy', 'radius', 'mat', 'matBottom']

/** Values to push into every control: far below, on, and far above the range,
 *  plus the two the DOM cannot produce and the record must not accept. */
const SWEEP = [0, 1, 17, 40, 66, 90, 120, 200, 1e6, -40, NaN, Infinity]

describe('controlSpecs', () => {
  it('offers the six frame controls on every template, and 后景 only where there is a 后景', () => {
    for (const t of TEMPLATES) {
      const ids = controlSpecs(t, ctxFor(t)).map((s) => s.id)
      // 后景放大/虚化/压暗 describe the photograph *as its own backdrop*, so only
      // 带背景 has them: 无背景 has no backdrop at all — 样张 ships as one, too — and
      // a slider that accepts a drag and changes nothing is the one thing a control
      // in this app is not allowed to do.
      const backdrop: ControlId[] = t.background.mode === 'blur' ? ['zoom', 'blur', 'darken'] : []
      const card: ControlId[] = ['radius', 'mat', 'matBottom']
      expect(ids, t.id).toEqual(t.background.mode === 'blur' ? [...FRAME, ...backdrop] : card)
    }
  })

  it('圆角 is 有无与大小 in one row: zero is the off state and it says so', () => {
    const t = getTemplate('classic')!
    const radius = controlSpecs(t, ctxFor(t)).find((s) => s.id === 'radius')!
    expect(radius.min).toBe(0)
    expect(radius.zero).toBe('无')
    // The ceiling is the layout's own — `roundedRect` refuses a radius past half the
    // shorter side, and a slider that offered more would have a dead top half.
    expect(radius.max).toBe(radiusCeiling(frameRect(ctxFor(t).size, ctxFor(t).aspect, t.frame.scale)))
    expect(radius.max).toBeLessThan(ctxFor(t).size.H)
    // ...and the other numbers read their unit, not a word.
    for (const s of controlSpecs(t, ctxFor(t))) if (s.id !== 'radius') expect(s.zero, s.id).toBeUndefined()
  })

  it('labels and units every control, with no duplicates', () => {
    const t = getTemplate('classic')!
    const specs = controlSpecs(t, ctxFor(t))
    for (const s of specs) {
      expect(s.label, s.id).toBeTruthy()
      expect(s.unit, s.id).toMatch(/^(%|px)$/)
      expect(Number.isFinite(s.min) && Number.isFinite(s.max), s.id).toBe(true)
      expect(s.min, s.id).toBeLessThanOrEqual(s.max)
    }
    expect(new Set(specs.map((s) => s.label)).size).toBe(specs.length)
  })

  it('reports every built-in inside the range it offers', () => {
    // A panel that shows a value outside its own slider range is a panel whose
    // thumb does not sit where the number says — and the first drag then moves
    // the poster by a step nobody asked for.
    for (const t of TEMPLATES) {
      for (const s of controlSpecs(t, ctxFor(t))) {
        expect(s.value, `${t.id}/${s.id}`).toBeGreaterThanOrEqual(s.min)
        expect(s.value, `${t.id}/${s.id}`).toBeLessThanOrEqual(s.max)
      }
    }
  })

  it('the ceilings are the layout own, not round numbers', () => {
    // The claim that ties the panel to `limits.ts`: 经典 declares no mat, so its
    // photograph may reach the full canvas; 拍立得 declares the deepest mat of the
    // 带背景 set, so its photograph may not.
    const classic = getTemplate('classic')!
    const polaroid = getTemplate('polaroid')!
    const classicScale = controlSpecs(classic, ctxFor(classic)).find((s) => s.id === 'scale')!
    const polaroidScale = controlSpecs(polaroid, ctxFor(polaroid)).find((s) => s.id === 'scale')!
    expect(classicScale.max).toBe(100)
    // 100·(1 − 2·(16+104)/1440) = 83.3 — floored, because a record settled onto
    // 83.33 would sit above a slider whose maximum is 83.
    expect(polaroidScale.max).toBe(83)

    // And a mat only ever takes room away: the same card, on the same canvas, can
    // travel further off centre without one.
    const bare = { ...polaroid, frame: { ...polaroid.frame, mat: 0, matBottom: 0 } }
    const bareOx = controlSpecs(bare, ctxFor(polaroid)).find((s) => s.id === 'ox')!
    const mattedOx = controlSpecs(polaroid, ctxFor(polaroid)).find((s) => s.id === 'ox')!
    expect(Math.abs(mattedOx.max)).toBeLessThan(Math.abs(bareOx.max))
  })
})

describe('setControl', () => {
  it('writes the value and leaves every other number alone', () => {
    const t = getTemplate('classic')!
    const next = setControl(t, 'scale', 50, ctxFor(t))
    expect(next.frame.scale).toBe(50)
    expect(next.frame).toMatchObject({ radius: t.frame.radius, mat: t.frame.mat, shadow: t.frame.shadow })
    expect(next.background).toEqual(t.background)
  })

  it('never mutates the record it was handed', () => {
    // `state.template` is usually one of the TEMPLATES singletons, and a slider
    // that wrote into one would change 经典 for the rest of the session — the
    // rail's own chip included.
    for (const t of TEMPLATES) {
      const before = JSON.stringify(t)
      for (const id of ALL) setControl(t, id, 77, ctxFor(t))
      expect(JSON.stringify(t), t.id).toBe(before)
    }
  })

  it('returns the record it was handed when the value is already there', () => {
    const t = getTemplate('classic')!
    // By reference: `main.ts` reads this as "the drag did not move anything" and
    // redraws nothing.
    expect(setControl(t, 'scale', t.frame.scale, ctxFor(t))).toBe(t)
  })

  it('refuses a non-finite value instead of writing it', () => {
    // A NaN that reached the record would be dropped by `validateTemplate` on
    // the next load, so the user's template would vanish rather than the value
    // never being written.
    const t = getTemplate('classic')!
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(setControl(t, 'scale', bad, ctxFor(t)), String(bad)).toBe(t)
    }
  })

  it('clamps to the bound it offered rather than pushing its neighbours', () => {
    const t = getTemplate('spec-sheet')!
    const spec = controlSpecs(t, ctxFor(t)).find((s) => s.id === 'mat')!
    const next = setControl(t, 'mat', 1e6, ctxFor(t))
    expect(next.frame.mat).toBe(spec.max)
    // and the photograph was not shrunk to make room for it
    expect(next.frame.scale).toBe(t.frame.scale)
    expect(next.frame.matBottom).toBe(t.frame.matBottom)
  })

  it('is a no-op for a control this template does not offer', () => {
    const flat = getTemplate('spec-sheet')!
    expect(setControl(flat, 'zoom', 180, ctxFor(flat))).toBe(flat)
    expect(setControl(flat, 'blur', 40, ctxFor(flat))).toBe(flat)
    expect(setControl(flat, 'darken', 40, ctxFor(flat))).toBe(flat)
  })

  it('leaves the geometry alone when only the 后景 moves', () => {
    const t = getTemplate('classic')!
    for (const id of ['zoom', 'blur', 'darken'] as ControlId[]) {
      const next = setControl(t, id, 55, ctxFor(t))
      expect(next.frame, id).toEqual(t.frame)
    }
  })

  it('pulls an offset back when the photograph grows into its room', () => {
    // The one clamp that cannot be local: a larger frame has less room to sit
    // off centre, so raising 前景大小 has to move 水平位置 with it.
    const t = getTemplate('classic')!
    const wide = setControl(t, 'ox', 1000, ctxFor(t))
    const maxOx = controlSpecs(wide, ctxFor(wide)).find((s) => s.id === 'ox')!.max
    expect(wide.frame.ox).toBe(maxOx)

    const bigger = setControl(wide, 'scale', 96, ctxFor(wide))
    const room = controlSpecs(bigger, ctxFor(bigger)).find((s) => s.id === 'ox')!.max
    expect(room).toBeLessThan(maxOx)
    expect(bigger.frame.ox).toBeLessThanOrEqual(room)
    expect(bigger.frame).toMatchObject({ scale: 96 })
  })
})

describe('setBackgroundMode', () => {
  it('has a look on the panel for every mode a record can hold', () => {
    const panel: string[] = BACKGROUND_MODES.map((m) => m.id)
    // Three, and exactly the three the app can deliver: a canvas with the
    // photograph on it, a canvas with nothing on it, and no canvas at all. Every
    // mode the panel can set has to be a record the validator accepts, or the write
    // would throw away the user's next saved template.
    expect(panel).toEqual(['blur', 'mount'])
    for (const id of panel) {
      const t = { ...getTemplate('classic')!, background: { mode: id } as Template['background'] }
      expect(validateTemplate(t).ok, id).toBe(true)
    }
  })

  it('offers 无背景 only the numbers that change the card', () => {
    const t = getTemplate('polaroid')!
    const mounted = setBackgroundMode(t, 'mount', ctxFor(t))
    // The delivery is the mount's own box, so the canvas follows the card: 前景大小
    // resizes the window, 水平位置/垂直位置 move it, and none of the three can
    // change the poster. 圆角, 白边 and 下白边 do — in this mode the card *is* the
    // poster, so every number that changes the card changes the file.
    expect(controlSpecs(mounted, ctxFor(t)).map((s) => s.id)).toEqual(['radius', 'mat', 'matBottom'])
    // ...and the numbers it does not offer are not writable either.
    expect(setControl(mounted, 'scale', 40, ctxFor(t))).toBe(mounted)
    expect(setControl(mounted, 'ox', 5, ctxFor(t))).toBe(mounted)
    expect(setControl(mounted, 'radius', 20, ctxFor(t)).frame.radius).toBe(20)
  })

  it('zeroes the offsets on the way into 无背景: a window cannot be off-centre inside itself', () => {
    const t = getTemplate('classic')!
    const moved = setControl(t, 'ox', 4, ctxFor(t))
    expect(moved.frame.ox).not.toBe(0)
    const mounted = setBackgroundMode(moved, 'mount', ctxFor(moved))
    // Zeroed rather than merely ignored, so `mountRect` — which reads them to place
    // the crop — has nothing to crop around, and the record never describes a
    // poster that cannot exist.
    expect(mounted.frame.ox).toBe(0)
    expect(mounted.frame.oy).toBe(0)
  })

  it('writes the mode onto a copy, and leaves the singleton alone', () => {
    const t = getTemplate('classic')!
    const next = setBackgroundMode(t, 'blur', ctxFor(t))
    const mounted = setBackgroundMode(next, 'mount', ctxFor(next))
    expect(mounted.background.mode).toBe('mount')
    expect(t.background.mode).toBe('blur')
    expect(frameFits(ctxFor(t).size, mounted.frame)).toBe(true)
  })

  it('hands back the record it was given when the mode is already on', () => {
    const t = getTemplate('classic')!
    expect(setBackgroundMode(t, 'blur', ctxFor(t))).toBe(t)
    const flat = getTemplate('spec-sheet')!
    expect(setBackgroundMode(flat, 'mount', ctxFor(flat))).toBe(flat)
  })

  it('keeps 后景放大 and 压暗 through a step out and back', () => {
    const base = getTemplate('classic')!
    const roomy: Template = {
      ...base,
      background: { ...base.background, zoom: 140, darken: 30, blur: 50 },
    }
    const flat = setBackgroundMode(roomy, 'mount', ctxFor(roomy))
    // A 无背景 record still carries what 带背景 is made of: stepping out to the
    // mount's own box and back is meant to return the backdrop you left, not a new
    // one.
    expect(flat.background).toMatchObject({ zoom: 140, darken: 30, blur: 50 })
    const back = setBackgroundMode(flat, 'blur', ctxFor(flat))
    expect(back.background).toMatchObject({ zoom: 140, darken: 30, blur: 50 })
  })

  it('invents nothing for 无背景: the poster is the card and nothing else', () => {
    const t = getTemplate('classic')!
    const mounted = setBackgroundMode(t, 'mount', ctxFor(t))
    // 无背景 draws nothing behind the mount, and needs nothing behind it. A mode
    // that quietly filled the canvas with a colour would be a mode lying about its
    // own name — and the card, cropped to itself, would carry a field it does not
    // have.
    expect(mounted.background.color).toBeUndefined()
    expect(validateTemplate(mounted).ok).toBe(true)
  })

  it('gives 虚化 a blur to be blurred by on the way in, and keeps 样张 its sheet', () => {
    const flat = getTemplate('spec-sheet')!
    expect(flat.background.mode).toBe('mount')
    // 样张's white sheet is authored (`background.color`), because its plate is
    // printed on it — and it survives the trip out and back, so the card is not
    // quietly left on an empty canvas.
    expect(flat.background.color).toBe('#FFFFFF')
    const blurred = setBackgroundMode(flat, 'blur', ctxFor(flat))
    // 虚化 on a card that carries no blur would draw a *sharp* backdrop under a
    // label that says otherwise — a control lying about what it did.
    expect(blurred.background.blur).toBeGreaterThan(0)
    // ...and the panel can then show the slider that number belongs to.
    expect(controlSpecs(blurred, ctxFor(flat)).map((s) => s.id)).toEqual([...FRAME, 'zoom', 'blur', 'darken'])
    expect(setBackgroundMode(blurred, 'mount', ctxFor(flat)).background.color).toBe('#FFFFFF')
  })

  it('and keeps the blur a record already had', () => {
    const t = getTemplate('classic')!
    const blur = t.background.blur
    const there = setBackgroundMode(setBackgroundMode(t, 'mount', ctxFor(t)), 'blur', ctxFor(t))
    expect(there.background.blur).toBe(blur)
  })

  it('settles the mount it inherited, on every built-in', () => {
    for (const t of TEMPLATES) {
      for (const id of BACKGROUND_MODES.map((m) => m.id)) {
        const next = setBackgroundMode(t, id, ctxFor(t))
        expect(frameFits(ctxFor(t).size, next.frame), `${t.id}/${id}`).toBe(true)
      }
    }
  })
})

describe('白边 in 无背景', () => {
  it('is offered only where the border is the poster’s background', () => {
    const t = getTemplate('polaroid')!
    // 带背景 draws the border on a blurred backdrop, where the same blur is a
    // border nobody can see — the failure this row refuses everywhere else.
    expect(matFillPanel(t).shown).toBe(false)
    const p = matFillPanel(setBackgroundMode(t, 'mount', ctxFor(t)))
    expect(p.shown).toBe(true)
    expect(p.enabled).toBe(true)
    expect(p.blur).toBe(false)
  })

  it('is shown but disabled where there is no border to fill', () => {
    const t = getTemplate('classic')!
    const p = matFillPanel(setBackgroundMode(t, 'mount', ctxFor(t)))
    // Drawn rather than hidden: raising 白边 from 0 is a slider drag, and
    // `syncMatFill` is what turns the row live without rebuilding the panel under
    // the pointer.
    expect(p.shown).toBe(true)
    expect(p.enabled).toBe(false)
  })

  it('writes the flag on a copy, and hands back the record it was given', () => {
    const t = getTemplate('polaroid')!
    const on = setMatBlur(t, true, ctxFor(t))
    expect(on.frame.matBlur).toBe(true)
    expect(t.frame.matBlur).toBeUndefined()
    expect(setMatBlur(on, true, ctxFor(on))).toBe(on)
    expect(validateTemplate(on).ok).toBe(true)
    expect(matFillPanel(on).blur).toBe(true)
  })

  it('keeps the flag through the modes where the row is not drawn', () => {
    const t = getTemplate('spec-sheet')!
    const on = setMatBlur(t, true, ctxFor(t))
    const blurred = setBackgroundMode(on, 'blur', ctxFor(on))
    expect(matFillPanel(blurred).shown).toBe(false)
    expect(setBackgroundMode(blurred, 'mount', ctxFor(blurred)).frame.matBlur).toBe(true)
  })

  it('is refused by the validator unless it is a boolean', () => {
    const t = getTemplate('polaroid')!
    const corrupt = { ...t, frame: { ...t.frame, matBlur: 'false' } }
    expect(validateTemplate(corrupt)).toEqual({ ok: false, error: 'frame.matBlur must be a boolean' })
  })
})

describe('every control, on every built-in, over its whole range', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: the record still fits its canvas`, () => {
      const ctx = ctxFor(t)
      for (const id of ALL) {
        for (const raw of SWEEP) {
          const next = setControl(t, id, raw, ctx)
          const label = `${t.id}/${id} ← ${raw}`
          expect(validateTemplate(next).ok, `${label} produced an invalid record`).toBe(true)
          expect(
            frameFits(ctx.size, next.frame),
            `${label} produced a mount that does not fit ${ctx.size.W}×${ctx.size.H}`,
          ).toBe(true)
          // and the panel it produces is well-formed for the next drag
          for (const s of controlSpecs(next, ctx)) {
            expect(s.min, `${label} → ${s.id}.min`).toBeLessThanOrEqual(s.max)
            expect(Number.isFinite(s.value), `${label} → ${s.id}.value`).toBe(true)
          }
        }
      }
    })
  }

  it('fills the whole panel with extreme moves and the poster still fits', () => {
    // One control at a time is the easy case; a user pushes every slider to its
    // end. Each move is clamped against the *current* record, so a sequence can
    // only walk the record around inside the feasible region.
    for (const t of TEMPLATES) {
      const ctx = ctxFor(t)
      let cur = t
      for (const id of ALL) {
        for (const extreme of [1e6, -1e6, 1e6, -1e6]) {
          const next = setControl(cur, id, extreme, ctx)
          expect(
            frameFits(ctx.size, next.frame),
            `${t.id}: pushing ${id} to ${extreme} left scale ${next.frame.scale}, mat ${next.frame.mat}, ` +
              `matBottom ${next.frame.matBottom}, ox ${next.frame.ox}, oy ${next.frame.oy}`,
          ).toBe(true)
          cur = next
        }
      }
    }
  })
})

describe('settleTemplate', () => {
  it('is the identity for a record that already fits', () => {
    for (const t of TEMPLATES) {
      expect(settleTemplate(t, ctxFor(t)), t.id).toBe(t)
    }
  })

  it('lowers the scale until a too-deep mat fits, and keeps the mat', () => {
    const t = getTemplate('classic')!
    const greedy: Template = { ...t, frame: { ...t.frame, scale: 95, mat: 120, matBottom: 0 } }
    const settled = settleTemplate(greedy, ctxFor(t))
    expect(settled.frame.mat).toBe(120)
    expect(settled.frame.scale).toBeLessThan(95)
    expect(frameFits(ctxFor(t).size, settled.frame)).toBe(true)
  })

  it('clamps offsets that a record arrived with', () => {
    const t = getTemplate('classic')!
    const runaway: Template = { ...t, frame: { ...t.frame, ox: 400, oy: -400 } }
    const settled = settleTemplate(runaway, ctxFor(t))
    const bounds = controlSpecs(settled, ctxFor(t))
    const ox = bounds.find((s) => s.id === 'ox')!
    const oy = bounds.find((s) => s.id === 'oy')!
    expect(settled.frame.ox).toBe(ox.max)
    expect(settled.frame.oy).toBe(oy.min)
  })

  it('is idempotent', () => {
    const t = getTemplate('polaroid')!
    const messy: Template = { ...t, frame: { ...t.frame, scale: 99, mat: 200, matBottom: 200, ox: 999 } }
    const once = settleTemplate(messy, ctxFor(t))
    expect(settleTemplate(once, ctxFor(t))).toBe(once)
  })
})
