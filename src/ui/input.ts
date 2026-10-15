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
 * Releases the blob URL a photograph is holding.
 *
 * The lifetime of that URL belongs to whoever holds the photo, and this is how
 * they let it go. It is deliberately *not* revoked when the next photograph
 * decodes — that was the rule when the app held exactly one photo and each new
 * one replaced it. The list holds every photograph the user loaded, and the
 * export draws from `el` long after the decode settles, so revoking one on the
 * next load would break a photo that is still listed: `drawImage` throws
 * `InvalidStateError: … in the 'broken' state` on a browser that discarded the
 * decoded data and re-fetches from `src`, which is exactly what iOS Safari does
 * under memory pressure, and the trigger conditions are this app's normal ones
 * (a 12 MP photo is ~48 MB decoded, held detached while the export allocates
 * its canvas). Call this when a photograph leaves the list.
 *
 * What does not change is the failure path: a decode that throws had no photo
 * escape it, so its URL goes at once (see the `catch` in `decodePhoto`) — that
 * one can never be drawn from.
 */
export function releasePhoto(photo: Photo): void {
  const src = photo.el.src
  // Only a blob URL is ours to revoke. The demo photograph is a `data:` URL and
  // allocated no object URL at all; `revokeObjectURL` ignores a string it does
  // not recognise, but saying which ones are ours is cheaper than knowing that.
  if (src.startsWith('blob:')) URL.revokeObjectURL(src)
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
    // photograph leaves the list, and `releasePhoto` is what ends it (see
    // above). The prototype's bug was never revoking at all — unbounded growth
    // for the lifetime of the page — and that stays fixed: the list releases
    // what it drops, and the failure path below releases what never arrived.
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
  onPhotos: (photos: Photo[]) => void,
  onError: (message: string) => void,
  readExif: (buf: ArrayBuffer) => Exif | null,
): void {
  /**
   * A batch, decoded one file at a time and reported as one event.
   *
   * One bad file must not discard the good ones beside it: a folder dragged in
   * where one entry is a PDF leaves the rest loaded, and the message names the
   * file it belongs to — with several files in flight, "这不是图片文件" on its
   * own leaves the user hunting for which one. The name is only added when
   * there is more than one file, so the single-file case keeps the terse
   * message it has always had.
   *
   * Decoding is sequential rather than concurrent: each decode holds a full
   * bitmap (48 MB for a 12 MP photo) and the preview downscale happens inline,
   * so a batch of ten out of a folder is a memory spike worth avoiding for the
   * sake of arriving a moment sooner.
   */
  const handle = async (files: File[] | undefined | null) => {
    const batch = [...(files ?? [])]
    if (batch.length === 0) return

    const decoded: Photo[] = []
    for (const file of batch) {
      // Reading and rendering fail for different reasons and need different
      // words. They shared one `try` until Task 12 put the renderer behind
      // `onPhoto`: from then on a throw from `drawImage` came out of the UI as
      // "图片读取失败 — 该格式可能不被此浏览器支持", which sends the user to check
      // a photo that decoded perfectly well and hides a rendering fault behind
      // a file-format message. Two `try`s, two messages.
      try {
        decoded.push(await decodePhoto(file, readExif))
      } catch (e) {
        const why = e instanceof Error ? e.message : '图片读取失败'
        onError(batch.length > 1 ? `${file.name}：${why}` : why)
      }
    }
    if (decoded.length === 0) return

    // Not left to propagate: an unhandled rejection here is a renderer fault
    // that reaches the user as *silence* — no message at all, while the canvas
    // has already been re-sized (which clears it). It gets the renderer's own
    // name and the renderer's own detail. The whole batch is handed over at
    // once because the renderer draws one photo and the list wants all of them:
    // a caller that had to add them one at a time would repaint the wall once
    // per file, and the previews with it.
    try {
      onPhotos(decoded)
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
    void handle(Array.from(t.files ?? []))
    // Cleared so that picking the same file twice in a row is a change event
    // the picker's own `multiple` support depends on: a `FileList` left in
    // place does not fire for a repeat selection.
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
    void handle(Array.from(dt?.files ?? []))
  })

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items ?? []
    const pasted: File[] = []
    for (const it of items) {
      if (it.type && it.type.indexOf('image/') === 0) {
        const f = it.getAsFile()
        if (f) pasted.push(f)
      }
    }
    void handle(pasted)
  })
}
