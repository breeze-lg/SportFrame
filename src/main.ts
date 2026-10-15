import { render } from './core/render'
import { resolveSize, matRect, aspectOf } from './core/geometry'
import { TEMPLATES, getTemplate } from './core/templates'
import { drawMat, roundedRect } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { drawPlate, plateFields } from './core/plate'
import { initTheme } from './ui/theme'
import { createState } from './ui/state'
import { toast } from './ui/toast'
import { renderRail, styleThumb } from './ui/rail'
import { renderFields } from './ui/fields'
import {
  activePhoto,
  addPhotos,
  forgetThumb,
  removePhoto,
  renderPhotoList,
  selectPhoto,
  type PhotoList,
} from './ui/photos'
import {
  controlSpecs,
  renderControls,
  setControl,
  settleTemplate,
  syncControls,
  type ControlContext,
  type ControlId,
} from './ui/controls'
import { plaqueText } from './ui/plaque'
import { loadCustom, saveCustom, browserStorage, sessionStore } from './ui/custom'
import type { Photo, Size, Template, TextSlotId } from './core/types'
import { releasePhoto, wireInput } from './ui/input'
import {
  MAX_PHOTOS,
  dropBytes,
  forgetKey,
  loadSession,
  putBytes,
  restorePhotos,
  restoredActive,
  saveSession,
  sessionOf,
  type StoredPhoto,
} from './ui/session'
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
 * The canvas a template makes for the photograph in hand. This is the one place
 * the poster's layout size is decided: `draw` renders it and the rail's readout
 * names it, so the number the dock shows is the number the wall is drawn at
 * rather than a second opinion about it.
 */
function canvasSize(template: Template): Size {
  const photo = activePhoto(state)
  return resolveSize(
    template.canvas.ratio,
    state.longEdge,
    photo ? { width: photo.width, height: photo.height } : undefined,
  )
}

/**
 * The bare wall — the state the app boots in, and the state it returns to when
 * the last photograph is removed.
 *
 * `canvas#cv:not([width])` is what draws that state (`app.css`), so the sizing
 * has to be *un*-assigned here, not merely left alone: a canvas that kept its
 * `width` attribute would keep the last poster visible above an empty list,
 * which is a poster of a photograph the user just deleted. The surface is
 * cleared with it, so nothing survives in the pixels either.
 */
function blankWall(): void {
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  cv.removeAttribute('width')
  cv.removeAttribute('height')
}

/**
 * The one place the preview is laid out, at `k = 1`, from the same `render`
 * the export calls at `k`. A second layout path here — anything that computed
 * a position the renderer would not — would let a user export a poster they
 * never saw, which is the worst failure this architecture has.
 */
function draw(): void {
  const template = state.template
  const photo = activePhoto(state)
  // No photo, no poster: the default state is a bare wall, and `blankWall` is
  // what puts it back. Sizing the canvas here instead would hang a poster-sized
  // rectangle of background on that empty wall.
  if (!ctx || !template || !photo) {
    blankWall()
    return
  }

  const size = canvasSize(template)
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
    // the plate reads the photograph's own EXIF — see `activePhoto`
    exif: photo.exif,
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
 * Where the session record lives: the browser's own store, or nowhere.
 *
 * Deliberately not `saveStore()`: that one degrades to an in-memory `Storage`,
 * which is the right answer for a template the user just saved — it is real for
 * as long as this tab lives — and the wrong one for a record whose whole job is
 * to outlive a reload. A record that cannot be read back after a refresh is a
 * record that should not be written.
 */
const recordStore = browserStorage()

/**
 * Writes the session record: the photographs, which one is on the wall, the
 * mount, the words, the numbers.
 *
 * Called at the end of every mutation that changes it — a photograph added,
 * removed or selected, a mount picked, a slider moved, a word typed — because
 * there is no cheaper moment to be wrong at: a refresh is a keystroke away, and
 * a record that lags by one edit is a record that restores the wrong poster. It
 * is a few hundred bytes of JSON into `localStorage`, so the price is a
 * synchronous write that no user can perceive, and the alternative — a
 * debounce — is a window in which the app forgets something the user just did.
 */
function persistSession(): void {
  saveSession(recordStore, sessionOf(state))
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
 *
 * The chips are the styles themselves — a render of the poster each one makes
 * of the photograph on the wall (see `styleThumb`) — and the header beside 样式
 * names the mount that is on and the file it will produce. Both are painted
 * here rather than at each call site because both go stale at exactly the same
 * moments: a new photograph, a new pick, a save, a delete. A rail that showed
 * the style before last, or the photograph before last, is the same defect as a
 * chip that says nothing.
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
    (t) => styleThumb(t, activePhoto(state), state.longEdge),
  )
  const info = document.getElementById('rail-info')
  if (info) {
    const t = state.template
    // The poster's own size, not the file's: `state.size` is the 1× canvas and
    // the export doubles it, so a readout in export pixels would state a number
    // that appears nowhere on screen.
    const size = t ? canvasSize(t) : null
    info.textContent = t && size ? `${t.name} · ${size.W}×${size.H}` : ''
  }
}

