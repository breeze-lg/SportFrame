import './styles/tokens.css'
import './styles/app.css'
import { initTheme } from './ui/theme'
import { drawMat } from './core/mat'

initTheme()

const root = document.getElementById('app')
if (root) root.textContent = 'ready'

// Dev affordance — see spec §8. Enabled only with ?dev=1.
let probeCanvas = document.createElement('canvas')

if (new URLSearchParams(location.search).has('dev')) {
  const api = {
    canvas: probeCanvas,
    size(): { W: number; H: number } {
      return { W: probeCanvas.width, H: probeCanvas.height }
    },
    setSize(W: number, H: number): void {
      probeCanvas.width = W
      probeCanvas.height = H
    },
    ctx(): CanvasRenderingContext2D {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return c
    },
    sample(x: number, y: number, w: number, h: number): number[] {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return Array.from(c.getImageData(x, y, w, h).data)
    },
    pixel(x: number, y: number): [number, number, number, number] {
      const d = this.sample(x, y, 1, 1)
      // getImageData always yields 4 channels, so the reads are non-null.
      return [d[0]!, d[1]!, d[2]!, d[3]!]
    },
  }
  ;(window as unknown as { __frameCore: unknown }).__frameCore = { drawMat }
  ;(window as unknown as { __frame: typeof api }).__frame = api
}
