import { describe, it, expect } from 'vitest'
import { aspectOf, resolveSize } from '../../src/core/geometry'
import { frameFits } from '../../src/core/limits'
import { TEMPLATES, getTemplate, validateTemplate } from '../../src/core/templates'
import { controlSpecs, setControl, settleTemplate, type ControlContext, type ControlId } from '../../src/ui/controls'
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

/** Values to push into every control: far below, on, and far above the range,
 *  plus the two the DOM cannot produce and the record must not accept. */
const SWEEP = [0, 1, 17, 40, 66, 90, 120, 200, 1e6, -40, NaN, Infinity]

describe('controlSpecs', () => {
  it('offers the five frame controls on every template, and 后景 only where there is a 后景', () => {
    for (const t of TEMPLATES) {
      const ids = controlSpecs(t, ctxFor(t)).map((s) => s.id)
      const base = ['scale', 'ox', 'oy', 'mat', 'matBottom']
      // 样张 paints a flat white card: 后景放大/虚化/压暗 would accept a drag
      // and change nothing, which is the one thing a control in this app is not
      // allowed to do.
      const expected = t.background.mode === 'blur' ? [...base, 'zoom', 'blur', 'darken'] : base
      expect(ids, t.id).toEqual(expected)
    }
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
    // photograph may reach the full canvas; 样张 declares the deepest mat in the
    // set, so its photograph may not.
    const classic = getTemplate('classic')!
    const specSheet = getTemplate('spec-sheet')!
    const classicScale = controlSpecs(classic, ctxFor(classic)).find((s) => s.id === 'scale')!
    const specScale = controlSpecs(specSheet, ctxFor(specSheet)).find((s) => s.id === 'scale')!
    expect(classicScale.max).toBe(100)
    // 1440·(1 − 2·236/1440) = 67.2 — the number `TEMPLATES` writes out in prose.
    expect(specScale.max).toBe(67)

    // And a matted frame cannot travel as far off centre as a bare one.
    const bareOx = controlSpecs(classic, ctxFor(classic)).find((s) => s.id === 'ox')!
    const mattedOx = controlSpecs(specSheet, ctxFor(specSheet)).find((s) => s.id === 'ox')!
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
