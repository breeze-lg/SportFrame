import type { Exif, Photo, Size, Template } from '../core/types'

export type AppState = {
  photo: Photo | null
  exif: Exif | null
  template: Template | null
  text: Record<string, string>
  size: Size
  longEdge: number
}

export function createState(initial: Partial<AppState> = {}): AppState {
  return {
    photo: null,
    exif: null,
    template: null,
    text: {},
    size: { W: 1080, H: 1350 },
    longEdge: 1440,
    ...initial,
  }
}
