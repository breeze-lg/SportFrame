import { render } from '../core/render'
import type { Exif, Photo, Size, Template, TextSlotId } from '../core/types'

export const MAX_CANVAS_EDGE = 16384

/**
 * WebKit does not bound canvases by edge length alone: it caps *area*, and the
 * iOS cap is far below `MAX_CANVAS_EDGE²` — 4096×4096 = 16,777,216 px, the
 * figure MDN still documents for iOS and the one WebKit enforced from 2015
 * (bug 145998) before a later device-memory bump raised it to 8192². A canvas
 * over the cap does not throw: drawing becomes a no-op and `toBlob` yields
 * null, so the export would hand a paying user a blank poster with no error.
 *
 * An edge-only guard cannot see this. A 4× export of this app's default 4:5
 * canvas (1152×1440 logical → 4608×5760 = 26.5 MP) has both edges legal and
 * still blows an iOS area cap — and 4× is the advertised premium tier (§10),
 * not an exotic request. 16,777,216 is the conservative floor of the WebKit
 * area caps rather than the raised one, because the device tier is not
 * detectable from script; every supported iPhone honours this number. It holds
 * every 2× export this app can produce (the default 2× is 6.6 MP) with room.
 */
export const MAX_CANVAS_AREA = 16_777_216

export function fitsCanvas(size: Size, k: number): boolean {
  const W = size.W * k
  const H = size.H * k
  return W <= MAX_CANVAS_EDGE && H <= MAX_CANVAS_EDGE && W * H <= MAX_CANVAS_AREA
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

  const draw = (scale: number) =>
    renderToCanvas(
      opts.size,
      scale,
      opts.template,
      opts.photos,
      opts.text as Partial<Record<TextSlotId, string>>,
      opts.exif,
    )
  const encode = (canvas: HTMLCanvasElement) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))

  let canvas = draw(k)
  let blob = await encode(canvas)

  // The check above is a prediction; this is the recovery. Where the engine
  // disagrees with it — an area cap the budget under-estimates, or plain memory
  // pressure on a big canvas — WebKit fails *silently*: `toBlob` hands back
  // null instead of throwing. Retry once at 1× before reporting failure, per
  // spec §9's "catch, retry at lower scale, tell the user what happened".
  // Already at 1×, or the size does not fit at 1× either, means no retry can
  // help: fall through to the failure the user can act on.
  if (!blob && k > 1 && fitsCanvas(opts.size, 1)) {
    k = 1
    downgraded = true
    canvas = draw(k)
    blob = await encode(canvas)
  }

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
