import { render } from './core/render'
import { resolveSize, matRect } from './core/geometry'
import { TEMPLATES, getTemplate } from './core/templates'
import { drawMat, roundedRect } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { drawPlate, plateFields } from './core/plate'
import { initTheme } from './ui/theme'
import { createState } from './ui/state'
import { toast } from './ui/toast'
import { renderRail } from './ui/rail'
import { plaqueText } from './ui/plaque'
import { loadCustom, saveCustom, browserStorage, sessionStore } from './ui/custom'
import type { Template } from './core/types'
import { wireInput } from './ui/input'
import { readExif } from './core/exif'
import { isUnlocked, canExport } from './entitlements'
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

/**
 * Where saved templates live, and the whole of spec §9's degradation.
 *
 * `browserStorage()` answers `null` where the property itself throws (private
 * mode, a blocked webview); a store that answers and *then* refuses a write
 * (quota) only fails at `saveCustom`. Both are the same event to a user — the
 * template is not going to be there tomorrow — so both set `browserStore` to
 * null, and `saveStore()` becomes the one answer to "where do templates go":
 * the same store for the write and for the read. That is what keeps a session
 * list from being a *second* source the rail also reads, which is how one saved
 * template becomes two chips.
 */
let browserStore: Storage | null = browserStorage()

function saveStore(): Storage {
  return browserStore ?? sessionStore()
}

/** What the user has saved, from whichever store is currently carrying it. */
function savedTemplates(): Template[] {
  return loadCustom(saveStore())
}

/**
 * The rail's list: the built-ins first and in their authored order — they are
 * the product's own recommendation, and what a first-time visitor is choosing
 * between — then the user's saved templates, appended. A template you made is
 * an addition to the nine the app ships with, not a substitute for them.
 *
 * Rendering and resolving read the same store, so every chip that is drawn is
 * a chip that can be picked; this is the function both the boot and the save
 * handler call, which is what makes a just-saved template appear without a
 * reload.
 */
function paintRail(activeId: string | null): void {
  const saved = savedTemplates()
  renderRail(
    rail,
    [...TEMPLATES, ...saved],
    activeId,
    pick,
    new Set(saved.map((t) => t.id)),
    removeSaved,
  )
}

function pick(id: string): void {
  // Both lists. A saved template cannot collide with a built-in id, so the
  // built-ins answer first and the saved list answers for the rest — the same
  // merge `paintRail` draws, so a chip on the rail is never a chip that
  // resolves to nothing.
  const t = getTemplate(id) ?? savedTemplates().find((x) => x.id === id)
  if (!t) return
  state.template = t
  paintRail(id)
  paintPlaque(t)
  draw()
}

/**
 * The plaque under the rail, re-decided on every pick. It shows only for a
 * template that is premium *and* locked, and in v1 `isUnlocked` answers true
 * for everything, so the line is always empty: the plaque is wired, and its v1
 * behaviour is to stay hidden. A saved copy of the premium template cannot
 * light it up either — copies are written `premium: false`, the same reason
 * they cannot mint a second brass chip on the rail.
 */
