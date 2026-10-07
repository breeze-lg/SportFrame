import type { Exif } from './types'

/**
 * A stub, and deliberately so. The real reader — the JPEG APP1 walk that pulls
 * camera, focal length, aperture, shutter and ISO out of the bytes `decodePhoto`
 * already has in hand — lands in Task 15, together with the plate that displays
 * it. Until then the app must still compile and run with "no metadata", which is
 * a state the product has to handle anyway (spec §9: a photo with no EXIF hides
 * the plate and never errors), so `null` is the honest answer rather than a
 * placeholder coincidence.
 *
 * Task 15 replaces this file wholesale; nothing else changes.
 */
export function readExif(_buf: ArrayBuffer): Exif | null {
  return null
}
