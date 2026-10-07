import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { readExif } from '../../src/core/exif'
import type { Exif } from '../../src/core/types'

/**
 * Bytes, not a view. `readFileSync` hands back a Buffer that, below 8 KB, is a
 * window onto Node's *shared* pool — so `.buffer` there is the whole pool with
 * neighbouring allocations in it, not the file. Slicing to the file's own bytes
 * keeps the fixtures honest no matter how small a future one is.
 */
const buf = (name: string): ArrayBuffer => {
  const b = readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const bytes = (name: string): Uint8Array => new Uint8Array(buf(name))

/** What the caption is allowed to print, one shape per field. */
const FORMATS: Record<keyof Exif, RegExp> = {
  camera: /^\S(.*\S)?$/,
  focal: /^\d+(\.\d+)?mm$/,
  aperture: /^f\/\d+(\.\d+)?$/,
  shutter: /^(\d+(\.\d+)?s|1\/\d+)$/,
  iso: /^ISO \d+$/,
  date: /^\d{4}\.\d{2}\.\d{2}$/,
}

/**
 * One frame, one camera, one pair of settings — `with-exif-le.jpg` is the same
 * shoot as `with-exif.jpg`, written with the opposite TIFF byte order. Nikon
 * does not dedupe: its Model ("NIKON D810") does not start with its Make
 * ("NIKON CORPORATION"), so both belong in the caption.
 */
const NIKON: Exif = {
  camera: 'NIKON CORPORATION NIKON D810',
  focal: '85mm',
  aperture: 'f/15.0',
  shutter: '1/125',
  iso: 'ISO 64',
  date: '2019.12.04',
}

/** Where `with-exif.jpg`'s Exif segment stops: 2 SOI + 4 marker and length +
 *  the 1002-byte payload. Every byte the parser reads lives before this. */
const APP1_END = 1006

describe('readExif', () => {
  it('reads the core tags from a camera file', () => {
    const e = readExif(buf('with-exif.jpg'))
    expect(e).not.toBeNull()
    expect(e!.focal).toMatch(/^\d+(\.\d+)?mm$/)
    expect(e!.aperture).toMatch(/^f\/\d+(\.\d+)?$/)
    expect(e!.iso).toMatch(/^ISO \d+$/)
  })

  it('reads the values the camera actually wrote', () => {
    expect(readExif(buf('with-exif.jpg'))).toEqual(NIKON)
  })

  it('reads the same values through a little-endian TIFF header', () => {
    expect(readExif(buf('with-exif-le.jpg'))).toEqual(NIKON)
  })

  it('[RF-2] returns null for a file with no EXIF segment', () => {
    expect(readExif(buf('no-exif.jpg'))).toBeNull()
  })

  it('[RF-2] returns null for an EXIF segment that carries no spec tags', () => {
    // A Paint.NET re-export: IFD0 holds only resolution and Software. There is
    // nothing to caption, so `{}` — which the plate would render as a blank
    // strip — must collapse to null.
    expect(readExif(buf('exif-no-tags.jpg'))).toBeNull()
  })

  it('[RF-2] returns a partial object when tags are missing, never throwing', () => {
    const e = readExif(buf('partial-exif.jpg'))
    expect(e).not.toBeNull()
    expect(e!.focal).toBeDefined()
    expect(e!.aperture).toBeUndefined()
    expect(e!.iso).toBeUndefined()
    expect(e!.camera).toBe('FixtureCam Portable')
    expect(e!.date).toBe('2024.03.04')
    // This file's only shutter tag is ShutterSpeedValue, APEX 21/4: 2^-5.25 s,
    // which is 1/38. APEX stores log2(1/T), so the naive 2^5.25 would caption a
    // 1/38 s frame as "38s" — this assertion is what holds that right way up.
    expect(e!.shutter).toBe('1/38')
  })

  it('[RF-2] returns a partial object for a real export that carries only a date', () => {
    // The strongest form of the partial case: a real editor's output whose
    // Exif IFD holds no camera settings at all. Every absent field must be
    // absent, and the one present field must survive.
    expect(readExif(buf('partial-date-only.jpg'))).toEqual({ date: '2015.10.22' })
  })

  it('returns null for a buffer that is not a JPEG', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
    expect(readExif(junk)).toBeNull()
  })

  it('[RF-2] returns null for buffers too short to hold a JPEG header', () => {
    for (let n = 0; n < 16; n++) {
      expect(readExif(new Uint8Array(n).buffer)).toBeNull()
      expect(readExif(new Uint8Array(n).fill(0xff).buffer)).toBeNull()
    }
  })

  it('returns null for a truncated JPEG', () => {
    const full = new Uint8Array(buf('with-exif.jpg'))
    const cut = full.slice(0, 40).buffer
    expect(readExif(cut)).toBeNull()
  })

  it('never throws on random bytes', () => {
    const bytes = new Uint8Array(2048)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256
    expect(() => readExif(bytes.buffer)).not.toThrow()
  })

  it('[RF-2] keeps its footing at every truncation point of a real file', () => {
    // Truncation lands mid-segment-header, mid-IFD-entry and mid-value-offset,
    // and each of those is a different walk through the parser — one cut at 40
    // bytes proves nothing about the other three thousand. Every cut is walked
    // through the whole Exif segment (0..1200 covers the 1006-byte APP1 and the
    // tables behind it byte by byte) and sampled across the image data beyond.
    const full = bytes('with-exif.jpg')
    const cuts: number[] = []
    for (let n = 0; n <= Math.min(full.length, 1200); n++) cuts.push(n)
    for (let n = 1201; n < full.length; n += 97) cuts.push(n)

    let partials = 0
    for (const cut of cuts) {
      const slice = full.slice(0, cut).buffer as ArrayBuffer
      let got: Exif | null
      try {
        got = readExif(slice)
      } catch (err) {
        throw new Error(`readExif threw at a ${cut}-byte truncation: ${String(err)}`)
      }
      if (got === null) continue
      for (const [field, value] of Object.entries(got)) {
        // A partial read may lose fields — the bytes are gone — but it may
        // never invent one: half a rational must not surface as "f/NaN".
        expect(value, `cut ${cut}: ${field}`).toMatch(FORMATS[field as keyof Exif])
        // And what survives must be the byte it always was. Offsets do not
        // shift under truncation, so a field that is still readable has to
        // read exactly what the intact file reads.
        expect(value, `cut ${cut}: ${field}`).toBe(NIKON[field as keyof Exif])
      }
      if (cut >= APP1_END) {
        // Past the end of the Exif segment every cut still holds the whole TIFF
        // block, so the caption must be complete — not merely unbroken.
        expect(got, `cut ${cut}`).toEqual(NIKON)
      } else if (Object.keys(got).length < 6) {
        // Inside it the tail is gone, and so are whatever tags lived there.
        partials++
      }
    }
    // The sweep only earns its name if all three outcomes were walked: a parser
    // that answered null to everything would satisfy every assertion above.
    expect(partials).toBeGreaterThan(0)
  })
})
