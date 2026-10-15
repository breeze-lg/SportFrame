import type { Frame, Ratio, Rect, Size } from './types'

const RATIOS: Record<Exclude<Ratio, 'orig'>, number> = {
  '4:5': 4 / 5,
  '1:1': 1,
  '3:2': 3 / 2,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
}

export function aspectOf(ratio: Ratio, photo?: { width: number; height: number }): number {
  if (ratio === 'orig') {
    if (photo && photo.height > 0) return photo.width / photo.height
    return RATIOS['4:5']
  }
  return RATIOS[ratio]
}

export function resolveSize(
  ratio: Ratio,
  longEdge: number,
  photo?: { width: number; height: number },
): Size {
  const r = aspectOf(ratio, photo)
  if (r >= 1) return { W: Math.round(longEdge), H: Math.round(longEdge / r) }
  return { W: Math.round(longEdge * r), H: Math.round(longEdge) }
}

export function cover(
  iw: number,
  ih: number,
  boxW: number,
  boxH: number,
  zoom = 1,
): { s: number; w: number; h: number } {
  const s = Math.max(boxW / iw, boxH / ih) * zoom
  return { s, w: iw * s, h: ih * s }
}

/**
 * The mount's own rectangle inside a `size` canvas: the frame grown by its mat,
 * at the offsets the record carries.
 *
 * This is what a 无照片 poster *is* — the photograph and its border, with no paper
 * around them — and it is measured with the same two functions `render` lays the
 * mount out with, so a crop can never disagree with what was drawn. The offsets
 * are included even though the mode ignores them: a record that carries `ox` is a
 * record made in another mode, and a crop that assumed centred would cut the
 * photograph in half.
 */
export function mountRect(size: Size, aspect: number, frame: Frame): Rect {
  const f = fitRect(size, aspect, frame.scale, frame.ox ?? 0, frame.oy ?? 0)
  return matRect(f, frame.mat, frame.matBottom, 1)
}

export function fitRect(
  box: Size,
  aspect: number,
  scalePct: number,
  ox: number,
  oy: number,
): Rect {
  const bw = box.W * (scalePct / 100)
  const bh = box.H * (scalePct / 100)
  let w = bw
  let h = w / aspect
  if (h > bh) {
    h = bh
    w = h * aspect
  }
  const cx = box.W / 2 + (ox / 100) * box.W * 0.35
  const cy = box.H / 2 + (oy / 100) * box.H * 0.35
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export function matRect(fr: Rect, mat: number, matBottom: number, k: number): Rect {
  const m = mat * k
  const mb = matBottom * k
  return {
    x: fr.x - m,
    y: fr.y - m,
    w: fr.w + m * 2,
    h: fr.h + m * 2 + mb,
  }
}
