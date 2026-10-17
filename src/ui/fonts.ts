import { FONT_CHOICES, FONT_GROUP_LABELS, USER_PREFIX, userFontId, userFontName } from '../core/fonts'
import { dropFont, fontBytes, fontNames, putFont } from './session'

/**
 * The half of the font story that touches the browser: registering a face,
 * remembering the ones the user brought, and drawing the picker.
 *
 * The other half — what a family id *means*, and the stack behind it — is
 * `src/core/fonts.ts`, because `drawText` needs it and `src/core/` never imports
 * from `src/ui/`. This module is the only thing here that knows `FontFace`
 * exists.
 *
 * A loaded font is registered under its own name and stored under it too, so the
 * name in a record (`user:字魂手写体`) is the name the browser draws with and the
 * key the bytes are filed under. There is no mapping table to go stale.
 */

/** Names already in `document.fonts`. A set rather than a check against
 *  `document.fonts` itself: reading a `FontFaceSet` is fine, but a load is an
 *  await and this is what keeps it to one per font per session. */
const registered = new Set<string>()

/** Registers a face and waits until it can actually be drawn with — which is
 *  the moment a caller should redraw, and the reason this is async at all: a
 *  canvas that draws text before the face has loaded draws the fallback, and the
 *  fallback's metrics are what `measureToFit` would then have fitted to. */
async function register(name: string, bytes: ArrayBuffer): Promise<boolean> {
  if (registered.has(name)) return true
  try {
    const face = new FontFace(name, bytes)
    await face.load()
    document.fonts.add(face)
    registered.add(name)
    return true
  } catch {
    // An unsupported or corrupt file. Not an error worth a toast: the picker
    // simply does not gain the entry, and the poster keeps the face it had.
    return false
  }
}

/** Registers the font for a `user:` family id if it is not up yet, reading the
 *  bytes back out of the store. Answers whether the face is now drawable. */
export async function ensureFont(family: string): Promise<boolean> {
  const name = userFontName(family)
  if (!name || registered.has(name)) return registered.has(name)
  const bytes = await fontBytes(name)
  if (!bytes) return false
  return register(name, bytes)
}

/** Every family id the picker may offer: the presets, then the user's own. */
export async function fontOptions(): Promise<{ group: string; id: string; label: string }[]> {
  const presets = FONT_CHOICES.map((f) => ({
    group: FONT_GROUP_LABELS[f.group],
    id: f.id,
    label: f.label,
  }))
  const mine = (await fontNames()).map((name) => ({
    group: FONT_GROUP_LABELS.user,
    id: userFontId(name),
    label: name,
  }))
  return [...presets, ...mine]
}

export type Loaded = { ok: true; id: string; name: string } | { ok: false; error: string }

/**
 * Takes a font file the user picked, registers it and keeps it.
 *
 * The name is the file's own stem, extension stripped: a browser cannot read a
 * font's internal family name without parsing the file, and `FontFace` takes any
 * name it is given — so the name the user sees in the picker is the name of the
 * file they chose, which is the one they can recognise. A file with no
 * extension, or a name that is only an extension, is refused rather than
 * registered as `''`.
 *
 * The bytes are written to the store *beside* the registration and not after a
 * redraw: a font that is drawable now and gone after a refresh is a promise this
 * can keep in one step.
 */
export async function addFontFile(file: File): Promise<Loaded> {
  const name = file.name.replace(/\.[^.]+$/, '').trim()
  if (!name) return { ok: false, error: '文件名里没有可用的字体名' }
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength === 0) return { ok: false, error: '字体文件是空的' }
  if (!(await register(name, bytes))) return { ok: false, error: `读不出这个字体：${file.name}` }
  await putFont(name, bytes)
  return { ok: true, id: userFontId(name), name }
}

/** Forgets a loaded font: out of the store, and out of the session's own set so
 *  a reload starts over. The face itself stays in `document.fonts` — a
 *  `FontFaceSet` has no `delete` for a face this app added, and a record that
 *  still names it can still draw with it until the page is left. */
export async function forgetFont(name: string): Promise<void> {
  registered.delete(name)
  await dropFont(name)
}

/** Whether this family id is a font the user loaded and nothing else is. */
export function isLoaded(family: string | undefined): boolean {
  return !!family && family.startsWith(USER_PREFIX) && registered.has(userFontName(family))
}
