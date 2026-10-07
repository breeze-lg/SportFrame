import type { Exif } from './types'

/**
 * The EXIF reader behind the spec plate: a walk from SOI to the APP1
 * "Exif\0\0" segment, then through the TIFF IFD tables inside it, pulling out
 * the handful of settings the caption prints. Hand-written and dependency-free
 * on purpose — `src/core/` must stay importable from anywhere.
 *
 * The contract that carries the weight here is the failure mode, not any single
 * value. A PNG handed over with a .jpg name, a half-downloaded file, an EXIF
 * segment that stops mid-rational: all of them return null, none of them throw,
 * and a file that carries only some of the tags yields only those tags. Spec §9
 * asks for exactly that — a photo with no metadata hides the plate and never
 * errors — so `null` is a documented answer, not a fallback of last resort.
 */

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_DATETIME = 0x0132           // DateTime: when the file was last written
const TAG_DATETIME_ORIGINAL = 0x9003  // DateTimeOriginal: when the frame was shot
const TAG_EXIF_IFD = 0x8769
const TAG_FOCAL = 0xa405          // FocalLengthIn35mmFilm
const TAG_FOCAL_RAW = 0x920a      // FocalLength
const TAG_FNUMBER = 0x829d        // FNumber
const TAG_APERTURE = 0x9202       // ApertureValue (APEX)
const TAG_EXPOSURE = 0x829a       // ExposureTime
const TAG_SHUTTER_APEX = 0x9201   // ShutterSpeedValue (APEX)
const TAG_ISO = 0x8827

/** Every offset in an IFD entry is TIFF-relative, so `tiffStart` rides along. */
type Reader = { view: DataView; le: boolean; tiffStart: number }

/**
 * `f/2.8`, but `f/16` — a whole stop is written without a decimal, which is the
 * convention every aperture ring and lens barrel follows and the one the spec
 * plate is read against. `toFixed(1)` alone prints `f/16.0` for a camera that
 * stored `FNumber` 16/1, and a caption is the one place nobody can ignore it:
 * the plate prints these strings verbatim, in the exported poster.
 *
 * Exported because it *is* that decision, and the decision has two outcomes —
 * a whole stop and a fractional one — which the file-level tests can only reach
 * one of each (`with-exif.jpg` stores `FNumber` 15/1, and no fixture carries a
 * fractional aperture). Both are pinned directly in `tests/unit/exif.test.ts`.
 */
export function formatAperture(v: number): string {
  return `f/${v.toFixed(1).replace(/\.0$/, '')}`
}

function u16(r: Reader, off: number): number {
  return r.view.getUint16(r.tiffStart + off, r.le)
}
function u32(r: Reader, off: number): number {
  return r.view.getUint32(r.tiffStart + off, r.le)
}
function i32(r: Reader, off: number): number {
  return r.view.getInt32(r.tiffStart + off, r.le)
}

/** TIFF type 5 (RATIONAL) and type 10 (SRATIONAL) share a layout — two 32-bit
 *  halves — so the type is the only thing that says whether 0xFFFFFFFF means
 *  -1 or 4294967295. It decides more than it looks: `ShutterSpeedValue` is
 *  SRATIONAL and APEX runs negative for any exposure over a second, so a 2 s
 *  frame stores Tv = -1. Read as unsigned that is 4294967295, `2 ** -4294967295`
 *  is 0, and the caption prints `1/Infinity` for a perfectly ordinary long
 *  exposure — conforming data, not corruption. */
function rational(r: Reader, valueOffset: number, type: number): number | null {
  const signed = type === 10
  const num = signed ? i32(r, valueOffset) : u32(r, valueOffset)
  const den = signed ? i32(r, valueOffset + 4) : u32(r, valueOffset + 4)
  if (den === 0) return null
  return num / den
}

function readTagValue(r: Reader, entry: number): { tag: number; type: number; count: number; valueOffset: number } {
  const tag = u16(r, entry)
  const type = u16(r, entry + 2)
  const count = u32(r, entry + 4)
  const valueOffset = entry + 8
  return { tag, type, count, valueOffset }
}

/** ASCII tags: a value of up to 4 bytes sits inside the entry, anything longer
 *  is a pointer to it. Either way the string stops at the first NUL. */
