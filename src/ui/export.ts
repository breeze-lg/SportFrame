import { render } from '../core/render'
import type { Exif, Photo, Size, Template, TextSlotId } from '../core/types'

export const MAX_CANVAS_EDGE = 16384

export function fitsCanvas(size: Size, k: number): boolean {
  return size.W * k <= MAX_CANVAS_EDGE && size.H * k <= MAX_CANVAS_EDGE
}

export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return [
    d.getFullYear(),
    p(d.getMonth() + 1),
    p(d.getDate()),
    p(d.getHours()),
    p(d.getMinutes()),
    p(d.getSeconds()),
  ].join('-')
}

export function renderToCanvas(
  size: Size,
  k: number,
  template: Template,
  photos: Photo[],
  text: Partial<Record<TextSlotId, string>>,
  exif: Exif | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = size.W * k
  out.height = size.H * k
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('导出失败：无法创建画布')
  // strip `preview` so the export always draws from the full-resolution image
  const full = photos.map(({ preview: _preview, ...rest }) => rest)
  render({ ctx, size, k, template, photos: full, text, exif })
  return out
}

export type ExportOpts = {
  size: Size
  template: Template
  photos: Photo[]
  text: Partial<Record<string, string>>
  exif: Exif | null
  want?: 2 | 4
}

export async function exportPng(
  opts: ExportOpts,
): Promise<{ blob: Blob; filename: string; k: number; downgraded: boolean }> {
  const want = opts.want ?? 2
  // `k` is widened deliberately: the fallback assigns 1, which is not one of
  // the requested multipliers `want` is restricted to.
  let k: number = want
  let downgraded = false

  if (!fitsCanvas(opts.size, k)) {
    k = 1
    downgraded = true
  }

  const canvas = renderToCanvas(
    opts.size,
    k,
    opts.template,
    opts.photos,
    opts.text as Partial<Record<TextSlotId, string>>,
    opts.exif,
  )

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('导出失败：图片太大，请降低输出长边')

  const filename = `frame_${canvas.width}x${canvas.height}_${stamp(new Date())}.png`
  return { blob, filename, k, downgraded }
}

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/**
 * Spec §8: export is a ceremony, not a toast. The chrome recedes, the finished
 * poster stands alone on the wall, and its dimensions are stated beneath it.
 *
 * This subsumes the prototype's separate iOS save sheet: on iOS the ceremony's
 * image is the thing the user long-presses, so there is one moment rather than
 * two. `hint` carries that instruction on iOS and is absent elsewhere.
 */
export function showCeremony(
  dataUrl: string,
  width: number,
  height: number,
  onAgain: () => void,
  hint?: string,
): void {
  document.body.classList.add('ceremony-open')

  const el = document.createElement('div')
  el.className = 'ceremony'
  el.innerHTML = `
    <div class="ceremony-art"><img alt="成品"></div>
    <div class="ceremony-copy">
      <h3>已装裱</h3>
      <p class="ceremony-dims">${width} × ${height} PNG</p>
      ${hint ? `<p class="ceremony-hint">${hint}</p>` : ''}
      <div class="ceremony-acts">
        <button class="btn btn-primary" data-act="again">再存一张</button>
        <button class="btn" data-act="done">完成</button>
      </div>
    </div>`

  const img = el.querySelector('img')
  if (img) img.src = dataUrl

  const close = () => {
    document.body.classList.remove('ceremony-open')
    el.remove()
  }

  el.querySelector('[data-act="again"]')?.addEventListener('click', () => {
    close()
    onAgain()
  })
  el.querySelector('[data-act="done"]')?.addEventListener('click', close)

  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('in'))
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('导出失败'))
    fr.readAsDataURL(blob)
  })
}
