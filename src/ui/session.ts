import { readExif } from '../core/exif'
import { validateTemplate } from '../core/templates'
import { decodePhoto } from './input'
import type { AppState } from './state'
import type { Photo, Template, TextSlotId } from '../core/types'

/**
 * Where a refresh picks up: the photographs the user loaded, which one was on
 * the wall, the style, the words, and the numbers the 画面 sliders set.
 *
 * Two stores, because they hold two different sizes of thing:
 *
 *  - the *record* — an index into what is stored, which style, the words — is
 *    small, structured, and read synchronously at boot, so it is a `Storage`
 *    beside `frame-app-custom-v1` (see `src/ui/custom.ts`), with the same
 *    degrade-rather-than-throw discipline.
 *  - the *bytes* — the original files, so a restored photograph is the file the
 *    user picked and not a re-encode of it — are tens of megabytes each, which
 *    is not what `localStorage` is for. They go to IndexedDB, keyed by the
 *    record.
 *
 * The record is the only thing that knows the list's *order*, and the order is
 * what `active` indexes into. So the record is written first and the bytes
 * follow: a photograph that is in the record with no bytes behind it yet is a
 * photograph that does not come back, which is the honest reading of "it was
 * still being stored when the tab closed".
 *
 * Nothing here is a promise the browser has made: private modes refuse
 * IndexedDB, quotas refuse writes, and a half-written entry decodes to nothing.
 * Every path degrades to *fewer photographs* and never to a throw — a session
 * that cannot be restored is a fresh session, which is where the app started.
 */

const KEY = 'frame-app-session-v1'
const DB = 'frame-app-photos'
const STORE = 'photos'
const DB_VERSION = 1

/**
 * How many photographs are kept for the next visit, and how much disk they may
 * spend.
 *
 * A working folder, not an archive: what this buys is that a refresh — a stray
 * ⌘R, a crash, a phone that reclaims the tab — does not cost the user the
 * folder they were going through. Twenty-four 12 MP frames is around 150 MB,
 * which is inside the size cap as well, and past either one the oldest go.
 * There is no way to know a browser's quota from script, so the caps are
 * guesses and the write's own failure is the real limit (see `putBytes`).
 */
export const MAX_PHOTOS = 24
export const MAX_BYTES = 256 * 1024 * 1024

export type StoredPhoto = {
  /** The key its bytes live under in IndexedDB. */
  key: string
  name: string
  /** What it costs, so the size cap can be applied from the record alone
   *  without reading a single blob back. */
  bytes: number
}

export type Session = {
  template: Template | null
  text: Partial<Record<TextSlotId, string>>
  photos: StoredPhoto[]
  active: number
}

/**
 * Where a photograph's bytes live, kept beside the photograph rather than on it.
 *
 * `Photo` is a core type — the renderer takes it, and the renderer must never
 * learn where a file is cached. A weak map also gets the lifetime right for
 * free: the entry goes when the photograph does, so a session that loads and
 * drops its way through a folder does not accumulate keys for photographs
 * nothing can draw any more.
 */
const stored = new WeakMap<Photo, StoredPhoto>()

/** A key that is unique on this device and needs no crypto API: the app runs on
 *  WebKit versions older than `crypto.randomUUID`, and a counter beside a
 *  timestamp is all the uniqueness a per-device photo store needs. */
let seq = 0
function nextKey(): string {
  seq += 1
  return `p${Date.now().toString(36)}-${seq}`
}

/**
 * The record for the state as it stands.
 *
 * `photos` is **one entry per photograph in the list, in order** — the same
 * length, always — and an entry whose `key` is empty is a photograph with no
 * bytes behind it: one whose store is still in flight, or one that was evicted
 * to make room for a newer one. That invariant is what lets `active` be the
 * list's own index, and it is why eviction clears a key rather than removing an
 * entry: a shorter array would move every photograph after the hole and change
 * which one `active` means.
 */
export function sessionOf(state: AppState): Session {
  return {
    template: state.template,
    text: state.text,
    photos: state.photos.map((p) => stored.get(p) ?? { key: '', name: p.name, bytes: 0 }),
    active: state.active,
  }
}

/**
 * The record, validated field by field so that one bad entry costs one
 * photograph rather than the session.
 *
 * `localStorage` is not a trusted source: it can hold a record an older build
 * wrote, an extension's edit, or half a write. A non-object, a broken template,
 * an `active` that is not an index — each degrades on its own, and an
 * unreadable record is a fresh session.
 */