/**
 * 文字 — the fields for whatever the current template prints.
 *
 * Called only where the *template* changes (a pick, a delete that moves the
 * selection, the first paint), never from `draw`. `draw` runs on every
 * keystroke, and rebuilding these inputs there would take the caret out of the
 * field the user is typing into on the first character they type.
 */
const fieldBox = document.getElementById('fields') as HTMLElement
const fieldRow = document.getElementById('field-row') as HTMLElement

function onText(id: TextSlotId, value: string): void {
  state.text[id] = value
  draw()
  // The words are the user's own work and the one thing on this screen that
  // cannot be rebuilt from anything else on it.
  persistSession()
}

function paintFields(): void {
  const drawn = renderFields(fieldRow, state.template?.text, state.text, onText)
  fieldBox.hidden = drawn === 0
}

/**
 * 画面 — the sliders for the mount's own geometry (see `src/ui/controls.ts`).
 *
 * Same shape as 文字 next door, and for the same reason: the rows are built
 * where the *template* changes and never from `draw`, which runs per slider
 * tick. A range input rebuilt under a moving pointer loses the drag.
 */
const controlBox = document.getElementById('controls') as HTMLElement
const controlHost = document.getElementById('control-row') as HTMLElement

/**
 * What the panel measures its ceilings against: the canvas the wall is drawn
 * at, and the aspect `render` will lay the photograph out with. Both come from
 * the same functions the renderer uses, so a slider's maximum is a claim about
 * the poster on screen rather than a second opinion about it.
 */
function controlContext(t: Template): ControlContext {
  const photo = activePhoto(state)
  return {
    size: canvasSize(t),
    aspect: aspectOf(t.canvas.ratio, photo ? { width: photo.width, height: photo.height } : undefined),
  }
}

/**
 * The two blocks of a record that decide what the poster looks like — the ones
 * the 画面 panel writes. Compared as JSON because they are plain data, and a
 * field-by-field comparison would be a second list of the fields to keep in
 * step with the first.
 */
function geometryOf(t: Template): string {
  return JSON.stringify([t.frame, t.background])
}

/**
 * 已调整 — the wall is showing something the rail would not hand you.
 *
 * The comparison is against the record the rail *resolves* for this id: the
 * built-in for a built-in, the stored record for a saved template. That is the
 * honest reading of "edited and not saved", and it is why re-picking the mount
 * you are already on clears the marker — `pick` hands back the stock record and
 * the numbers the user moved are gone, which is the one thing the marker exists
 * to warn them about.
 */
function paintAdjusted(t: Template): void {
  const source = getTemplate(t.id) ?? savedTemplates().find((s) => s.id === t.id)
  // Nothing to compare against means nothing was overridden: a record with no
  // source in the rail is a record this app did not derive from one.
  controlBox.dataset.adjusted =
    source && geometryOf(source) !== geometryOf(t) ? 'true' : 'false'
}

