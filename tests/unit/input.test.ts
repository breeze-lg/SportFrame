import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyFile,
  decodePhoto,
  needsDownscale,
  previewScale,
} from '../../src/ui/input'

const file = (name: string, type: string, size: number) =>
  ({ name, type, size }) as File

describe('[RF-4] classifyFile', () => {
  it('accepts image mime types', () => {
    expect(classifyFile(file('a.jpg', 'image/jpeg', 1000))).toBe('image')
    expect(classifyFile(file('a.heic', 'image/heic', 1000))).toBe('image')
    expect(classifyFile(file('a.webp', 'image/webp', 1000))).toBe('image')
  })

  it('rejects a zero-byte file before anything downstream sees it', () => {
    expect(classifyFile(file('a.jpg', 'image/jpeg', 0))).toBe('empty')
  })

  it('rejects a PDF renamed to .jpg', () => {
    expect(classifyFile(file('a.jpg', 'application/pdf', 1000))).toBe('unsupported')
  })

  it('rejects a file with no mime type at all', () => {
    expect(classifyFile(file('a', '', 1000))).toBe('unsupported')
  })
})

describe('preview downscaling', () => {
  it('leaves images at or under 12 MP alone', () => {
    expect(needsDownscale(4000, 3000)).toBe(false)
  })

  it('downscales above 12 MP', () => {
    expect(needsDownscale(6000, 4000)).toBe(true)
  })

  it('scales a 50 MP image to about 4 MP', () => {
    const s = previewScale(8660, 5773)
    const result = 8660 * s * (5773 * s)
    expect(result).toBeGreaterThan(3_900_000)
    expect(result).toBeLessThanOrEqual(4_000_000)
  })

  it('does not scale up a small image', () => {
    expect(previewScale(800, 600)).toBe(1)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const realFile = (name: string, type: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type })

/**
 * Minimal stand-in for the browser's `Image`, needed because vitest runs this
 * file in the `node` environment, which has no DOM. It reproduces the contract
 * `decodePhoto` depends on: assigning `src` kicks off a decode that settles
 * asynchronously, and a decoded image reports `naturalWidth`/`naturalHeight`.
 *
 * It models a decode that *succeeds* — deliberately so. The failure mode under
 * test is a decode that completes with no usable dimensions, which is the only
 * shape that reaches the guard in `decodePhoto`; faking an `onerror` would
 * prove nothing about how a real browser fails. Real corrupt bytes and real
 * `onerror` are the pixel suite's business.
 */
/**
 * Records every object URL created and revoked. Each call takes a unique
 * prefix because the module under test holds its live URL in module state:
 * without distinct names a later test could pass on an earlier test's URL.
 */
function trackUrls(prefix: string): { created: string[]; revoked: string[] } {
  const created: string[] = []
  const revoked: string[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:${prefix}-${created.length + 1}`
    created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(String(url))
  })
  return { created, revoked }
}

function stubImage(width: number, height: number, log: string[] = []): void {
  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = width
    naturalHeight = height
    set src(_url: string) {
      queueMicrotask(() => {
        log.push('load')
        this.onload?.()
      })
    }
  }
  vi.stubGlobal('Image', StubImage)
}

describe('[RF-4] decodePhoto refuses non-images with a legible reason', () => {
  it('names the reason for a zero-byte file and for a PDF in disguise', async () => {
    const readExif = vi.fn(() => null)

    await expect(decodePhoto(realFile('a.jpg', 'image/jpeg', 0), readExif)).rejects.toThrow(
      '文件为空',
    )
    await expect(
      decodePhoto(realFile('a.jpg', 'application/pdf', 64), readExif),
    ).rejects.toThrow('这不是图片文件')

    // neither file was read, let alone decoded — the rejection is upstream of
    // every side effect
    expect(readExif).not.toHaveBeenCalled()
  })
})

describe('[RF-4] a degenerate decode never reaches the renderer', () => {
  // `geometry.cover` has no zero-dimension guard: a 0 in either dimension makes
  // its scale factor Infinity, which flows straight into `drawImage`. The guard
  // that keeps that impossible lives here, and these cases pin it — both
  // clauses, since `||` is what makes a 0 on *either* axis fatal.
  for (const [w, h] of [
    [0, 0],
    [1000, 0],
    [0, 1000],
  ] as const) {
    it(`rejects an image that decodes to ${w}×${h}`, async () => {
      stubImage(w, h)
      const revoke = vi.spyOn(URL, 'revokeObjectURL')

      await expect(decodePhoto(realFile('a.jpg', 'image/jpeg', 16), () => null)).rejects.toThrow(
        '图片读取失败',
      )

      // the object URL is released on the failure path too — a failed load
      // revokes its own URL at once, and only that one
      expect(revoke).toHaveBeenCalledTimes(1)
    })
  }
})

describe('decodePhoto result', () => {
  it('reports the decoded dimensions, the bare name, and the EXIF it was handed', async () => {
    stubImage(1200, 800)
    // the parameter is declared so the mock records what it was handed
    const readExif = vi.fn((_buf: ArrayBuffer) => ({ camera: 'X-T5' }))
    const buf = new Uint8Array(32)

    const photo = await decodePhoto(
      new File([buf], 'portrait.jpg', { type: 'image/jpeg' }),
      readExif,
    )

    expect(photo.width).toBe(1200)
    expect(photo.height).toBe(800)
    expect(photo.name).toBe('portrait')
    expect(photo.exif).toEqual({ camera: 'X-T5' })
    expect(photo.el.naturalWidth).toBe(1200)
    // 1200×800 is well under the 12 MP threshold, so no preview is built
    expect(photo.preview).toBeUndefined()
    expect(readExif.mock.calls[0]![0]).toBeInstanceOf(ArrayBuffer)
  })

  it('keeps the object URL alive when the decode settles', async () => {
    // The photo's `el.src` is this URL and the export draws from `el` much
    // later. A browser that discards decoded image data under memory pressure
    // (iOS Safari does, aggressively) re-fetches from `src`; revoking here
    // would turn that into `InvalidStateError` and a raw English toast.
    const { created, revoked } = trackUrls('alive')
    stubImage(1200, 800)

    const photo = await decodePhoto(realFile('a.jpg', 'image/jpeg', 16), () => null)

    expect(created).toEqual(['blob:alive-1'])
    expect(revoked).not.toContain('blob:alive-1')
    expect(photo.el.naturalWidth).toBe(1200)
  })

  it('revokes the previous photo\'s URL when a new photo replaces it', async () => {
    // One live URL at a time: the leak the prototype had (never revoking, so a
    // session grew without bound) stays fixed.
    const { created, revoked } = trackUrls('replace')
    stubImage(1200, 800)
    await decodePhoto(realFile('a.jpg', 'image/jpeg', 16), () => null)
    stubImage(1200, 800)
    await decodePhoto(realFile('b.jpg', 'image/jpeg', 16), () => null)

    expect(created).toEqual(['blob:replace-1', 'blob:replace-2'])
    expect(revoked).toContain('blob:replace-1')
    // ...and the URL the current photo still needs is untouched
    expect(revoked).not.toContain('blob:replace-2')
  })

  it('releases a failed load\'s URL immediately — nothing draws from it', async () => {
    // The prototype revoked only on the success path, so every failed load
    // leaked its blob for the lifetime of the page. That stays fixed: no photo
    // escapes a failure, so the URL goes at once rather than being handed to
    // the next replacement.
    const { created, revoked } = trackUrls('failed')
    stubImage(0, 0)

    await expect(decodePhoto(realFile('a.jpg', 'image/jpeg', 16), () => null)).rejects.toThrow(
      '图片读取失败',
    )

    expect(created).toEqual(['blob:failed-1'])
    expect(revoked).toContain('blob:failed-1')
  })
})
