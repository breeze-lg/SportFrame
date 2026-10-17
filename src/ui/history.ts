import type { Template, TextSlotId } from '../core/types'

/**
 * 撤销 / 重做 — the history behind the two arrows at the top of the screen.
 *
 * A step is a whole *draft*: the mount and the words, which are the two things
 * the panels edit and the two things a user can lose by mistyping. Snapshots
 * rather than diffs, because a draft is a few hundred bytes of plain data — it
 * is the same object the session record is written from — and a diff format
 * would be a second description of the app's state to keep in step with the
 * first.
 *
 * What is deliberately *not* here: the photograph list. Removing a photograph
 * drops its bytes, and a history that offered to bring one back would be
 * promising something the store no longer has. So undo covers the poster — the
 * mount, its numbers, the words — and the list is the user's own to manage.
 */

export type Draft = { template: Template | null; text: Partial<Record<TextSlotId, string>> }

export type History = {
  /** States to go back to, oldest first. The top is where 撤销 lands. */
  past: Draft[]
  /** States 重做 can return to, oldest first. Cleared by any new edit. */
  future: Draft[]
  /** What the last step was about, and when — see `remember`. */
  key: string
  at: number
}

/**
 * How long a burst lasts. Typing a word is eighteen keystrokes and one edit,
 * and a history that needed eighteen presses of 撤销 to leave a word is a
 * history nobody uses. Slider drags are the same story with a pointer: a drag
 * emits a value per frame.
 */
export const COALESCE_MS = 700

/** How far back a session can go. Past this the oldest step is dropped: a
 *  bounded stack of small objects, and 50 is far more than anyone presses. */
export const HISTORY_CAP = 50

export function newHistory(): History {
  return { past: [], future: [], key: '', at: 0 }
}

/**
 * Records the state a change is about to replace — so the caller snapshots
 * *before* it mutates, and 撤销 is what puts that snapshot back.
 *
 * `key` names the thing being edited (`text:title`, `frame:scale`, `pick`) and
 * `now` is a timestamp: an edit to the *same* key inside `COALESCE_MS` of the
 * last one does not push, because the snapshot already on top of `past` is
 * still the state before the burst began. A different key always pushes.
 */
export function remember(h: History, key: string, draft: Draft, now: number): History {
  if (h.key === key && now - h.at < COALESCE_MS) return { ...h, at: now }
  const past = [...h.past, draft]
  if (past.length > HISTORY_CAP) past.shift()
  // A new edit is a new branch: whatever was ahead of us is unreachable now.
  return { past, future: [], key, at: now }
}

export function canUndo(h: History): boolean {
  return h.past.length > 0
}

export function canRedo(h: History): boolean {
  return h.future.length > 0
}

/**
 * Steps back one, handing the caller the draft to restore and the history to
 * keep. `current` is where the app is now, which becomes the state 重做
 * returns to — the caller has to pass it because this module does not hold the
 * live state, and reaching for it would make the stack the second place the
 * app's state lives.
 *
 * `key` is cleared rather than carried: the next edit starts a new step even if
 * it is the same field, because otherwise a keystroke right after an 撤销 would
 * coalesce into the burst that was just undone and undo itself again.
 */
export function undo(h: History, current: Draft): { history: History; draft: Draft } | null {
  const draft = h.past[h.past.length - 1]
  if (!draft) return null
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, current], key: '', at: 0 },
    draft,
  }
}

export function redo(h: History, current: Draft): { history: History; draft: Draft } | null {
  const draft = h.future[h.future.length - 1]
  if (!draft) return null
  return {
    history: { past: [...h.past, current], future: h.future.slice(0, -1), key: '', at: 0 },
    draft,
  }
}
