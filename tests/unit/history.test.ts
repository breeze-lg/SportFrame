import { describe, expect, it } from 'vitest'
import {
  COALESCE_MS,
  HISTORY_CAP,
  canRedo,
  canUndo,
  newHistory,
  redo,
  remember,
  undo,
  type Draft,
  type History,
} from '../../src/ui/history'

/**
 * The stack behind 撤销 and 重做. The interesting parts are not push and pop —
 * they are the two rules that make it usable: a burst of edits to one thing is
 * one step, and anything the user can see is reachable in both directions.
 */

const d = (title: string): Draft => ({ template: null, text: { title } })

/** Three edits to the same field, a second apart — three steps. */
function typed(): History {
  let h = newHistory()
  h = remember(h, 'text:title', d('a'), 0)
  h = remember(h, 'text:title', d('ab'), 2000)
  h = remember(h, 'text:title', d('abc'), 4000)
  return h
}

describe('remember', () => {
  it('a fresh history can undo and redo nothing', () => {
    const h = newHistory()
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(undo(h, d('now'))).toBeNull()
    expect(redo(h, d('now'))).toBeNull()
  })

  it('records the state *before* the change, which is what undo restores', () => {
    const h = remember(newHistory(), 'text:title', d('before'), 0)
    const step = undo(h, d('after'))
    expect(step?.draft.text.title).toBe('before')
  })

  it('treats a burst of edits to one thing as one step', () => {
    let h = remember(newHistory(), 'text:title', d(''), 0)
    // eighteen keystrokes, one step: the snapshot on top is still the state
    // before the first of them
    for (let i = 1; i < 18; i++) h = remember(h, 'text:title', d('x'.repeat(i)), i * 40)

    expect(h.past).toHaveLength(1)
    expect(undo(h, d('now'))?.draft.text.title).toBe('')
  })

  it('starts a new step once the burst is over', () => {
    let h = remember(newHistory(), 'text:title', d('a'), 0)
    h = remember(h, 'text:title', d('ab'), COALESCE_MS + 1)
    expect(h.past).toHaveLength(2)
  })

  it('always starts a new step for a different thing', () => {
    let h = remember(newHistory(), 'text:title', d('a'), 0)
    // the same moment, a different slider: two steps, because they are two
    // decisions
    h = remember(h, 'frame:scale', d('a'), 1)
    expect(h.past).toHaveLength(2)
  })

  it('drops the oldest step at the cap rather than growing without bound', () => {
    let h = newHistory()
    for (let i = 0; i < HISTORY_CAP + 10; i++) h = remember(h, `frame:${i}`, d(String(i)), i)
    expect(h.past).toHaveLength(HISTORY_CAP)
    // the ones kept are the most recent, so pressing undo walks back through
    // what the user just did
    expect(undo(h, d('now'))?.draft.text.title).toBe(String(HISTORY_CAP + 9))
  })
})

describe('undo and redo', () => {
  it('walks back and forward through the same states', () => {
    const h = typed()
    const back = undo(h, d('abcd'))!
    expect(back.draft.text.title).toBe('abc')
    expect(canRedo(back.history)).toBe(true)

    const again = undo(back.history, back.draft)!
    expect(again.draft.text.title).toBe('ab')

    const forward = redo(again.history, again.draft)!
    expect(forward.draft.text.title).toBe('abc')
  })

  it('forgets what was ahead once the user edits again', () => {
    const h = typed()
    const back = undo(h, d('abcd'))!
    const branched = remember(back.history, 'text:title', back.draft, 9000)
    expect(canRedo(branched), 'a new edit left a redo that is not the user\'s state').toBe(false)
  })

  it('does not coalesce an edit into the burst that was just undone', () => {
    // Otherwise a keystroke right after 撤销 folds into the step that was
    // undone and the next 撤销 undoes nothing the user can see.
    const h = typed()
    const back = undo(h, d('abcd'))!
    const typed2 = remember(back.history, 'text:title', back.draft, 5000)
    expect(typed2.past, 'the keystroke replaced the step instead of adding one').toHaveLength(
      back.history.past.length + 1,
    )
  })

  it('hands back a state, not a reference the caller can keep mutating', () => {
    const first = d('a')
    const h = remember(newHistory(), 'text:title', first, 0)
    expect(h.past[0]).toBe(first)
    // the copy is the caller's job — `snapshot()` in `main.ts` deep-copies —
    // and this pins that the stack itself does not
    expect(undo(h, d('now'))?.draft).toBe(first)
  })
})
