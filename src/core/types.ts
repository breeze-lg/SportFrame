export type Size = { W: number; H: number }
export type Rect = { x: number; y: number; w: number; h: number }

export type Ratio = '4:5' | '1:1' | '3:2' | '16:9' | '9:16' | 'orig'

export type Background = {
  mode: 'blur' | 'solid' | 'none'
  zoom?: number
  blur?: number
  darken?: number
  color?: string
}

export type Frame = {
  scale: number
  radius: number
  mat: number
  matBottom: number
  shadow: number
}

export type TextAnchor = 'top' | 'bottom' | 'center' | 'mat'
export type TextSlotId = 'title' | 'sub' | 'sign'

export type TextSlot = {
  id: TextSlotId
  size: number
  weight: number
  color: string
  stroke?: boolean
}

export type TextConfig = { slots: TextSlot[]; anchor: TextAnchor }

export type PlateField = 'camera' | 'focal' | 'aperture' | 'shutter' | 'iso' | 'date'

export type Plate = {
  enabled: boolean
  fields: PlateField[]
  color: string
  align: 'center' | 'left'
}

export type Layout =
  | { kind: 'single' }
  | { kind: 'split'; gap: number; direction: 'row' | 'column' }
  | { kind: 'grid'; cols: number; rows: number; gap: number }

export type Template = {
  id: string
  name: string
  premium?: boolean
  layout: Layout
  canvas: { ratio: Ratio }
  background: Background
  frame: Frame
  text?: TextConfig
  plate?: Plate
}

export type Exif = {
  camera?: string
  focal?: string
  aperture?: string
  shutter?: string
  iso?: string
  date?: string
}

export type Photo = {
  el: HTMLImageElement
  /** Optional downscale used for on-screen rendering only. Spec §9: photos
   *  over 12 MP preview from ~4 MP. Export always uses `el`. */
  preview?: HTMLImageElement
  width: number
  height: number
  name: string
  exif: Exif | null
}

export type RenderInput = {
  ctx: CanvasRenderingContext2D
  size: Size
  k: number
  template: Template
  photos: Photo[]
  text: Partial<Record<TextSlotId, string>>
  exif: Exif | null
}
