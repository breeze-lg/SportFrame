export type Size = { W: number; H: number }
export type Rect = { x: number; y: number; w: number; h: number }

export type Ratio = '4:5' | '1:1' | '3:2' | '16:9' | '9:16' | 'orig'

export type Background = {
  /** What the poster *is*, which is one of two things:
   *
   *  `blur`  the photograph again, cover-cropped and out of focus, filling a
   *          canvas of the template's own shape — what eight of the nine
   *          templates ship with.
   *  `mount` no canvas to speak of: the delivery is the mount's own box. A 1000×1000
   *          poster whose photograph and border measure 800×800 is exported at
   *          800×800 — the paper around the mount is not part of the poster, so it
   *          is not part of the file.
   */
  mode: 'blur' | 'mount'
  zoom?: number
  blur?: number
  darken?: number
  /** The sheet a `mount` poster is printed on, if the template has one. Authored,
   *  never a control: 样张 ships `#FFFFFF` and is the one template that has a sheet
   *  at all, because its plate is printed on it — a camera plate over nothing is a
   *  caption floating in the void. Fills the canvas, so it shows only where the
   *  mount does not reach it: the corners of a rounded card. */
  color?: string
}

export type Frame = {
  scale: number
  radius: number
  mat: number
  matBottom: number
  shadow: number
  /** 白边, not in white: the mat is filled with the photograph itself, blurred, so
   *  the picture bleeds off its own edge instead of sitting on paper. Off by default
   *  — a mat is white unless the record says so — and offered by the 画面 panel only
   *  in the modes where the border *is* the poster's background (透明 and 无背景):
   *  on 带背景's blurred backdrop the same blur is a border nobody can see. Missing
   *  means white, like every other optional field here. */
  matBlur?: boolean
  /** How far off the canvas centre the mount sits, in `fitRect`'s own offset
   *  units: 100 is a shift of 35% of the box. Optional because every record
   *  written before the 画面 controls existed has no such field, and a missing
   *  offset is a centred mount — which is what those records mean. */
  ox?: number
  oy?: number
}

export type TextAnchor = 'top' | 'bottom' | 'center' | 'mat'
export type TextSlotId = 'title' | 'sub' | 'sign'

export type TextSlot = {
  id: TextSlotId
  size: number
  weight: number
  color: string
  stroke?: boolean
  /** Which typeface this line prints in, as an id from `src/core/fonts.ts` —
   *  `'kaiti'`, `'xingkai'`, or `user:<name>` for a file the user loaded.
   *  Optional because every record written before the picker existed has none,
   *  and absent means the app's own stack, which is what those records drew. */
  family?: string
}

export type TextConfig = {
  slots: TextSlot[]
  anchor: TextAnchor
  /** Where the block sits, as a percentage of the canvas away from where its
   *  anchor put it: `0` is the anchor's own position, `+dy` is further down.
   *  A percentage rather than pixels so the same record means the same thing at
   *  1× and at 2×, and optional because every record written before the 文字
   *  panel could move a block has none — absent means centred on its anchor,
   *  which is what those records drew. */
  dx?: number
  dy?: number
}

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
  /** One line saying what this mount does to a photograph, in the app's own
   *  words — the line under the poster. It is copy, not configuration: nothing
   *  renders from it, and it is what turns a rack of nine pictures into nine
   *  choices a first-time visitor can read. Optional because a record written
   *  before it existed, and every copy 存为模板 makes of one, has no such field
   *  and must keep validating. See `src/ui/rail.ts` for where it is shown. */
  tagline?: string
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