export function loadSession(storage: Storage | null): Session | null {
  if (!storage) return null
  let raw: string | null = null
  try {
    raw = storage.getItem(KEY)
  } catch {
    // private modes and some webviews throw on access rather than answering
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>

  const photos: StoredPhoto[] = []
  if (Array.isArray(o.photos)) {
    for (const entry of o.photos) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as Record<string, unknown>
      if (typeof e.key !== 'string' || e.key === '') continue
      if (typeof e.name !== 'string') continue
      const bytes = typeof e.bytes === 'number' && Number.isFinite(e.bytes) ? e.bytes : 0
      photos.push({ key: e.key, name: e.name, bytes })
    }
  }

  const text: Partial<Record<TextSlotId, string>> = {}
  if (typeof o.text === 'object' && o.text !== null) {
    for (const id of ['title', 'sub', 'sign'] as TextSlotId[]) {
      const v = (o.text as Record<string, unknown>)[id]
      if (typeof v === 'string' && v !== '') text[id] = v
    }
  }

  let template: Template | null = null
  if (o.template !== undefined && o.template !== null) {
    const v = validateTemplate(o.template)
    if (v.ok) template = v.value
  }

  const active =
    typeof o.active === 'number' && Number.isInteger(o.active) && o.active >= 0 && o.active < photos.length
      ? o.active
      : 0

  return { template, text, photos, active }
}

export function saveSession(storage: Storage | null, session: Session): boolean {
  if (!storage) return false
  try {
    storage.setItem(KEY, JSON.stringify(session))
    return true
  } catch {
    return false
  }
}

/**
 * The keys that have to go for one more photograph of `incoming` bytes to fit,
 * oldest first — the whole policy, as a pure function over the record.
 *
 * Oldest first because the record is the list in order and the list is
 * append-only: what has been there longest is what the user has already looked
 * at, and it is the one they can re-add by picking the file again. The count cap
 * and the size cap are the same rule applied twice.
 */
export function makeRoom(
  held: StoredPhoto[],
  incoming: number,
  caps: { photos: number; bytes: number } = { photos: MAX_PHOTOS, bytes: MAX_BYTES },
): { drop: string[]; fits: boolean } {
  const drop: string[] = []
  let total = held.reduce((n, p) => n + p.bytes, 0)
  let count = held.length

  // One of the incoming photographs is one of the count, and the record can
  // never hold more than the cap — so the first key to go is the head of the
  // list, and it goes before the size is even considered.
  const remaining = [...held]
  while (count + 1 > caps.photos || total + incoming > caps.bytes) {
    const oldest = remaining.shift()
    if (!oldest) break
    drop.push(oldest.key)
    total -= oldest.bytes
    count -= 1
  }
  // A single photograph larger than the whole budget fits nowhere: the caller
  // has to know that rather than watch the store drop everything and then fail.
  return { drop, fits: incoming <= caps.bytes }
}

/* -------------------------------------------------------------------------- */
/* the bytes                                                                   */
/* -------------------------------------------------------------------------- */

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    // The whole of it, `typeof` included: reading the property itself throws
    // where IndexedDB is refused (private mode on some WebKit builds), and a
    // rejected promise out of here would surface as an unhandled rejection in
    // the middle of a boot. Nothing about storing a photograph is worth that.
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(DB, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      // A refused or blocked database is a session that does not persist. There
      // is nothing to tell the user: the app works, it just forgets.
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

let db: Promise<IDBDatabase | null> | null = null

function database(): Promise<IDBDatabase | null> {
  if (!db) db = open()
  return db
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('indexeddb refused'))
  })
}

type Entry = { key: string; name: string; file: File }

/** What the record's key holds, as a `File` again — the name and the type the
 *  browser had, so the restored photograph goes through `decodePhoto` exactly as
 *  the original did, EXIF included. */
async function readEntry(key: string): Promise<File | null> {
  const d = await database()
  if (!d) return null
  try {
    const row = (await ask(d.transaction(STORE, 'readonly').objectStore(STORE).get(key))) as
      | Entry
      | undefined
    return row?.file ?? null
  } catch {
    return null
  }
}

async function writeEntry(entry: Entry): Promise<boolean> {
  const d = await database()
  if (!d) return false
  try {
    await ask(d.transaction(STORE, 'readwrite').objectStore(STORE).put(entry))
    return true
  } catch {
    return false
  }
}

