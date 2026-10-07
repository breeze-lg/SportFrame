import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatAperture, readExif } from '../../src/core/exif'
import type { Exif } from '../../src/core/types'

/**
 * Bytes, not a view. `readFileSync` hands back a Buffer that, below 8 KB, is a
 * window onto Node's *shared* pool — so `.buffer` there is the whole pool with
 * neighbouring allocations in it, not the file. Slicing to the file's own bytes
 * keeps the fixtures honest no matter how small a future one is.
 *
 * What wrote each fixture's EXIF bytes, and where its pixels came from:
 * `tests/fixtures/README.md`.
 */
const buf = (name: string): ArrayBuffer => {
  const b = readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const bytes = (name: string): Uint8Array => new Uint8Array(buf(name))

/** Byte-run search, for asserting on what a fixture literally stores rather
 *  than only on what the parser made of it. */
const findRun = (haystack: Uint8Array, needle: number[]): number => {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** The bytes a fixture holds as text, for asserting an ASCII tag is present. */
const asText = (name: string): string =>
  Array.from(bytes(name), (b) => String.fromCharCode(b)).join('')

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
 * One camera, one pair of settings, two frames — `with-exif-le.jpg` is the same
 * shoot as `with-exif.jpg`, written with the opposite TIFF byte order. Nikon
 * does not dedupe: its Model ("NIKON D810") does not start with its Make
 * ("NIKON CORPORATION"), so both belong in the caption.
 *
 * The dates differ because the frames do: these are the *capture* times the
 * camera wrote (`DateTimeOriginal`), 2019:12:03 and 2019:12:02. Both files also
 * carry an IFD0 `DateTime` from the editor that re-saved them — 2019:12:04 in
 * both — which is the day the file last changed, not the day the photo was
 * taken. Reading that one is what the printer did before this test said
 * otherwise, and it printed the same wrong day for both frames.
 *
 * This frame is also the whole-stop aperture case: the camera wrote `FNumber`
 * 15/1, and photographic convention writes a whole stop as `f/15`, never
 * `f/15.0` — the trailing decimal is an artefact of a fixed one-decimal
 * formatter, not of the reading. The value here is the caption the spec plate
 * prints verbatim, so it is pinned the way a photographer would read it.
 */
const NIKON: Exif = {
  camera: 'NIKON CORPORATION NIKON D810',
  focal: '85mm',
  aperture: 'f/15',
  shutter: '1/125',
  iso: 'ISO 64',
  date: '2019.12.03',
}
const NIKON_LE: Exif = { ...NIKON, date: '2019.12.02' }

/** What IFD0's DateTime holds in `with-exif.jpg`: the day the file was last
 *  written. Not a caption — but it is the honest fallback when a cut removes
 *  the Exif IFD the capture date lives in. */
const NIKON_SAVE_DATE = '2019.12.04'

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
    expect(readExif(buf('with-exif-le.jpg'))).toEqual(NIKON_LE)
  })

  /**
   * The caption convention on both of its outcomes: a whole stop loses the
   * decimal, a fractional one keeps it. Only the first can be reached through a
   * fixture — `with-exif.jpg` stores `FNumber` 15/1, and no rights-clean file
   * here carries a fractional aperture — and a rule with two outcomes that only
   * ever gets tested on one of them is a rule half the app could lose. The
   * fractional case is the common one in the wild: every camera that writes
   * `ApertureValue` instead of `FNumber` arrives through `2^(apex/2)`, and
   * `f/2.8` is what a photographer reads off the ring.
   */
  it('writes a whole stop without a decimal and a fractional one with', () => {
    expect(formatAperture(15)).toBe('f/15')
    expect(formatAperture(16)).toBe('f/16')
    expect(formatAperture(28 / 10)).toBe('f/2.8')
    expect(formatAperture(2.1)).toBe('f/2.1')
    expect(formatAperture(1.4)).toBe('f/1.4')
    // and the shape the APEX branch actually hands it: ApertureValue 3/1 is
    // 2^1.5 = 2.83, which is the f/2.8 above and must not print as 2.828427…
    expect(formatAperture(Math.pow(2, 3 / 2))).toBe('f/2.8')
  })

  it('[RF-2] prefers the capture date over the file’s save date', () => {
    // Both dates are really in the file, a day apart, so this cannot pass by
    // the two tags happening to agree: IFD0's DateTime is the editor's re-save
    // and the Exif IFD's DateTimeOriginal is the camera's shutter.
    const text = asText('with-exif.jpg')
    expect(text).toContain('2019:12:04 10:27:56') // DateTime, IFD0 — the save
    expect(text).toContain('2019:12:03 11:05:13') // DateTimeOriginal, Exif IFD
    expect(readExif(buf('with-exif.jpg'))!.date).toBe('2019.12.03')

    // And the other way round on the byte-order twin, which is the same
    // camera and lens on the previous day.
    const le = asText('with-exif-le.jpg')
    expect(le).toContain('2019:12:04 10:58:26')
    expect(le).toContain('2019:12:02 16:50:13')
    expect(readExif(buf('with-exif-le.jpg'))!.date).toBe('2019.12.02')
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

  it('[RF-2] reads a negative ShutterSpeedValue as a long exposure, not 1/Infinity', () => {
    // APEX runs negative for any exposure over a second: Tv = -1 is 2 s, and
    // the tag that holds it is SRATIONAL, so the numerator is 0xFFFFFFFF. Read
    // as unsigned that is 4294967295, and `2 ** -4294967295` collapses to zero —
    // the caption then prints `1/Infinity` for an ordinary two-second frame.
    // This is conforming data, not corruption, which is why it gets a fixture.
    const raw = bytes('long-exposure.jpg')
    // The fixture really is signed: the Exif IFD entry is tag 0x9201, type 10,
    // count 1, and the eight bytes it points at are -1/1.
    expect(findRun(raw, [0x92, 0x01, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x01])).toBeGreaterThanOrEqual(0)
    expect(findRun(raw, [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01])).toBeGreaterThanOrEqual(0)

    expect(readExif(buf('long-exposure.jpg'))).toEqual({
      camera: 'FixtureCam Night',
      shutter: '2s',
      date: '2024.05.05',
    })
  })

  it('[RF-2] returns a partial object for a real export that carries only a date', () => {
    // The strongest form of the partial case: a real editor's output whose
    // Exif IFD holds no camera settings at all. Every absent field must be
    // absent, and the one present field must survive. This file has no
    // DateTimeOriginal — the camera never touched it — so it is also the
    // fixture that holds the *fallback* to DateTime up.
    const text = asText('partial-date-only.jpg')
    expect(text).toContain('2015:10:22 11:32:14')
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
        // read exactly what the intact file reads. The one legitimate
        // exception is `date`: this file holds two, and a cut inside the Exif
        // segment can remove the capture date's IFD while IFD0 — which sits
        // earlier — is still there. Either date is a value the file really
        // carries; a third one would be an invention.
        const allowed =
          field === 'date' ? [NIKON.date, NIKON_SAVE_DATE] : [NIKON[field as keyof Exif]]
        expect(allowed, `cut ${cut}: ${field}`).toContain(value)
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