function paintControls(): void {
  const t = state.template
  controlBox.hidden = !t
  if (!t) return
  renderControls(controlHost, controlSpecs(t, controlContext(t)), onControl)
  paintAdjusted(t)
}

/**
 * One slider moved. The write is `setControl`'s — clamped against the layout,
 * and settled against what it disturbed — and everything after it is
 * bookkeeping: the sibling sliders get the new ceilings, the marker gets the
 * new answer, and the wall is redrawn from the one record that changed.
 *
 * `setControl` returning the record it was handed is a drag that landed on the
 * value already there, and that redraws nothing.
 */
function onControl(id: ControlId, raw: number): void {
  const t = state.template
  if (!t) return
  const next = setControl(t, id, raw, controlContext(t))
  if (next === t) return
  state.template = next
  syncControls(controlHost, controlSpecs(next, controlContext(next)))
  paintAdjusted(next)
  draw()
  persistSession()
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
  paintFields()
  // The mount's own numbers, not the ones the last mount was given: a pick is
  // how a user gets back to the template as authored.
  paintControls()
  draw()
  persistSession()
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

/**
 * 照片 — the left column: the list, and the model's rules applied to the app's
 * state (see `src/ui/photos.ts` for the rules themselves).
 *
 * The four functions here are the whole of how a photograph arrives, leaves and
 * becomes the one on the wall. Every one of them ends in `photoChanged`, which
 * is what keeps the poster, the rack of styles and the 画面 ceilings describing
 * the same file: the chips are renders of the *active* photograph, and a saved
 * `orig` template sizes its canvas from the file, so a switch or a removal
 * moves all of them or none.
 */
const photoBox = document.getElementById('photo-list') as HTMLElement
const photoCount = document.getElementById('photo-count') as HTMLElement

function photoList(): PhotoList {
  return { photos: state.photos, active: state.active }
}

function useList(next: PhotoList): void {
  state.photos = next.photos
  state.active = next.active
}

function paintPhotos(): void {
  renderPhotoList(photoBox, photoList(), onSelectPhoto, onRemovePhoto)
  photoCount.textContent =
    state.photos.length === 0 ? '' : `${state.active + 1} / ${state.photos.length}`
}

function photoChanged(): void {
  paintPhotos()
  paintRail(state.template?.id ?? null)
  paintControls()
  draw()
  // Every path that changes the list goes through here, so this is the one
  // place the record can be written for all of them.
  persistSession()
}

/**
 * The original bytes of a batch, so the next visit has the folder rather than
 * the memory of one.
 *
 * Not awaited by its caller: the wall is already drawn from memory, and a write
 * that takes a second must not hold up a render. The record is written again
 * when the bytes land, and `sessionOf` reads the keys off the photographs — so
 * "listed" becomes "comes back" at that moment and not before.
 *
 * `held` is read fresh for each photograph rather than once for the batch: the
 * record's `photos` is one entry per photograph in the list, which is what makes
 * a dropped key an index, and every store moves that array.
 */
async function keepPhotos(added: Photo[]): Promise<void> {
  let evicted = 0
  let refused = 0
  for (const photo of added) {
    const held = sessionOf(state).photos
    let stored: { entry: StoredPhoto | null; dropped: string[] }
    try {
      stored = await putBytes(photo, held)
    } catch {
      // Storing is a convenience and the wall is already drawn from memory, so
      // a throw in here is the same event as a refusal — and must not be an
      // unhandled rejection in the middle of a render.
      stored = { entry: null, dropped: [] }
    }
    for (const key of stored.dropped) {
      const victim = state.photos[held.findIndex((h) => h.key === key)]
      if (victim) forgetKey(victim)
      evicted += 1
    }
    if (!stored.entry) refused += 1
  }
  persistSession()
  if (evicted > 0) warnOnce('evicted')
  if (refused > 0) warnOnce('refused')
}

/** The two things the storage story can do that the user would want to know
 *  about, said once each per session: they are consequences of a limit rather
 *  than of anything the user did wrong, and a wall of toasts per photograph is
 *  not a message. */
const warned = new Set<string>()
function warnOnce(what: 'evicted' | 'refused'): void {
  if (warned.has(what)) return
  warned.add(what)
  toast(
    what === 'evicted'
      ? `存储已满：只保留最近 ${MAX_PHOTOS} 张，更早的刷新后不会回来`
      : '有照片无法保存，刷新后会丢失',
  )
}

function onSelectPhoto(index: number): void {
  // `selectPhoto` hands back the list it was given when the pick is the one
  // already on, so the comparison is against *that* list and not against a
  // fresh read — `photoList()` builds a new object every call, and comparing
  // with one would make this branch unreachable.
  const current = photoList()
  const next = selectPhoto(current, index)
  if (next === current) return
  useList(next)
  photoChanged()
}

/**
 * The × on a list row. The photograph goes, its blob URL goes with it (the list
 * owns that lifetime — see `releasePhoto`), and the thumbnail cache forgets it.
 * Removing the last photograph is not an error: the app's default state is a
 * bare wall, and `draw` is what puts it back.
 */
function onRemovePhoto(index: number): void {
  // Read before the list moves: the record's `photos` is one entry per
  // photograph in list order, so this is where the departing one's key is.
  const before = sessionOf(state).photos
  const { list, removed } = removePhoto(photoList(), index)
  if (!removed) return
  const key = before[index]?.key ?? ''

  useList(list)
  forgetThumb(removed)
  releasePhoto(removed)
  // Two halves of the same removal: the key so the record stops pointing at it,
  // the bytes so the disk stops holding them. The record is written by
  // `photoChanged` a moment later, by which time the key is already gone.
  forgetKey(removed)
  if (key) void dropBytes(key)
  photoChanged()
  toast(`已移除 ${removed.name}`)
}

const rail = document.getElementById('rail') as HTMLElement
const drop = document.getElementById('drop') as HTMLElement
const file = document.getElementById('file') as HTMLInputElement

wireInput(
  drop,
  file,
  (added) => {
    useList(addPhotos(photoList(), added))
    // The photograph can resize the canvas — a saved template with an `orig`
    // ratio is sized from the file — and the 画面 ceilings are measured against
    // the canvas, so the record is settled against the new one before anything
    // draws. For the nine built-ins this is the identity: their ratios are
    // constants, so the canvas a photograph lands on is the canvas that was
    // already there, and `settleTemplate` hands back the record it was given.
    if (state.template) {
      state.template = settleTemplate(state.template, controlContext(state.template))
    }
    photoChanged()
    // ...and then the bytes, which is the half that survives a refresh. Not
    // awaited: the wall is drawn, and the record is written again when the
    // store lands (`keepPhotos`), so "listed" becomes "comes back" a moment
    // after the user sees the photograph on the wall.
    void keepPhotos(added)
    // `added[0]` and not the last one: `addPhotos` puts the wall on the *first*
    // of the batch, and a toast naming a photograph the user is not looking at
    // is worse than no toast.
    const shown = added[0]!
    toast(
      added.length === 1
        ? `已载入 ${shown.width} × ${shown.height}`
        : `已载入 ${added.length} 张，当前 ${shown.width} × ${shown.height}`,
    )
  },
  (msg) => toast(msg),
  readExif,
)

document.getElementById('save')?.addEventListener('click', async () => {
  const template = state.template
  const photo = activePhoto(state)
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
      exif: photo.exif,
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
    // the fields and the sliders belong to the template, so a delete that moves
    // the selection has to move them with it
    paintFields()
    paintControls()
    // the canvas is showing a template that no longer exists until this runs
    draw()
  }
  persistSession()
  toast(`已删除模板：${victim.name}`)
}

/**
 * A template's numbers, as its own objects.
 *
 * `state.template` is a `TEMPLATES` singleton until a slider moves, and even
 * then the `frame`/`background` blocks it carries are objects the rail is also
 * reading. A saved record outlives both, so it is copied by value rather than
 * by reference. A JSON round trip rather than `structuredClone`: the record is
 * plain JSON data — it is handed to `JSON.stringify` a few lines below — and
 * `structuredClone` is not in every WebKit this app runs on.
 */
function deepCopy(t: Template): Template {
  return JSON.parse(JSON.stringify(t)) as Template
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
 *
 * The copy is deep, and that is what makes the 画面 sliders persistable: they
 * write their numbers into `state.template`, so the record this reads is the
 * geometry the user is looking at. Sharing a nested block instead would store a
 * live reference, and the next slider drag would edit a record that is already
 * on disk.
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
  const copy: Template = { ...deepCopy(template), id: `custom-${Date.now()}`, name, premium: false }
  const where = persist(copy)
  // Before the toast, not after: what the user is told has to describe a rail
  // they are already looking at.
  paintRail(state.template?.id ?? null)
  if (where === 'failed') toast('保存失败：浏览器存储不可用')
  else if (where === 'session') toast(`已保存模板：${name}（仅本次会话，浏览器存储不可用）`)
  else toast(`已保存模板：${name}`)
})

