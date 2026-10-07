import { render } from './core/render'
import { resolveSize, matRect } from './core/geometry'
import { TEMPLATES, getTemplate } from './core/templates'
import { drawMat, roundedRect } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { initTheme } from './ui/theme'
import { createState } from './ui/state'
import { toast } from './ui/toast'
import { renderRail } from './ui/rail'
import { loadCustom, saveCustom, browserStorage } from './ui/custom'
import type { Template } from './core/types'
import { wireInput } from './ui/input'
import { readExif } from './core/exif'
import {
  exportPng,
  download,
  isIOS,
  showCeremony,
  blobToDataUrl,
  renderToCanvas,
  fitsCanvas,
  stamp,
} from './ui/export'
import './styles/tokens.css'
import './styles/app.css'

initTheme()

const state = createState({ template: TEMPLATES[0] ?? null })
const cv = document.getElementById('cv') as HTMLCanvasElement
const ctx = cv.getContext('2d')

/**
 * The one place the preview is laid out, at `k = 1`, from the same `render`
 * the export calls at `k`. A second layout path here — anything that computed
 * a position the renderer would not — would let a user export a poster they
 * never saw, which is the worst failure this architecture has.
 */
function draw(): void {
  const template = state.template
  const photo = state.photo
  // No photo, no poster: the default state is a bare wall (the shell's
  // `canvas#cv:not([width])` guard hides the undrawn canvas), and sizing it
  // here would hang a poster-sized rectangle of background on that empty wall.
  if (!ctx || !template || !photo) return

  const size = resolveSize(template.canvas.ratio, state.longEdge, {
    width: photo.width,
    height: photo.height,
  })
  state.size = size
  // Sized by assignment and never by CSS: `canvas.width = n` reflects to the
  // `width` attribute, which is what releases the guard above and reveals the
  // canvas. A `style.width` here would leave it hidden with the poster already
  // drawn inside it.
  cv.width = size.W
  cv.height = size.H

  render({
    ctx,
    size,
    k: 1,
    template,
    photos: [photo],
    text: state.text,
    exif: state.exif,
  })
}

function pick(id: string): void {
  const t = getTemplate(id)
  if (!t) return
  state.template = t
  renderRail(rail, TEMPLATES, id, pick)
  draw()
}

const rail = document.getElementById('rail') as HTMLElement
const drop = document.getElementById('drop') as HTMLElement
const file = document.getElementById('file') as HTMLInputElement

wireInput(
  drop,
  file,
  (photo) => {
    state.photo = photo
    state.exif = photo.exif
    draw()
    toast(`已载入 ${photo.width} × ${photo.height}`)
  },
  (msg) => toast(msg),
  readExif,
)

document.getElementById('save')?.addEventListener('click', async () => {
  const template = state.template
  const photo = state.photo
  if (!photo || !template) {
    toast('请先载入图片')
    return
  }
  try {
    const { blob, filename, k, downgraded } = await exportPng({
      size: state.size,
      template,
      photos: [photo],
      text: state.text,
      exif: state.exif,
      want: 2,
    })
    if (downgraded) toast('图片过大，已按 1× 导出')
    // iOS has no download attribute to speak of; the ceremony's long-press is
    // the save there, so handing it a file as well would only confuse it.
    if (!isIOS()) download(blob, filename)

    const dataUrl = await blobToDataUrl(blob)
    showCeremony(
      dataUrl,
      state.size.W * k,
      state.size.H * k,
      () => void draw(),
      isIOS() ? '长按图片存储到相册' : undefined,
    )
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败')
  }
})

/**
 * 存为模板: the current settings, plus a name, become a record in storage.
 *
 * A copy, never the live template — `state.template` is one of the `TEMPLATES`
 * singletons, and writing it under a fresh id would put a built-in's identity
 * into a store that outlives this page load. `premium: false` because
 * entitlement is checked against the built-in set and a saved copy is not a
 * purchase; the id is a timestamp because two saves of the same style are two
 * templates and collapsing them would lose one.
 *
 * Nothing is rendered from the result yet — the rail draws `TEMPLATES` and
 * `pick` resolves through `getTemplate`, which only knows built-ins — so a
 * failed write has to be told to the user out loud rather than implied by a
 * chip that never appears.
 */
document.getElementById('saveTpl')?.addEventListener('click', () => {
  if (!state.template) return
  const name = (prompt('模板名称', state.template.name + ' 副本') || '').trim()
  if (!name) return
  const list = loadCustom(browserStorage())
  const copy: Template = { ...state.template, id: `custom-${Date.now()}`, name, premium: false }
  if (saveCustom(browserStorage(), [...list, copy])) {
    toast(`已保存模板：${name}`)
  } else {
    toast('保存失败：浏览器存储不可用')
  }
})

renderRail(rail, TEMPLATES, state.template?.id ?? null, pick)
draw()

// ---------------------------------------------------------------------------
// Dev affordance — see spec §8. Enabled only with ?dev=1.
//
// All five handles are one block here: Tasks 4-9 each appended the slice its
// pixel spec needed, and this is the consolidated form those slices were
// standing in for. `?dev=1` and not `?debug=1`: the switch is not a preference,
// it is the predicate that keeps this off in production.
// ---------------------------------------------------------------------------
const probeCanvas = document.createElement('canvas')

if (new URLSearchParams(location.search).has('dev')) {
  const w = window as unknown as Record<string, unknown>
  w.__frame = {
    canvas: probeCanvas,
    size: () => ({ W: probeCanvas.width, H: probeCanvas.height }),
    setSize: (W: number, H: number) => {
      probeCanvas.width = W
      probeCanvas.height = H
    },
    ctx: () => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return c
    },
    sample: (x: number, y: number, sw: number, sh: number) => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return Array.from(c.getImageData(x, y, sw, sh).data)
    },
    pixel: (x: number, y: number): [number, number, number, number] => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      const d = c.getImageData(x, y, 1, 1).data
      return [d[0] as number, d[1] as number, d[2] as number, d[3] as number]
    },
  }
  // the pieces every renderer pixel spec composes by hand, so none of them has
  // to reach into `src/` for a function the app itself does not import
  w.__frameCore = {
    render,
    drawMat,
    drawBackground,
    drawText,
    measureToFit,
    frameFont,
    matRect,
    roundedRect,
  }
  w.__frameTemplates = { TEMPLATES, getTemplate }
  w.__frameCeremony = { showCeremony }
  w.__frameExport = { exportPng, renderToCanvas, fitsCanvas, stamp }
}
