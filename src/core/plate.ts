import type { Exif, Plate, PlateField, Rect } from './types'

/**
 * The spec plate: the photograph's own camera settings, set as a row of
 * monospace values in the mat's bottom band. This is the product's
 * differentiator — the app reads what the camera wrote, so the user types
 * nothing — and its hard part is not the drawing, it is the *absence*: most
 * photographs arrive with no EXIF at all (the social apps strip it on upload)
 * and the ones that keep it usually keep only some of it.
 *
 * So the rule the two functions here share is the one Spec §9 states as a
 * degradation: a photo with no metadata renders no plate and never errors, a
 * photo with some of it renders exactly those fields, and nothing ever draws an
 * empty band. `plateFields` is deliberately free of the canvas — it is the whole
 * decision, data in and display strings out, which is what makes that rule
 * testable without a browser.
 */

/** One field's display value, or `undefined` when the photo does not carry it.
 *  `plateFields` drops what this leaves undefined, so a missing tag costs its
 *  own run and nothing else — never a placeholder, never a blank gap. */
function valueFor(field: PlateField, exif: Exif): string | undefined {
  switch (field) {
    case 'camera':
      return exif.camera
    case 'focal':
      return exif.focal
    case 'aperture':
      return exif.aperture
    case 'shutter':
      return exif.shutter
    case 'iso':
      return exif.iso
    case 'date':
      return exif.date
  }
}

/**
 * The values the plate will print, in the template's configured order.
 *
 * Empty is a legitimate answer, not a failure: a disabled plate, a `null` exif
 * (the parser's answer for a file with no metadata, or with an EXIF segment
 * that holds nothing to caption), and a photo whose tags are all outside the
 * configured field list all land there. Every caller treats `[]` as "draw
 * nothing", which is the only way the plate can hide without leaving a mark.
 */
export function plateFields(plate: Plate, exif: Exif | null): string[] {
  if (!plate.enabled || !exif) return []
  const out: string[] = []
  for (const f of plate.fields) {
    const v = valueFor(f, exif)
    if (v) out.push(v)
  }
  return out
}

/**
 * Draws the row into `band`, or draws nothing at all.
 *
 * The band is DEVICE pixels, like the frame `render` lays the mat out in, while
 * the sizes computed here are scaled by `k` for exactly that reason — the same
 * convention `drawText` documents, and the reason `11 * k` is a cap and
 * `band.h * 0.20` is a fraction. There is no background fill: the band is the
 * white mat itself, so "no fields" is expressed by returning before the canvas
 * is touched, which is what keeps a plate-less photo byte-identical to a
 * photo-less one.
 *
 * Fields render as separate runs with a fixed gap rather than as one joined
 * string, so the row stays aligned to the band's centre even when one value is
 * long.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  exif: Exif | null,
  band: Rect,
  k: number,
): void {
  const fields = plateFields(plate, exif)
  if (fields.length === 0) return

  const size = Math.max(8, Math.min(band.h * 0.20, 11 * k))
  ctx.save()
  ctx.font = `400 ${size}px 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`
  ctx.fillStyle = plate.color
  ctx.textBaseline = 'middle'

  const gap = size * 1.8
  const widths = fields.map((f) => ctx.measureText(f).width)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (fields.length - 1)

  let x: number
  if (plate.align === 'left') {
    x = band.x + size
    ctx.textAlign = 'left'
  } else {
    x = band.x + band.w / 2 - total / 2
    ctx.textAlign = 'left'
  }
  const y = band.y + band.h / 2

  fields.forEach((f, i) => {
    ctx.fillText(f, x, y)
    x += (widths[i] ?? 0) + gap
  })

  ctx.restore()
}