paintPhotos()
paintRail(state.template?.id ?? null)
paintFields()
paintControls()
draw()

// ---------------------------------------------------------------------------
// Where the last visit left off.
//
// The record is read before the first paint, so the app comes up already
// wearing the mount and the words the user left it with rather than flashing
// the boot template at them. The *photographs* come after, because their bytes
// have to be read back out of IndexedDB and decoded, which is a job for the
// event loop; until they land the wall is bare, which is a state this app is
// already honest about being in.
// ---------------------------------------------------------------------------
const restored = loadSession(recordStore)

if (restored) {
  state.text = restored.text
  if (restored.template) {
    // A stored built-in comes back as the singleton it is, not as a copy of it.
    // The copies are what 存为模板 makes, and this one was made by the session
    // writer; everything downstream — the 已调整 marker, the rail's chips — reads
    // the difference between "the template" and "a template somebody edited".
    const stock = getTemplate(restored.template.id)
    state.template =
      stock && geometryOf(stock) === geometryOf(restored.template) ? stock : restored.template
  }
  // Paint what came back, in the order a pick paints it: the mount, the plaque,
  // the words, the numbers, the wall.
  paintRail(state.template?.id ?? null)
  if (state.template) paintPlaque(state.template)
  paintFields()
  paintControls()
  draw()
}

