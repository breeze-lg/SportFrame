import './styles/tokens.css'
import './styles/app.css'
import { initTheme } from './ui/theme'
import { drawMat } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { render } from './core/render'
import { showCeremony } from './ui/export'

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
  ;(window as unknown as { __frameCore: unknown }).__frameCore = {
    drawMat,
    drawBackground,
    drawText,
    measureToFit,
    frameFont,
    render,
  }
  ;(window as unknown as { __frame: typeof api }).__frame = api
}

// Interim dev handle for Task 9 only — the export ceremony's pixel test runs
// before the shell exists, so it cannot wait for Task 12's consolidated block.
// Task 12 folds this into that block.
if (new URLSearchParams(location.search).has('dev')) {
  ;(window as unknown as Record<string, unknown>).__frameCeremony = { showCeremony }
}
