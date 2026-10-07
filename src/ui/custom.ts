import { validateTemplate } from '../core/templates'
import type { Template } from '../core/types'

const KEY = 'frame-app-custom-v1'

/**
 * The read half of the storage seam. Nothing that comes back from a browser
 * store is trustworthy — it can be a record this app never wrote: an older
 * version's shape, an extension's edit, or a write that landed half-finished —
 * so this degrades in steps, and every step degrades to *fewer templates*, not
 * to a throw and not to a wiped library.
 *
 * The per-entry `validateTemplate` is the point of the whole function: a blob
 * holding one good record and one corrupt one yields the good one. Rejecting
 * the blob wholesale would turn a single bad entry into the silent loss of
 * every template the user ever saved, which is the one outcome worse than
 * showing nothing.
 */
export function loadCustom(storage: Storage | null): Template[] {
  if (!storage) return []
  let raw: string | null = null
  try {
    raw = storage.getItem(KEY)
  } catch {
    // private modes and some webviews throw on access rather than returning
    // null; a store we cannot read is a store with no custom templates
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Template[] = []
  for (const entry of parsed) {
    const v = validateTemplate(entry)
    if (v.ok) out.push(v.value)
  }
  return out
}

/**
 * The write half. Returns a boolean instead of throwing because the caller has
 * a user to tell: quota exhaustion and Safari's private mode both fail here,
 * and the honest answer to `保存失败` is a toast, not an unhandled rejection.
 */
export function saveCustom(storage: Storage | null, list: Template[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

/**
 * The only place `window.localStorage` is touched. Reading the property itself
 * throws — not returns null — where storage is blocked, which is why this is a
 * try rather than a null check, and why the rest of the module takes `Storage |
 * null` as a parameter instead of calling this directly.
 */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Spec §9's session-only degradation, as a `Storage`: a browser that never
 * gave us a store, or refuses a write halfway through the session, still gets a
 * working 存为模板 for as long as the tab lives.
 *
 * It is a `Storage` and not a second list on purpose. Behind the same
 * interface, `loadCustom` and `saveCustom` need no session branch, the caller
 * keeps one read-modify-write path whether or not a browser store exists, and a
 * template that went to memory is — to everything above this seam — a template
 * that went to disk. A parallel array would be a second source of truth for the
 * same list, and the rail reading both is how one saved template becomes two
 * chips.
 *
 * A plain object with its own methods, never `Object.create(Storage.prototype)`:
 * the reason we are here is that the real `Storage` is throwing, and inheriting
 * from it would put the throwing implementation back into the chain.
 *
 * Memoised, so "the session store" is one store. Two calls that each minted a
 * fresh `Map` would hand the caller a different list than the one it wrote to,
 * and the second save would silently drop the first.
 */
let session: Storage | null = null

export function sessionStore(): Storage {
  if (!session) {
    const m = new Map<string, string>()
    session = {
      get length() { return m.size },
      clear: () => m.clear(),
      getItem: (k: string) => m.get(k) ?? null,
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      removeItem: (k: string) => { m.delete(k) },
      setItem: (k: string, v: string) => { m.set(k, v) },
    } as Storage
  }
  return session
}
