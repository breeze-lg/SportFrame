import type { Exif, Plate, PlateField, Rect } from './types'

/**
 * The spec plate: the photograph's own camera settings, set as a caption in the
 * mat's bottom band. This is the product's differentiator — the app reads what
 * the camera wrote, so the user types nothing — and its hard part is not the
 * drawing, it is the *absence*: most photographs arrive with no EXIF at all
 * (the social apps strip it on upload) and the ones that keep it usually keep
 * only some of it.
 *
 * So the rule these functions share is the one Spec §9 states as a degradation:
 * a photo with no metadata renders no plate and never errors, a photo with some
 * of it renders exactly those fields, and nothing ever draws an empty band.
 * `plateFields` and `plateLines` are deliberately free of the canvas — they are
 * the whole decision, data in and display strings out, which is what makes that
 * rule testable without a browser.
 *
 * The shape of the plate is a camera's own watermark: the model on its own line,
 * the exposure in smaller type under it. That is why the plate reads its fields
 * as *data* rather than as one list of strings — line breaks are a decision
 * about which field means what, and a list of values has already thrown that
 * away.
 */

/** One field's display value, or `undefined` when the photo does not carry it.
 *  The line builders drop what this leaves undefined, so a missing tag costs
 *  its own run and nothing else — never a placeholder, never a blank gap. */
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

/** One value the plate will print, and which field it came from. */
export type PlateValue = { id: PlateField; value: string }

/**
 * The values the plate will print, in the template's configured order, tagged
 * with the field each one came from.
 *
 * Empty is a legitimate answer, not a failure: a disabled plate, a `null` exif
 * (the parser's answer for a file with no metadata, or with an EXIF segment
 * that holds nothing to caption), and a photo whose tags are all outside the
 * configured field list all land there. Every caller treats `[]` as "draw
 * nothing", which is the only way the plate can hide without leaving a mark.
 */
export function plateValues(plate: Plate, exif: Exif | null): PlateValue[] {
  if (!plate.enabled || !exif) return []
  const out: PlateValue[] = []
  for (const f of plate.fields) {
    const v = valueFor(f, exif)
    if (v) out.push({ id: f, value: v })
  }
  return out
}

/** The values alone, in order — the flat form the console and the dev handles
 *  read. `plateValues` is the one that knows what each of them is. */
export function plateFields(plate: Plate, exif: Exif | null): string[] {
  return plateValues(plate, exif).map((v) => v.value)
}

/**
 * The plate as it is drawn: the camera on the first line, the rest under it.
 *
 * Two lines only when there is something for both. A plate configured without
 * `camera` — or a photograph whose EXIF carries a camera and nothing else —
 * draws one line, because a headline with no detail under it is a value with
 * nothing to say it is a headline, and a blank second line would be the empty
 * band this file exists to never draw.
 */
export function plateLines(plate: Plate, exif: Exif | null): string[][] {
  const values = plateValues(plate, exif)
  if (values.length === 0) return []
  const camera = values.filter((v) => v.id === 'camera').map((v) => v.value)
  const rest = values.filter((v) => v.id !== 'camera').map((v) => v.value)
  if (camera.length === 0 || rest.length === 0) return [values.map((v) => v.value)]
  return [camera, rest]
}

/** The plate's typeface, mono like every other value the app reads out. The
 *  headline's weight is the whole of how the two lines are told apart. */
function font(size: number, weight: number): string {
  return `${weight} ${size}px 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`
}

/**
 * Draws the plate into `band`, or draws nothing at all.
 *
 * The band is DEVICE pixels, like the frame `render` lays the mat out in, while
 * the sizes computed here are scaled by `k` for exactly that reason — the same
 * convention `drawText` documents, and the reason `15 * k` is a cap and
 * `band.h * 0.26` is a fraction. There is no background fill: the band is the
 * white mat itself, so "no fields" is expressed by returning before the canvas
 * is touched, which is what keeps a plate-less photo byte-identical to a
 * photo-less one.
 *
 * A band too shallow for two lines gets one, joined, at the single-line size —
 * the old layout, kept as the fallback rather than as a special case. Two lines
 * need `head + 1.9·detail` of height; below that the stack would overflow the
 * band it was handed and print over the mat's edge, which is worse than a
 * caption on one line.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  exif: Exif | null,
  band: Rect,
  k: number,
): void {
  const lines = plateLines(plate, exif)
  if (lines.length === 0) return

  const head = Math.max(9, Math.min(band.h * 0.28, 18 * k))
  const detail = Math.max(8, Math.min(band.h * 0.19, 13 * k))
  const stacked = lines.length > 1 && band.h >= head + detail * 1.9

  const rows: string[] = stacked
    ? lines.map((line) => line.join('   '))
    : [lines.flat().join('   ')]
  // One line is drawn at the detail size, whatever it holds: it is the
  // exposure values with no camera above them, and type that grew to the
  // headline size would be claiming a prominence the plate has not got.
  const sizes = stacked ? [head, detail] : [detail]
  // Between the lines, and the reason a stack reads as a headline and a detail
  // rather than as two lines of equal weight.
  const gap = detail * 0.5

  ctx.save()
  ctx.fillStyle = plate.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const block = sizes.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)
  // The block is centred in the band; the refactor that made it a block is why
  // the single-line case is still one `y`.
  let y = band.y + band.h / 2 - block / 2

  rows.forEach((text, i) => {
    const size = sizes[i] ?? sizes[0] ?? detail
    ctx.font = font(size, stacked && i === 0 ? 600 : 400)
    const width = ctx.measureText(text).width
    // `align: 'left'` insets from the band's own left wall by a share of the
    // band, so the caption holds its margin whatever the poster's width is —
    // with the size as a floor, because a thin band's 5% is not a margin.
    const x =
      plate.align === 'left'
        ? band.x + Math.max(size, band.w * 0.05)
        : band.x + band.w / 2 - width / 2
    ctx.fillText(text, x, y + size / 2)
    y += size + gap
  })

  ctx.restore()
}