async function dropEntry(key: string): Promise<void> {
  const d = await database()
  if (!d) return
  try {
    await ask(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(key))
  } catch {
    // A delete that cannot be written leaves bytes nothing can reach: they are
    // unreferenced by the record, and the next `makeRoom` will not see them
    // because it works from the record. The browser reclaims them when it
    // reclaims the origin; there is nothing here to retry.
  }
}

/**
 * Stores one photograph's original bytes, evicting whatever `makeRoom` says has
 * to go, and reports both the entry and the keys it cleared.
 *
 * `held` is the record's `photos`, which is one entry per photograph in the
 * list — so the caller can line the dropped keys back up with the photographs
 * they belong to by index. Entries with no key are photographs nothing has
 * stored and are not counted against the caps.
 *
 * The bytes come from the blob URL the decode is holding, which is the file the
 * user picked, byte for byte — a re-encode would be smaller and would silently
 * cost the export its resolution. A refusal (no IndexedDB, no room even after
 * the eviction, a fetch that fails) answers `entry: null`, and the photograph
 * stays in the list without coming back after a refresh.
 */
export async function putBytes(
  photo: Photo,
  held: StoredPhoto[],
): Promise<{ entry: StoredPhoto | null; dropped: string[] }> {
  let blob: Blob
  try {
    blob = await (await fetch(photo.el.src)).blob()
  } catch {
    return { entry: null, dropped: [] }
  }

  const { drop, fits } = makeRoom(
    held.filter((h) => h.key !== ''),
    blob.size,
  )
  if (!fits) return { entry: null, dropped: [] }

  // Evict first, then write: a store at its limit has no room for the photograph
  // that would push it over, and the failure would be the write's rather than
  // the policy's.
  for (const key of drop) await dropEntry(key)

  const entry: StoredPhoto = { key: nextKey(), name: photo.name, bytes: blob.size }
  const file = new File([blob], photo.name, { type: blob.type || 'image/jpeg' })
  if (!(await writeEntry({ key: entry.key, name: entry.name, file }))) {
    return { entry: null, dropped: drop }
  }
  stored.set(photo, entry)
  return { entry, dropped: drop }
}

export async function dropBytes(key: string): Promise<void> {
  await dropEntry(key)
}

/**
 * The photographs the record lists, decoded and ready to draw.
 *
 * Entry by entry and failure by failure: a key with no bytes behind it, a blob
 * the browser can no longer decode, a `File` that turns out not to be an image —
 * each drops that photograph and leaves the rest. The camera plate comes back
 * with its EXIF because the bytes that were stored are the original file, and
 * `decodePhoto` reads them the way it read them the first time.
 *
 * `at` is the record index each photograph came from, which is what the caller
 * needs to put the wall back where it was: a photograph that did not survive
 * takes its index with it, and the index of the photograph that *was* on the
 * wall is the record's `active`.
 */
export async function restorePhotos(
  entries: StoredPhoto[],
): Promise<{ photos: Photo[]; at: number[] }> {
  const photos: Photo[] = []
  const at: number[] = []
  for (const [i, entry] of entries.entries()) {
    if (entry.key === '') continue
    const file = await readEntry(entry.key)
    if (!file) continue
    try {
      const photo = await decodePhoto(file, readExif)
      stored.set(photo, entry)
      photos.push(photo)
      at.push(i)
    } catch {
      // A photograph that will not decode is a photograph that does not come
      // back; the rest of the list is unaffected, and its bytes are now
      // unreachable — dropping the entry is what clears them.
      await dropEntry(entry.key)
    }
  }
  return { photos, at }
}

/**
 * Where the wall goes when the list comes back: the record's `active` index,
 * mapped through the photographs that survived.
 *
 * The active photograph itself if it is there; otherwise the nearest surviving
 * one before it — the list shifted up by exactly the photographs that did not
 * come back, and the one that was on the wall is the one the user expects to
 * see. A list where nothing survived has no answer beyond its first row.
 */
export function restoredActive(at: number[], want: number): number {
  let best = 0
  for (let i = 0; i < at.length; i++) {
    if (at[i]! <= want) best = i
  }
  return best
}

/** Forgets a photograph's key, for a caller whose bytes have just been evicted.
 *  What is left in the record for it is an empty key, which is the record's way
 *  of saying "this one does not come back". */
export function forgetKey(photo: Photo): void {
  stored.delete(photo)
}