function paintPlaque(t: Template): void {
  const plaque = document.getElementById('plaque')
  if (!plaque) return
  const line = plaqueText(t, isUnlocked(t))
  plaque.hidden = line === ''
  plaque.textContent = line
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
  // The seam, and the whole of it: one call site (spec §10). In v1 the verdict
  // is always `ok` and the export runs exactly as it did before this task
  // existed. What the shape buys is the moment it stops being ok — the user is
  // told why *before* any work is done and before anything is downloaded, and
  // the only file that has to change to make that happen is `entitlements.ts`.
  const verdict = canExport(template, 2)
  if (!verdict.ok) {
    toast(verdict.reason ?? '需要解锁')
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
    // The scale that was *drawn*, not the one that was asked for: the export
    // walks down a ladder, so naming a fixed 1× here would describe a file the
    // user is not holding the moment a fallback lands anywhere else.
    if (downgraded) toast(`图片过大，已按 ${k}× 导出`)
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
 * Appends `copy` to the saved list and reports where it landed — `stored` in
 * the browser's own store, `session` in memory only, or `failed` if even the
 * memory write did not take. The caller tells the user which; a template that
 * is real for this tab and a template that is real tomorrow are not the same
 * promise.
 *
 * A refused write is spec §9's degradation: the copy moves to the session store
 * rather than evaporating, and it takes everything the rail is showing with it,
 * so a user who had templates on screen does not watch them disappear because
 * the disk filled up. The write goes to the old store first and that store is
 * abandoned only once it has refused, so the carried list is copied once and
 * written once.
 */
function persist(copy: Template): 'stored' | 'session' | 'failed' {
  const target = saveStore()
  if (saveCustom(target, [...loadCustom(target), copy])) return browserStore ? 'stored' : 'session'
  const carried = loadCustom(target)
  browserStore = null
  return saveCustom(saveStore(), [...carried, copy]) ? 'session' : 'failed'
}

/**
 * The × on a saved chip: the same read-modify-write `persist` does, against the
 * same store, so the rail and the store cannot disagree about what is saved.
 *
 * It degrades the other way round from a failed *save*. A save that cannot be
 * written still has the user's template in hand, so it carries the list into
 * the session store; a delete that cannot be written has nothing to carry —
 * the template is still there — and moving to the session store would take a
 * copy of the very record being deleted into the store the rail then reads.
 * So a refused delete is refused out loud and changes nothing: the chip stays,
 * and the user is told, rather than watching a template vanish and reappear on
 * the next load.
 *
 * Deleting the selected template has to leave the app pointed at something
 * real. The fallback is `TEMPLATES[0]`, the same template the app boots on, and
 * the wall is redrawn — a poster still showing a style that is no longer on the
 * rail is the one state this must not leave behind. A built-in is not
 * deletable: the rail draws no × for one, and this refuses the id outright, so
 * neither a stale chip nor a hand-called handler can reach the store with one.
 */
function removeSaved(id: string): void {
  if (getTemplate(id)) return
  const target = saveStore()
  const list = loadCustom(target)
  const victim = list.find((t) => t.id === id)
  if (!victim) return
  if (!saveCustom(target, list.filter((t) => t.id !== id))) {
    toast('删除失败：存储不可用')
    return
  }

  const wasActive = state.template?.id === id
  if (wasActive) state.template = TEMPLATES[0] ?? null
  // Rail first, then the toast: what the user is told has to describe a rail
  // they are already looking at.
  paintRail(state.template?.id ?? null)
  if (wasActive && state.template) {
    paintPlaque(state.template)
    // the canvas is showing a template that no longer exists until this runs
    draw()
  }
  toast(`已删除模板：${victim.name}`)
}

/**
 * 存为模板: the current settings, plus a name, become a record in the saved
 * list — and, through `paintRail`, a chip on the rail, immediately.
 *
 * A copy, never the live template — `state.template` is one of the `TEMPLATES`
 * singletons, and writing it under a fresh id would put a built-in's identity
 * into a store that outlives this page load. `premium: false` because
 * entitlement is checked against the built-in set and a saved copy is not a
 * purchase; the id is a timestamp because two saves of the same style are two
 * templates and collapsing them would lose one.
 */
document.getElementById('saveTpl')?.addEventListener('click', () => {
  const template = state.template
  if (!template) {
    // The guard is right and the silence was not: a press that produces no
    // dialog, no toast and no chip reads as a broken button.
    toast('请先选择样式')
    return
  }
  const name = (prompt('模板名称', template.name + ' 副本') || '').trim()
  if (!name) return
  const copy: Template = { ...template, id: `custom-${Date.now()}`, name, premium: false }
  const where = persist(copy)
  // Before the toast, not after: what the user is told has to describe a rail
  // they are already looking at.
  paintRail(state.template?.id ?? null)
  if (where === 'failed') toast('保存失败：浏览器存储不可用')
  else if (where === 'session') toast(`已保存模板：${name}（仅本次会话，浏览器存储不可用）`)
  else toast(`已保存模板：${name}`)
})

paintRail(state.template?.id ?? null)
draw()

// ---------------------------------------------------------------------------
// Demo affordance — user-facing, and not gated on ?dev=1.
//
// `?demo=1` puts a procedurally generated photograph on the wall so that
// nobody has to find a file before they can see what the app does. It is the
// product's own front door for a reviewer, a screenshot, or a first look — the
// reason it is not behind the `?dev=1` block below, which exists to be
// invisible to users.
//
// It lives at the foot of the module rather than beside `draw()` for one
// reason: it calls `pick`, and `pick` reads `rail`, a `const` declared above.
// Running earlier would be a temporal-dead-zone crash, not a race.
//
// The photo is `demo`-named and EXIF-less on purpose: the spec plate is the
// one surface that must *not* appear unless real metadata is behind it, so the
// demo is also the standing check that it stays absent.
// ---------------------------------------------------------------------------
if (new URLSearchParams(location.search).get('demo') === '1') {
  const d = document.createElement('canvas')
  d.width = 1400
  d.height = 1050
  const c = d.getContext('2d')
  if (c) {
    const g = c.createLinearGradient(0, 0, 1400, 1050)
    g.addColorStop(0, '#c9531f')
    g.addColorStop(0.45, '#e8a13c')
    g.addColorStop(1, '#4a6b3a')
    c.fillStyle = g
    c.fillRect(0, 0, 1400, 1050)
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(${(200 + Math.random() * 55) | 0},${(120 + Math.random() * 80) | 0},${(40 + Math.random() * 60) | 0},.5)`
      c.beginPath()
      c.arc(Math.random() * 1400, Math.random() * 600, 8 + Math.random() * 40, 0, 7)
      c.fill()
    }
  }
  const im = new Image()
  im.onload = () => {
    state.photo = { el: im, width: im.naturalWidth, height: im.naturalHeight, name: 'demo', exif: null }
    state.exif = null
    draw()
  }
  im.src = d.toDataURL()

  const tplId = new URLSearchParams(location.search).get('tpl')
  if (tplId && getTemplate(tplId)) pick(tplId)
}

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
    drawPlate,
    plateFields,
  }
  w.__frameTemplates = { TEMPLATES, getTemplate }
  w.__frameCeremony = { showCeremony }
  w.__frameExport = { exportPng, renderToCanvas, fitsCanvas, stamp }
}
