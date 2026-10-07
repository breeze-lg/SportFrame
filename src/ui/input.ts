import type { Exif, Photo } from '../core/types'

export type FileClass = 'image' | 'unsupported' | 'empty'

/** Spec §9: previews render from ~4 MP; the full image is used only at export. */
export const PREVIEW_MAX_PIXELS = 4_000_000
export const DOWNSCALE_THRESHOLD_PIXELS = 12_000_000

export function classifyFile(file: File): FileClass {
  if (file.size === 0) return 'empty'
  if (!file.type || file.type.indexOf('image/') !== 0) return 'unsupported'
  return 'image'
}

/** Returns a downscaled preview element for a large image, else null. Pure
 *  enough to unit-test the decision, which is separated out below. */
export function needsDownscale(
  width: number,
  height: number,
  threshold = DOWNSCALE_THRESHOLD_PIXELS,
): boolean {
  return width * height > threshold
}

export function previewScale(
  width: number,
  height: number,
  maxPixels = PREVIEW_MAX_PIXELS,
): number {
  const pixels = width * height
  if (pixels <= maxPixels) return 1
  return Math.sqrt(maxPixels / pixels)
}

function downscale(img: HTMLImageElement): HTMLImageElement | null {
  const s = previewScale(img.naturalWidth, img.naturalHeight)
  if (s >= 1) return null
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * s))
  c.height = Math.max(1, Math.round(img.naturalHeight * s))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const out = new Image()
  out.src = c.toDataURL('image/png')
  return out
}

/**
 * The one object URL the photo currently in hand still needs.
 *
 * It is deliberately *not* revoked when the decode settles: `Photo.el.src` is
 * that URL, and the export draws from that same `el` long afterwards. A browser
 * that discards decoded image data under memory pressure and re-fetches from
 * `src` will then fail — `drawImage` throws
 * `InvalidStateError: … in the 'broken' state` — and iOS Safari evicts decoded
 * data aggressively. The trigger conditions are this app's normal ones: a
 * 12 MP photo is ~48 MB decoded, held in a detached, never-painted `<img>`
 * while the export allocates its canvas.
 *
 * It is revoked when the next photo replaces it, so a session holds at most one
 * live URL. The prototype's bug was never revoking at all — unbounded growth
 * for the lifetime of the page — and that stays fixed; one live URL at a time
 * is lifetime management, not a leak.
 */
let liveUrl: string | null = null

function releaseLiveUrl(): void {
  if (liveUrl !== null) URL.revokeObjectURL(liveUrl)
  liveUrl = null
}

export async function decodePhoto(
  file: File,
  readExif: (buf: ArrayBuffer) => Exif | null,
): Promise<Photo> {
  const cls = classifyFile(file)
  if (cls === 'empty') throw new Error('文件为空')
  if (cls === 'unsupported') throw new Error('这不是图片文件')

  const buf = await file.arrayBuffer()
  const exif = readExif(buf)

  const url = URL.createObjectURL(file)
  try {
    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () =>
        reject(new Error('图片读取失败 — 该格式可能不被此浏览器支持（HEIC 需要 Safari）'))
      img.src = url
    })
    // A decode that yields no usable dimensions is a decode that failed, and it
    // must not reach the renderer: `geometry.cover` has no zero-dimension guard,
    // so a 0 on either axis becomes an Infinity scale factor in `drawImage`.
    if (!el.naturalWidth || !el.naturalHeight) throw new Error('图片读取失败')

    let preview: HTMLImageElement | undefined
    if (needsDownscale(el.naturalWidth, el.naturalHeight)) {
      preview = downscale(el) ?? undefined
      if (preview) {
        await new Promise<void>((res) => {
          if (preview!.complete) return res()
          preview!.onload = () => res()
          preview!.onerror = () => res()
        })
      }
    }

    // A photo escaped, so these bytes live on: `el.src` is this URL until the
    // next photo replaces it (see `liveUrl`). Released here, after the decode
    // has settled, never before it — a pending load is never pulled out from
    // under itself.
    releaseLiveUrl()
    liveUrl = url

    return {
      el,
      preview,
      width: el.naturalWidth,
      height: el.naturalHeight,
      name: (file.name || '').replace(/\.[^.]+$/, ''),
      exif,
    }
  } catch (e) {
    // No photo escaped, so these bytes are unreachable and go now, on the error
    // path as well as the success path. The prototype revoked only on the
    // success path, so every failed load leaked its blob for the lifetime of
    // the page; that is what this branch keeps fixed.
    URL.revokeObjectURL(url)
    throw e
  }
}

export function wireInput(
  drop: HTMLElement,
  fileInput: HTMLInputElement,
  onPhoto: (photo: Photo) => void,
  onError: (message: string) => void,
  readExif: (buf: ArrayBuffer) => Exif | null,
): void {
  const handle = async (file: File | undefined | null) => {
    if (!file) return

    // Reading and rendering fail for different reasons and need different
    // words. They shared one `try` until Task 12 put the renderer behind
    // `onPhoto`: from then on a throw from `drawImage` came out of the UI as
    // "图片读取失败 — 该格式可能不被此浏览器支持", which sends the user to check
    // a photo that decoded perfectly well and hides a rendering fault behind a
    // file-format message. Two `try`s, two messages.
    let photo: Photo
    try {
      photo = await decodePhoto(file, readExif)
    } catch (e) {
      onError(e instanceof Error ? e.message : '图片读取失败')
      return
    }

    // Not left to propagate: an unhandled rejection here is a renderer fault
    // that reaches the user as *silence* — no message at all, while the canvas
    // has already been re-sized (which clears it). It gets the renderer's own
    // name and the renderer's own detail.
    try {
      onPhoto(photo)
    } catch (e) {
      onError(e instanceof Error ? `渲染失败：${e.message}` : '渲染失败')
    }
  }

  const open = () => fileInput.click()
  drop.addEventListener('click', open)
  // `#file` is hidden and `.drop` is a div, so without this a keyboard-only
  // visitor has no way to add a photo at all. Space would otherwise scroll the
  // page, which is why it is prevented here rather than in the markup.
  drop.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    open()
  })
  fileInput.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    void handle(t.files?.[0])
    t.value = ''
  })

  ;['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.add('over')
    }),
  )
  ;['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.remove('over')
    }),
  )
  drop.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer
    void handle(dt?.files?.[0])
  })

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items ?? []
    for (const it of items) {
      if (it.type && it.type.indexOf('image/') === 0) {
        void handle(it.getAsFile())
        return
      }
    }
  })
}