if (restored && restored.photos.some((p) => p.key !== '')) {
  const entries = restored.photos
  void (async () => {
    try {
      const { photos, at } = await restorePhotos(entries)
      if (photos.length === 0) return
      const current = photoList()
      if (current.photos.length === 0) {
        useList({ photos, active: restoredActive(at, restored.active) })
      } else {
        // The user added a photograph while the restore was still reading (a
        // drop during a slow decode). Theirs is the one they just chose, so the
        // restored list goes underneath it and the wall stays where they put
        // it — the alternative is a wall that jumps out from under them.
        useList({ photos: [...photos, ...current.photos], active: current.active + photos.length })
      }
      photoChanged()
    } catch {
      // A restore that throws is a session that does not come back. The app is
      // already on screen and already usable, and there is nothing here the
      // user would rather be told than the bare wall they can see.
    }
  })()
}

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
    // Through the same list and the same repaint as a photograph the user
    // loaded: the demo is the front door, and a front door that skipped the
    // list would leave the left column empty with a poster on the wall.
    const demo: Photo = {
      el: im,
      width: im.naturalWidth,
      height: im.naturalHeight,
      name: 'demo',
      exif: null,
    }
    useList(addPhotos(photoList(), [demo]))
    photoChanged()
    // ...and it persists like any other photograph, so a reload during a demo
    // comes back to the demo rather than to the bare wall behind it.
    void keepPhotos([demo])
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