function ascii(r: Reader, entry: number, count: number): string {
  const size = count
  const off = size <= 4 ? entry + 8 : u32(r, entry + 8)
  let s = ''
  for (let i = 0; i < count; i++) {
    const c = r.view.getUint8(r.tiffStart + off + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}

/**
 * Collect one IFD's entries into `tags` — first writer wins, so IFD0 outranks
 * the Exif IFD on a tag they both carry — and hand back the next-IFD link the
 * table ends with. Anything implausible (an entry count that would walk off the
 * end, an offset outside the buffer) collects nothing and reports no link; the
 * caller decides whether what it got is worth returning.
 */
function scanIfd(r: Reader, ifdOffset: number, into: Map<number, { type: number; count: number; entry: number }>): number {
  if (ifdOffset + 2 > r.view.byteLength - r.tiffStart) return 0
  const count = u16(r, ifdOffset)
  if (count > 512) return 0
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12
    if (entry + 12 > r.view.byteLength - r.tiffStart) break
    const { tag, type, count: c } = readTagValue(r, entry)
    if (!into.has(tag)) into.set(tag, { type, count: c, entry })
  }
  const nextPtr = ifdOffset + 2 + count * 12
  if (nextPtr + 4 > r.view.byteLength - r.tiffStart) return 0
  return u32(r, nextPtr)
}

export function readExif(buf: ArrayBuffer): Exif | null {
  try {
    const view = new DataView(buf)
    if (view.byteLength < 16) return null
    if (view.getUint16(0, false) !== 0xffd8) return null

    // walk JPEG segments to APP1/Exif
    let off = 2
    let tiffStart = -1
    while (off + 4 <= view.byteLength) {
      if (view.getUint8(off) !== 0xff) return null
      const marker = view.getUint8(off + 1)
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      if (marker === 0xda || marker === 0xd9) break
      const size = view.getUint16(off + 2, false)
      if (size < 2) return null

      if (marker === 0xe1) {
        const tagOff = off + 4
        if (tagOff + 6 > view.byteLength) return null
        // "Exif\0\0"
        if (
          view.getUint8(tagOff) === 0x45 &&
          view.getUint8(tagOff + 1) === 0x78 &&
          view.getUint8(tagOff + 2) === 0x69 &&
          view.getUint8(tagOff + 3) === 0x66
        ) {
          tiffStart = tagOff + 6
          break
        }
      }
      off += 2 + size
    }

    if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return null

    const byteOrder = view.getUint16(tiffStart, false)
    const le = byteOrder === 0x4949
    if (!le && byteOrder !== 0x4d4d) return null

    const r: Reader = { view, le, tiffStart }
    if (u16(r, 2) !== 0x002a) return null
    const ifd0 = u32(r, 4)

    const tags = new Map<number, { type: number; count: number; entry: number }>()
    const nextIfdOffset = scanIfd(r, ifd0, tags)

    const exifIfdTag = tags.get(TAG_EXIF_IFD)
    if (exifIfdTag) {
      const ptr = u32(r, exifIfdTag.entry + 8)
      scanIfd(r, ptr, tags)
    } else if (nextIfdOffset) {
      // No Exif-IFD tag at all. IFD1 is where a stripped export keeps whatever
      // it kept, so give it the same read before giving up on the file.
      scanIfd(r, nextIfdOffset, tags)
    }

    const out: Exif = {}

    const make = tags.get(TAG_MAKE)
    const model = tags.get(TAG_MODEL)
    const makeStr = make ? ascii(r, make.entry, make.count) : ''
    const modelStr = model ? ascii(r, model.entry, model.count) : ''
    if (modelStr) {
      const dup = makeStr && modelStr.toLowerCase().startsWith(makeStr.toLowerCase())
      out.camera = dup ? modelStr : [makeStr, modelStr].filter(Boolean).join(' ')
    } else if (makeStr) {
      out.camera = makeStr
    }

    const focal35 = tags.get(TAG_FOCAL)
    const focalRaw = tags.get(TAG_FOCAL_RAW)
    if (focal35) {
      const v = u16(r, focal35.entry + 8)
      if (v > 0) out.focal = `${v}mm`
    }
    if (!out.focal && focalRaw) {
      const v = rational(r, u32(r, focalRaw.entry + 8), focalRaw.type)
      if (v !== null && v > 0) out.focal = `${Math.round(v)}mm`
    }

    const fnum = tags.get(TAG_FNUMBER)
    if (fnum) {
      const v = rational(r, u32(r, fnum.entry + 8), fnum.type)
      if (v !== null && v > 0) out.aperture = formatAperture(v)
    }
    if (!out.aperture) {
      const ap = tags.get(TAG_APERTURE)
      if (ap) {
        const apex = rational(r, u32(r, ap.entry + 8), ap.type)
        if (apex !== null) out.aperture = formatAperture(Math.pow(2, apex / 2))
      }
    }

    const expo = tags.get(TAG_EXPOSURE)
    if (expo) {
      const v = rational(r, u32(r, expo.entry + 8), expo.type)
      if (v !== null && v > 0) {
        out.shutter = v >= 1 ? `${v}s` : `1/${Math.round(1 / v)}`
      }
    }
    if (!out.shutter) {
      const sh = tags.get(TAG_SHUTTER_APEX)
      if (sh) {
        const apex = rational(r, u32(r, sh.entry + 8), sh.type)
        if (apex !== null) {
          // ShutterSpeedValue is APEX, which stores the *reciprocal*: T = 2^-Av,
          // so 1/125 s arrives as Av ≈ 7. 2^Av is 1/T, not T — read as seconds
          // it would caption a fast frame "128s" and a long one "1/8". Convert
          // to seconds and reuse the ExposureTime formatter, so a shutter reads
          // the same however the camera happened to record it.
          const v = Math.pow(2, -apex)
          out.shutter = v >= 1 ? `${v}s` : `1/${Math.round(1 / v)}`
        }
      }
    }

    const iso = tags.get(TAG_ISO)
    if (iso) {
      const v = u16(r, iso.entry + 8)
      if (v > 0) out.iso = `ISO ${v}`
    }

    // The plate exists to say what the camera did, so the frame's capture time
    // outranks the file's last-write time. A photo that has been through an
    // editor carries both and they disagree: `with-exif.jpg` has the camera's
    // DateTimeOriginal (2019:12:03, Exif IFD) and Paint.NET's re-save DateTime
    // (2019:12:04, IFD0) — reading the latter captions the frame with the day
    // someone saved it, which is a day this photo was not taken.
    const dt = tags.get(TAG_DATETIME_ORIGINAL) ?? tags.get(TAG_DATETIME)
    if (dt) {
      const raw = ascii(r, dt.entry, dt.count)
      const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw)
      if (m) out.date = `${m[1]}.${m[2]}.${m[3]}`
    }

    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
