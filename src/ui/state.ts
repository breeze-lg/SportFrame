import type { Photo, Size, Template, TextSlotId } from '../core/types'

export type AppState = {
  /** Every photograph loaded this session, in the order they arrived. This list
   *  is the left column; the wall shows one of them. */
  photos: Photo[]
  /** Which of `photos` the wall is showing. An index rather than a reference,
   *  because the list is what gets appended to and deleted from — a held
   *  reference would have to be re-found after every mutation, and would be
   *  wrong for exactly as long as that took. Read it through `activePhoto` in
   *  `src/ui/photos.ts`, which is where the list's own rules live. */
  active: number
  template: Template | null
  /** What the user has typed, by slot. The app owns these, not the template:
   *  switching mount keeps the words and lets the new typography set them.
   *  Keyed by `TextSlotId` so a mistyped slot name is a compile error rather
   *  than a value `render` silently never reads. */
  text: Partial<Record<TextSlotId, string>>
  size: Size
  longEdge: number
}

export function createState(initial: Partial<AppState> = {}): AppState {
  return {
    photos: [],
    active: 0,
    template: null,
    text: {},
    // The placeholder before the first `draw()`, and it has to agree with
    // `longEdge`: 1440 on the long edge of the boot template's 4:5 canvas is
    // `resolveSize('4:5', 1440)`, the size `draw` assigns on the first frame.
    // 1080×1350 was the same ratio at a long edge nothing in the app uses, so a
    // reader had two numbers for one canvas and only one of them was real.
    size: { W: 1152, H: 1440 },
    longEdge: 1440,
    ...initial,
  }
}
