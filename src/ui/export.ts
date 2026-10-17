import { aspectOf } from '../core/geometry'
import { outputRect } from '../core/background'
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
 * not an exotic request. So this is the *floor*: the number every supported
 * iPhone honours, the default budget of `fitsCanvas`, and the budget of every
 * export rung but the premium one. It holds every 2× export this app can
 * produce (the default 2× is 6.6 MP) with room.
 */
export const MAX_CANVAS_AREA = 16_777_216

/**
 * WebKit's raised iOS cap — 8192², the number the device-memory bump moved the
 * limit to — and the area the 4× rung may spend.
 *
 * The 4× rung needs it: this app's default canvas is 1152×1440, so 4× is
 * 4608×5760 = 26.5 MP — over the floor, inside this cap. 26.5 MP is also what
 * §10 sells as the premium unlock, and a tier the export path downgrades on
 * *every* platform, desktop Chromium included, is not a tier.
 *
 * Spending past the floor is a bet on the device, because the device tier is
 * not readable from script. The bet is not taken blind: a canvas over the floor
 * is asked whether it holds pixels before it is encoded (`holdsPixels`), and
 * the rungs below it are held to the floor, so a device that refuses the large
 * canvas still gets the best file it can hold. WebKit's cap tracks device
 * memory, so a device that admits this canvas is one WebKit judged able to
 * hold it.
 */
export const PREMIUM_CANVAS_AREA = 67_108_864

/**
 * The area a rung may spend. Only 4× — the premium request — may exceed the
 * floor. Every rung below it, and every fallback, must fit what every device
 * honours, or it is not a fallback.
 */
export function areaBudget(k: number): number {
  return k >= 4 ? PREMIUM_CANVAS_AREA : MAX_CANVAS_AREA
}

export function fitsCanvas(size: Size, k: number, budget: number = MAX_CANVAS_AREA): boolean {
  const W = size.W * k
  const H = size.H * k
  return W <= MAX_CANVAS_EDGE && H <= MAX_CANVAS_EDGE && W * H <= budget
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

/**
 * The size the file will actually be, for a template and a photograph: the whole
 * canvas, or the mount's own box in 无照片 — the 800×800 a 1000×1000 poster crops
 * down to.
 *
 * Deliberately the one place a *size* is derived from a record, and everything that
 * budgets, draws or reports one asks it: the screen canvas in `main.ts`, this
 * module's ladder, and the size printed under the poster. A budget computed against
 * a canvas the file is not going to be is a budget that refuses a 4× export that
 * would have fit.
 */
export function deliverySize(size: Size, template: Template, photo: Photo | null): Size {
  const aspect = photo ? aspectOf(template.canvas.ratio, photo) : 0
  const r = outputRect(size, template, aspect)
  return { W: Math.max(1, Math.round(r.w)), H: Math.max(1, Math.round(r.h)) }
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
  const delivery = deliverySize(size, template, photos[0] ?? null)
  out.width = delivery.W * k
  out.height = delivery.H * k
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
  // `TextSlotId`, as `renderToCanvas` and `render` both take it: with a bare
  // `string` key a mistyped slot name — `titel` — typechecked here and was
  // silently absent from the exported poster, which is the failure this
  // architecture exists to make impossible.
  text: Partial<Record<TextSlotId, string>>
  exif: Exif | null
  want?: 2 | 4
}

/** The export rungs, best first. `want` selects the top one. */
const RUNGS = [4, 2, 1] as const

/**
 * The rungs a request may draw at, best first.
 *
 * The requested rung may spend `areaBudget(want)`; every rung *below* it must
 * fit the floor, because a fallback that needs a device-tier bet is not a
 * fallback — stepping down onto a canvas the device may blank would be a
 * downgrade in name only. An empty answer means even 1× is over the floor: the
 * caller draws at 1× anyway, so the encode's own failure is the message the
 * user gets, naming the one thing they can act on.
 */
function rungsFor(size: Size, want: 2 | 4): number[] {
  return RUNGS.filter(
    (k) => k <= want && fitsCanvas(size, k, k === want ? areaBudget(k) : MAX_CANVAS_AREA),
  )
}

/**
 * Does this canvas actually hold the pixels drawn into it?
 *
 * An over-budget canvas fails *silently* — WebKit documents the draws as
 * no-ops and hands `toBlob` a null — so "the call succeeded" is not evidence
 * that the user got an image. This is the evidence: a pixel written and then
 * read back. A canvas that stores nothing answers zeros to both reads, so the
 * value compared against is one this code just wrote and no renderer produced.
 * The original pixel is restored before the canvas is encoded, which keeps the
 * check invisible in the file.
 *
 * `putImageData`/`getImageData` rather than `fillRect`: they ignore the
 * transform, clip, alpha and composite state the renderer may have left on the
 * context, so this cannot fail on a healthy canvas for a reason that belongs
 * to the renderer.
 */
function holdsPixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  try {
    const before = ctx.getImageData(0, 0, 1, 1)
    ctx.putImageData(new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1), 0, 0)
    const after = ctx.getImageData(0, 0, 1, 1).data
    ctx.putImageData(before, 0, 0)
    return after[0] === 1 && after[1] === 2 && after[2] === 3 && after[3] === 255
  } catch {
    // A canvas that will not answer is a canvas that cannot be trusted. The
    // rung below it is the recovery; this is not a crash.
    return false
  }
}

export async function exportPng(
  opts: ExportOpts,
): Promise<{ blob: Blob; filename: string; k: number; downgraded: boolean }> {
  const want = opts.want ?? 2
  const rungs = rungsFor(deliverySize(opts.size, opts.template, opts.photos[0] ?? null), want)
  const ladder = rungs.length > 0 ? rungs : [1]

  const draw = (scale: number) =>
    renderToCanvas(opts.size, scale, opts.template, opts.photos, opts.text, opts.exif)
  const encode = (canvas: HTMLCanvasElement) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))

  // One attempt per rung, best first, stopping at the first rung that yields a
  // file. `fitsCanvas` above is the prediction; this loop is the recovery, and
  // it covers both shapes of the engine's silent refusal — a null encode
  // (WebKit's) and a canvas that took the draws and kept none of them — which
  // is spec §9's "catch, retry at lower scale, tell the user what happened".
  // `k` is widened deliberately: the ladder assigns rungs that are not one of
  // the multipliers `want` is restricted to.
  let k: number = want
  let canvas: HTMLCanvasElement | null = null
  let blob: Blob | null = null
  for (const rung of ladder) {
    k = rung
    canvas = draw(rung)
    // Only a rung that spends more than the floor is a bet on the device, and
    // only a bet is verified: the rungs within the floor are the sizes every
    // device honours, and asking them for a proof the budget already gives
    // would put a `getImageData` on the default export path for nothing.
    if (canvas.width * canvas.height > MAX_CANVAS_AREA && !holdsPixels(canvas)) continue
    blob = await encode(canvas)
    if (blob) break
  }

  if (!blob || !canvas) throw new Error('导出失败：图片太大，请降低输出长边')

  const filename = `frame_${canvas.width}x${canvas.height}_${stamp(new Date())}.png`
  return { blob, filename, k, downgraded: k !== want }
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
