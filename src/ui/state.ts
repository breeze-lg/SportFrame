import type { Exif, Photo, Size, Template, TextSlotId } from '../core/types'

export type AppState = {
  photo: Photo | null
  exif: Exif | null
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
    photo: null,
    exif: null,
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
