# Frame App — Core (Stages 1–4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `index.html` prototype as a static-first Vite + TypeScript app whose templates are data, whose renderer is pure and pixel-tested, and which ships a camera-spec plate read from the photo's own EXIF.

**Architecture:** One pure function is the spine — `render(input)` draws a template + photos + text into a canvas context. `src/core/` is framework-free and never imports from `src/ui/`; it holds all geometry, drawing, and EXIF parsing. `src/ui/` owns the DOM, the single state object, and the theme. No backend, no runtime dependencies.

**Tech Stack:** Vite 6, TypeScript 5, Vitest 3 (unit), Playwright (browser + pixel tests). Node 24 is installed; no other runtime is required.

**Spec:** `docs/superpowers/specs/2026-10-07-photo-frame-app-design.md`

## Scope of this plan

This plan implements **stages 1–4** of the spec's build sequence: scaffold and themes, the single-photo renderer, the template data model, and the EXIF plate. Per the spec, stages 1–4 constitute a complete, shippable product.

**Stages 5–6 (adjustments, collage) are deliberately excluded** and get their own plan. The spec marks them as metric-contingent (§12): if the adjust-panel open rate turns out near zero, they were scope that should not have been taken. Planning them in detail before that signal exists would be planning work the spec itself says may not be worth doing.

## Refinements to the spec's file list

The spec's module sketch (§5) named `ui/app.ts` and `ui/controls.ts`. In stages 1–4 there is nothing for a controls module to control — the only controls are the template rail and a save button — so the UI splits along the seams the work actually has: `ui/rail.ts`, `ui/input.ts`, `ui/export.ts`, `ui/toast.ts`, `ui/custom.ts`, `ui/theme.ts`, `ui/state.ts`, with wiring in `main.ts`. `src/core/background.ts` is likewise split out of `render.ts` so the spine stays an orchestrator rather than also owning blur maths.

Nothing about the architectural boundary changes: **`src/core/` still never imports from `src/ui/`**, and that is the only rule that was load-bearing in the spec.

## Two refinements to the spec's testing section

The spec (§11) commits to pixel snapshots diffed against committed PNGs, and flags the staleness cost honestly. This plan does that, but makes **invariant assertions the primary pixel tests** and golden snapshots secondary:

- **Invariant assertions** sample specific pixels and assert a property — no seam at the mat edge, no text outside the band, the bevel present at inset 5px. These test the bug classes the spec names, and they never go stale.
- **Golden snapshots** catch unintended change, at the cost of re-baselining when a template is intentionally edited.

Both run in the same Playwright suite. Where the two disagree, the invariant is authoritative.

## Global Constraints

- **No runtime dependencies.** `dependencies` stays empty; everything is a `devDependency`. The EXIF parser is hand-written.
- **`src/core/` must never import from `src/ui/`.** This is the spec's one enforceable boundary.
- **The mat is `#FFFFFF` in both themes.** `--mat` is the exported artifact and does not follow the theme; `--surface` is chrome and does. (Spec §6)
- **The UI is achromatic.** No accent colour. `--brass` is reserved exclusively for premium markers.
- **Fonts are self-hosted.** Newsreader and IBM Plex Mono/Sans must be served from the app's own origin, never Google Fonts. Font files are added in Task 2.
- **CJK never gets a webfont.** Chinese text renders from the system stack: `-apple-system, "PingFang SC", "Helvetica Neue", sans-serif`.
- **Supported browsers:** iOS Safari, 微信内置浏览器 (X5/Blink), Android Chrome, desktop Chrome/Safari. No IE, no legacy Edge.
- **`ratio: 'orig'`** means the canvas takes the first photo's aspect ratio.

## Review Focus

Five input classes the spec implies but whose behaviour no single task's happy-path test covers. Each is pinned by a test in the task that owns the code, marked **[RF-n]**.

1. **Extreme aspect ratios.** A 3:1 panorama dropped into a 4:5 template must fill the frame by cropping the overflow — never letterbox, never distort. *(Task 3)*
2. **Absent or partial EXIF.** A photo with no EXIF at all, and a photo with EXIF present but individual tags missing, must both render successfully; the plate hides or omits just the missing fields. *(Tasks 15, 16)*
3. **Overlong text.** A title wider than the frame must shrink to fit the mat and must never cross the mat edge. *(Task 6)*
4. **Undecodable input.** A 0-byte file, a PDF renamed `.jpg`, and a corrupt byte stream must each produce a legible message with the canvas left unchanged — never a blank canvas. *(Task 8)*
5. **Export beyond canvas limits.** A 2× export whose dimensions exceed the browser's maximum canvas size must be caught, retried at 1×, and reported to the user. *(Task 9)*

---

## File Structure

```
package.json
tsconfig.json
vite.config.ts
playwright.config.ts
index.html                      Vite entry; the app shell markup
src/
  main.ts                       boot; wires ui to core; dev API behind ?dev=1
  core/
    types.ts                    Template, Photo, Exif, RenderInput, Rect, Size
    geometry.ts                 pure math: canvas sizing, cover-crop, frame + mat rects
    mat.ts                      rounded rect, mat + bevel + shadow
    background.ts               blur / solid / none
    text.ts                     text slots and auto-fit
    plate.ts                    EXIF spec-bar layout
    exif.ts                     hand-written EXIF reader
    render.ts                   the spine
    templates.ts                Template records + validateTemplate
  ui/
    state.ts                    the single app state object
    theme.ts                    light/dark resolution, application, persistence
    input.ts                    file / paste / drag, decode, validation, downscale
    export.ts                   PNG encoding, download, and the export ceremony
    rail.ts                     template rail
    custom.ts                   user-saved templates in localStorage
    toast.ts                    transient messages
  styles/
    tokens.css                  the design tokens, both themes
    app.css                     component styles
  entitlements.ts               isUnlocked / canExport — always true in v1
tests/
  unit/*.test.ts                vitest, pure functions only
  pixel/*.spec.ts               playwright, canvas + pixel invariants
  fixtures/                     photos with and without EXIF
```

---

### Task 1: Scaffold and toolchain

Establishes Vite + TypeScript + Vitest + Playwright and proves all four work end to end. No product code yet.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`
- Create: `index.html`, `src/main.ts`
- Create: `tests/unit/smoke.test.ts`, `tests/pixel/smoke.spec.ts`
- Modify: `.gitignore` (already covers `node_modules/`, `dist/`)

**Interfaces:**
- Consumes: nothing
- Produces: `npm run dev`, `npm run build`, `npm run test`, `npm run test:pixel`; the `index.html` shell that every later task renders into

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "frame-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4173",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:pixel": "playwright test"
  },
  "dependencies": {},
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm install
npx playwright install chromium
```

Expected: installs cleanly. `npx playwright --version` prints a version.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'es2022' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/pixel',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

`deviceScaleFactor: 1` is required — a DPR other than 1 would silently rescale every pixel assertion.

- [ ] **Step 6: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#E9E8E3">
<title>模糊画框</title>
</head>
<body>
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 7: Create `src/main.ts`**

```ts
const root = document.getElementById('app')
if (root) root.textContent = 'ready'
```

- [ ] **Step 8: Create the smoke tests**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs unit tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

`tests/pixel/smoke.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('the app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#app')).toHaveText('ready')
})
```

- [ ] **Step 9: Verify all four commands**

```bash
npm run test        # 1 passed
npm run build       # tsc clean, vite emits dist/
npm run test:pixel  # 1 passed
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + typescript + vitest + playwright"
```

---

### Task 2: Design tokens and theme

Implements the spec's palette for both themes, the system-preference resolution, and the persistence rule. Fonts are self-hosted here.

**Files:**
- Create: `src/styles/tokens.css`, `src/ui/theme.ts`
- Create: `tests/unit/theme.test.ts`, `tests/pixel/theme.spec.ts`
- Create: `public/fonts/` (self-hosted Newsreader + IBM Plex woff2)
- Modify: `index.html` (link the stylesheet and font-face declarations), `src/main.ts`

**Interfaces:**
- Consumes: Task 1's scaffold
- Produces: `resolveTheme(stored: string | null, systemDark: boolean): Theme`, `applyTheme(t: Theme): void`, `initTheme(): Theme`; the CSS custom properties every later task styles against

- [ ] **Step 1: Write the failing test for theme resolution**

`tests/unit/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveTheme } from '../../src/ui/theme'

describe('resolveTheme', () => {
  it('honours a stored preference over the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('ignores a stored value that is not a known theme', () => {
    expect(resolveTheme('sepia', true)).toBe('dark')
    expect(resolveTheme('', false)).toBe('light')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/theme.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/theme`.

- [ ] **Step 3: Implement `src/ui/theme.ts`**

```ts
export type Theme = 'light' | 'dark'

const KEY = 'frame-app-theme'

export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return systemDark ? 'dark' : 'light'
}

export function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.style.colorScheme = t
}

export function setTheme(t: Theme): void {
  applyTheme(t)
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function initTheme(): Theme {
  const t = resolveTheme(readStoredTheme(), systemPrefersDark())
  applyTheme(t)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (readStoredTheme() === null) applyTheme(e.matches ? 'dark' : 'light')
  })
  return t
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/theme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add self-hosted fonts**

Download Newsreader (400, 400 italic), IBM Plex Mono (400, 500), and IBM Plex Sans (400, 500, 600) as `.woff2` into `public/fonts/`. Do **not** link Google Fonts — it is unreliable from mainland China and a blocked stylesheet would drop the whole interface into fallback.

Declare them at the top of `src/styles/tokens.css`:

```css
@font-face {
  font-family: 'Newsreader';
  src: url('/fonts/newsreader-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'Newsreader';
  src: url('/fonts/newsreader-400-italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/plex-mono-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Mono';
  src: url('/fonts/plex-mono-500.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/plex-sans-600.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
```

- [ ] **Step 6: Write the tokens**

Append to `src/styles/tokens.css`. These values are copied verbatim from spec §6.

```css
:root {
  color-scheme: light;

  /* theme-agnostic — the artifact */
  --mat: #FFFFFF;
  --bevel-mat: rgba(28, 27, 24, .09);

  --serif: 'Newsreader', Georgia, 'Songti SC', serif;
  --sans: 'IBM Plex Sans', -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;

  /* light */
  --wall: #E9E8E3;
  --wall-hi: #F1F0EC;
  --wall-lo: #E2E1DB;
  --surface: #FFFFFF;
  --bevel: #D6D4CD;
  --rule: #EFEEE9;
  --ink: #1C1B18;
  --action-bg: #1C1B18;
  --action-fg: #E9E8E3;
  --body: #33312C;
  --label: #3A3833;
  --quiet: #7A776E;
  --faint: #A9A69C;
  --brass: #8A6A2F;
  --brass-line: rgba(138, 106, 47, .34);
  --brass-wash: rgba(138, 106, 47, .05);
  --device: #EDECE7;
  --device-line: #C9C7BE;
  --lift: 0 1px 2px rgba(28, 27, 24, .05), 0 12px 28px -10px rgba(28, 27, 24, .20);
  --deep: 0 2px 4px rgba(28, 27, 24, .06), 0 34px 64px -22px rgba(28, 27, 24, .34);
}

:root[data-theme='dark'] {
  color-scheme: dark;

  --wall: #191815;
  --wall-hi: #232019;
  --wall-lo: #121110;
  --surface: #211F1C;
  --bevel: #3A3833;
  --rule: #2C2A26;
  --ink: #EDEBE5;
  --action-bg: #C9C5BB;
  --action-fg: #191815;
  --body: #C9C5BB;
  --label: #B8B3A8;
  --quiet: #8B877C;
  --faint: #5E5A52;
  --brass: #BE9A4A;
  --brass-line: rgba(190, 154, 74, .36);
  --brass-wash: rgba(190, 154, 74, .07);
  --device: #26241F;
  --device-line: #403D37;
  --lift: 0 1px 2px rgba(0, 0, 0, .5), 0 12px 28px -10px rgba(0, 0, 0, .7);
  --deep: 0 2px 4px rgba(0, 0, 0, .6), 0 34px 64px -22px rgba(0, 0, 0, .85);
}
```

**`--mat` appears only in `:root` and repeats in neither theme block.** If it ever appears in the dark block, the artifact has started lying about the export.

- [ ] **Step 7: Write the pixel test for both themes**

`tests/pixel/theme.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const RGB = (r: number, g: number, b: number) => `rgb(${r}, ${g}, ${b})`

test.describe('themes', () => {
  test('light theme paints the wall colour', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(233, 232, 227))
  })

  test('dark theme paints the wall colour', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('body')).toHaveCSS('background-color', RGB(25, 24, 21))
  })

  test('--mat is identical in both themes', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/')
      const mat = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--mat').trim().toUpperCase()
      )
      expect(mat, `--mat in ${scheme}`).toBe('#FFFFFF')
    }
  })
})
```

The third test is the one that matters — it is the executable form of the spec's first dark-mode rule.

- [ ] **Step 8: Wire the stylesheet and theme init**

In `index.html`, inside `<head>`:

```html
<link rel="stylesheet" href="/src/styles/tokens.css">
<link rel="stylesheet" href="/src/styles/app.css">
```

In `src/main.ts`:

```ts
import './styles/tokens.css'
import './styles/app.css'
import { initTheme } from './ui/theme'

initTheme()

const root = document.getElementById('app')
if (root) root.textContent = 'ready'
```

Create an empty `src/styles/app.css` for now.

Add to `src/styles/app.css`:

```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--wall);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.6;
  transition: background-color .25s ease, color .25s ease;
}
```

- [ ] **Step 9: Run both suites**

```bash
npm run test        # 4 passed
npm run test:pixel  # 4 passed
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: design tokens, light and dark themes, self-hosted fonts"
```

---

### Task 3: Pure geometry

All the math the renderer needs, as pure functions. No canvas, so it is fast unit-testable. This is where Review Focus 1 is pinned.

**Files:**
- Create: `src/core/types.ts`, `src/core/geometry.ts`
- Create: `tests/unit/geometry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Size = { W: number; H: number }`
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `resolveSize(ratio: Ratio, longEdge: number, photo?: { width: number; height: number }): Size`
  - `cover(iw: number, ih: number, boxW: number, boxH: number, zoom?: number): { s: number; w: number; h: number }`
  - `fitRect(box: Size, aspect: number, scalePct: number, ox: number, oy: number): Rect`
  - `matRect(fr: Rect, mat: number, matBottom: number, k: number): Rect`

- [ ] **Step 1: Create `src/core/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test for `resolveSize`**

`tests/unit/geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveSize, cover, fitRect, matRect } from '../../src/core/geometry'

describe('resolveSize', () => {
  it('puts the long edge on width for landscape ratios', () => {
    expect(resolveSize('3:2', 1440)).toEqual({ W: 1440, H: 960 })
  })

  it('puts the long edge on height for portrait ratios', () => {
    expect(resolveSize('4:5', 1440)).toEqual({ W: 1152, H: 1440 })
  })

  it('handles square', () => {
    expect(resolveSize('1:1', 1080)).toEqual({ W: 1080, H: 1080 })
  })

  it('uses the photo aspect for orig', () => {
    expect(resolveSize('orig', 1000, { width: 4000, height: 3000 })).toEqual({ W: 1000, H: 750 })
    expect(resolveSize('orig', 1000, { width: 3000, height: 4000 })).toEqual({ W: 750, H: 1000 })
  })

  it('falls back to 4:5 for orig with no photo', () => {
    expect(resolveSize('orig', 1000)).toEqual({ W: 800, H: 1000 })
  })
})

describe('cover', () => {
  it('fills a box wider than the source', () => {
    const r = cover(3000, 1000, 800, 1000)
    expect(r.w).toBeGreaterThanOrEqual(800)
    expect(r.h).toBeGreaterThanOrEqual(1000)
  })

  it('fills a box taller than the source', () => {
    const r = cover(1000, 3000, 800, 1000)
    expect(r.w).toBeGreaterThanOrEqual(800)
    expect(r.h).toBeGreaterThanOrEqual(1000)
  })

  it('preserves the source aspect ratio', () => {
    const r = cover(4000, 3000, 800, 1000)
    expect(r.w / r.h).toBeCloseTo(4000 / 3000, 6)
  })

  it('applies zoom multiplicatively', () => {
    const base = cover(4000, 3000, 800, 1000)
    const zoomed = cover(4000, 3000, 800, 1000, 2)
    expect(zoomed.w).toBeCloseTo(base.w * 2, 6)
  })
})

describe('fitRect', () => {
  it('centres a frame in the canvas at the given scale', () => {
    const r = fitRect({ W: 1000, H: 1000 }, 1, 50, 0, 0)
    expect(r.w).toBe(500)
    expect(r.h).toBe(500)
    expect(r.x).toBe(250)
    expect(r.y).toBe(250)
  })

  it('shrinks to fit when the photo is wider than the box', () => {
    const r = fitRect({ W: 1000, H: 1000 }, 2, 80, 0, 0)
    expect(r.w).toBe(800)
    expect(r.h).toBe(400)
  })
})

describe('matRect', () => {
  it('extends the frame evenly by mat, plus matBottom below', () => {
    const r = matRect({ x: 100, y: 100, w: 400, h: 500 }, 20, 60, 1)
    expect(r.x).toBe(80)
    expect(r.y).toBe(80)
    expect(r.w).toBe(440)
    expect(r.h).toBe(500 + 20 * 2 + 60)
  })

  it('scales the mat by k', () => {
    const r = matRect({ x: 0, y: 0, w: 10, h: 10 }, 5, 5, 2)
    expect(r.w).toBe(10 + 20)
    expect(r.h).toBe(10 + 20 + 10)
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/unit/geometry.test.ts`
Expected: FAIL — cannot resolve `../../src/core/geometry`.

- [ ] **Step 4: Implement `src/core/geometry.ts`**

```ts
import type { Ratio, Rect, Size } from './types'

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
```

- [ ] **Step 5: Add the Review Focus 1 test**

Append to `tests/unit/geometry.test.ts`:

```ts
import { aspectOf } from '../../src/core/geometry'

describe('[RF-1] extreme aspect ratios never letterbox', () => {
  it('covers a 4:5 frame from a 3:1 panorama', () => {
    const size = resolveSize('4:5', 1440)
    const fr = fitRect(size, aspectOf('orig', { width: 3000, height: 1000 }), 72, 0, 0)
    const c = cover(3000, 1000, fr.w, fr.h, 1)
    expect(c.w).toBeGreaterThanOrEqual(fr.w - 1e-9)
    expect(c.h).toBeGreaterThanOrEqual(fr.h - 1e-9)
  })

  it('covers a 16:9 frame from a 1:3 portrait', () => {
    const size = resolveSize('16:9', 1440)
    const fr = fitRect(size, aspectOf('orig', { width: 1000, height: 3000 }), 72, 0, 0)
    const c = cover(1000, 3000, fr.w, fr.h, 1)
    expect(c.w).toBeGreaterThanOrEqual(fr.w - 1e-9)
    expect(c.h).toBeGreaterThanOrEqual(fr.h - 1e-9)
  })
})
```

- [ ] **Step 6: Run and confirm all pass**

Run: `npx vitest run tests/unit/geometry.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/geometry.ts tests/unit/geometry.test.ts
git commit -m "feat(core): pure geometry — canvas sizing, cover-crop, frame and mat rects"
```

---

### Task 4: Mat, bevel, and shadow

Draws the white mat with its 1px inset bevel and the drop shadow. The prototype's hard-won detail — drawing the photo 1px oversized inside its clip so antialiasing cannot reveal a seam — is preserved.

**Files:**
- Create: `src/core/mat.ts`
- Create: `tests/pixel/mat.spec.ts`
- Modify: `src/main.ts` (extend the dev API)

**Interfaces:**
- Consumes: `Rect` from Task 3
- Produces: `roundedRect(ctx, r, radius)`, `drawMat(ctx, mat: Rect, radius: number, shadow: number, k: number)`

- [ ] **Step 1: Extend the dev API in `src/main.ts`**

The dev API is the spec's preserved affordance (§8) and the hook Playwright drives. It must exist before the pixel test.

```ts
import { initTheme } from './ui/theme'
import './styles/tokens.css'
import './styles/app.css'

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
      return [d[0], d[1], d[2], d[3]]
    },
  }
  ;(window as unknown as { __frame: typeof api }).__frame = api
}
```

- [ ] **Step 2: Write the failing pixel test**

`tests/pixel/mat.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('the mat fills its rect with pure white', async ({ page }) => {
  const px = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 400, 400)
    const { drawMat } = (window as any).__frameCore
    drawMat(ctx, { x: 100, y: 100, w: 200, h: 200 }, 0, 0, 1)
    return f.pixel(200, 200)
  })
  expect(px.slice(0, 3)).toEqual([255, 255, 255])
  expect(px[3]).toBe(255)
})

test('the bevel line is drawn at inset 5px', async ({ page }) => {
  const [edge, bevel] = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(400, 400)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 400, 400)
    const { drawMat } = (window as any).__frameCore
    drawMat(ctx, { x: 100, y: 100, w: 200, h: 200 }, 0, 0, 1)
    return [f.pixel(102, 200), f.pixel(105, 200)]
  })
  const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
  expect(lum(bevel)).toBeLessThan(lum(edge))
})
```

The second test asserts the bevel exists by contrast, not by an exact colour — so it survives a token tweak.

- [ ] **Step 3: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/mat.spec.ts`
Expected: FAIL — `__frameCore` is undefined.

- [ ] **Step 4: Implement `src/core/mat.ts`**

```ts
import type { Rect } from './types'

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.beginPath()
  ctx.moveTo(r.x + rad, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad)
  ctx.closePath()
}

const BEVEL_INSET = 5
const BEVEL_ALPHA = 0.09

export function drawMat(
  ctx: CanvasRenderingContext2D,
  mat: Rect,
  radius: number,
  shadow: number,
  k: number,
): void {
  ctx.save()
  if (shadow > 0) {
    const sh = shadow / 100
    ctx.shadowColor = `rgba(0,0,0,${(0.75 * sh).toFixed(3)})`
    ctx.shadowBlur = 60 * k * sh
    ctx.shadowOffsetY = 16 * k * sh
  }
  ctx.fillStyle = '#FFFFFF'
  roundedRect(ctx, mat, Math.max(0, radius * k))
  ctx.fill()
  ctx.restore()

  // the bevel: a 1px line inset from the mat edge, on the mat surface
  const inset = BEVEL_INSET * k
  ctx.save()
  ctx.strokeStyle = `rgba(28,27,24,${BEVEL_ALPHA})`
  ctx.lineWidth = 1 * k
  roundedRect(
    ctx,
    { x: mat.x + inset, y: mat.y + inset, w: mat.w - inset * 2, h: mat.h - inset * 2 },
    Math.max(0, radius * k),
  )
  ctx.stroke()
  ctx.restore()
}
```

- [ ] **Step 5: Expose core to the dev API**

In `src/main.ts`, inside the `?dev=1` block, before assigning `window.__frame`:

```ts
import { drawMat } from './core/mat'
// ...
;(window as unknown as { __frameCore: unknown }).__frameCore = { drawMat }
```

- [ ] **Step 6: Run and confirm pass**

Run: `npm run test:pixel -- tests/pixel/mat.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/mat.ts tests/pixel/mat.spec.ts src/main.ts
git commit -m "feat(core): mat, bevel and shadow rendering"
```

---

### Task 5: Background treatment

**Files:**
- Create: `src/core/background.ts`
- Create: `tests/pixel/background.spec.ts`
- Modify: `src/main.ts` (dev API)

**Interfaces:**
- Consumes: `cover` (Task 3), `Background`/`Size` (Task 3)
- Produces: `drawBackground(ctx, size, bg: Background, photo: { el, width, height } | null, k: number)`

- [ ] **Step 1: Write the failing pixel test**

`tests/pixel/background.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('solid mode fills the requested colour', async ({ page }) => {
  const px = await page.evaluate(async () => {
    const f = (window as any).__frame
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    const { drawBackground } = (window as any).__frameCore
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'solid', color: '#102030' }, null, 1)
    return f.pixel(100, 100)
  })
  expect(px.slice(0, 3)).toEqual([16, 32, 48])
})

test('an empty canvas with no photo paints #2a3238', async ({ page }) => {
  const px = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    const { drawBackground } = (window as any).__frameCore
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur' }, null, 1)
    return f.pixel(100, 100)
  })
  expect(px.slice(0, 3)).toEqual([42, 50, 56])
})

test('darken lowers the luminance of a blurred background', async ({ page }) => {
  const [plain, darkened] = await page.evaluate(async () => {
    const f = (window as any).__frame
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample.webp'
    })
    const photo = { el: img, width: img.naturalWidth, height: img.naturalHeight }
    f.setSize(200, 200)
    const ctx = f.ctx()
    const { drawBackground } = (window as any).__frameCore

    ctx.clearRect(0, 0, 200, 200)
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur', blur: 20, darken: 0 }, photo, 1)
    const a = f.pixel(100, 100)

    ctx.clearRect(0, 0, 200, 200)
    drawBackground(ctx, { W: 200, H: 200 }, { mode: 'blur', blur: 20, darken: 64 }, photo, 1)
    const b = f.pixel(100, 100)

    return [a, b]
  })
  expect(lum(darkened)).toBeLessThan(lum(plain) * 0.6)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/background.spec.ts`
Expected: FAIL — `drawBackground` is not a function.

- [ ] **Step 3: Implement `src/core/background.ts`**

```ts
import { cover } from './geometry'
import type { Background, Size } from './types'

type Source = { el: CanvasImageSource; width: number; height: number }

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  size: Size,
  bg: Background,
  photo: Source | null,
  k: number,
): void {
  const { W, H } = size

  if (!photo || bg.mode === 'none') {
    ctx.fillStyle = bg.mode === 'solid' && bg.color ? bg.color : '#2a3238'
    ctx.fillRect(0, 0, W * k, H * k)
    return
  }

  if (bg.mode === 'solid') {
    ctx.fillStyle = bg.color ?? '#2a3238'
    ctx.fillRect(0, 0, W * k, H * k)
    return
  }

  const blur = (bg.blur ?? 0) * k
  const pad = blur * 3 + 8
  const zoom = (bg.zoom ?? 100) / 100
  const c = cover(photo.width, photo.height, W * k + pad * 2, H * k + pad * 2, zoom)
  const x = (W * k + pad * 2 - c.w) / 2 - pad
  const y = (H * k + pad * 2 - c.h) / 2 - pad

  ctx.save()
  if (typeof ctx.filter !== 'undefined') {
    ctx.filter = `blur(${blur}px)`
    ctx.drawImage(photo.el, x, y, c.w, c.h)
  } else {
    const div = Math.max(4, blur / 2)
    const tw = Math.max(8, Math.round(c.w / div))
    const th = Math.max(8, Math.round(c.h / div))
    const tmp = document.createElement('canvas')
    tmp.width = tw
    tmp.height = th
    const tc = tmp.getContext('2d')
    if (tc) {
      tc.drawImage(photo.el, 0, 0, tw, th)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(tmp, x, y, c.w, c.h)
    }
  }
  ctx.restore()

  const darken = bg.darken ?? 0
  if (darken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darken / 100})`
    ctx.fillRect(0, 0, W * k, H * k)
  }
}
```

- [ ] **Step 4: Add `drawBackground` to the dev API**

In `src/main.ts`, extend the `__frameCore` object:

```ts
import { drawBackground } from './core/background'
// ...
;(window as unknown as { __frameCore: unknown }).__frameCore = { drawMat, drawBackground }
```

Also copy the fixture so tests can load it:

```bash
mkdir -p public/sample
cp sample/samples-from-x9-pro-with-some-editing-v0-m6wmpeint76g1.webp public/sample/sample.webp
```

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test:pixel -- tests/pixel/background.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/background.ts tests/pixel/background.spec.ts src/main.ts public/sample
git commit -m "feat(core): blurred, solid and empty background treatments"
```

---

### Task 6: Text slots and auto-fit

This pins Review Focus 3 — text must shrink rather than overflow the mat.

**Files:**
- Create: `src/core/text.ts`
- Create: `tests/pixel/text.spec.ts`
- Modify: `src/main.ts` (dev API)

**Interfaces:**
- Consumes: `Rect`, `TextConfig`, `TextSlotId`, `Size` (Task 3)
- Produces:
  - `measureToFit(ctx, text, maxWidth, font: (size: number) => string, size: number): number` — returns the size that fits
  - `drawText(ctx, size, config: TextConfig, values: Partial<Record<TextSlotId, string>>, frame: Rect, k: number): void`
  - `frameFont(size: number, weight: number): string`

- [ ] **Step 1: Write the failing test**

`tests/pixel/text.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

const CFG = {
  anchor: 'bottom' as const,
  slots: [{ id: 'title' as const, size: 34, weight: 700, color: '#ffffff' }],
}

test('a short title renders and stays inside the canvas', async ({ page }) => {
  const hasInk = await page.evaluate(() => {
    const f = (window as any).__frame
    f.setSize(600, 600)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 600, 600)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 600, 600)
    const { drawText } = (window as any).__frameCore
    drawText(ctx, { W: 600, H: 600 }, CFG, { title: 'Hello' }, { x: 0, y: 0, w: 600, h: 600 }, 1)
    return f.sample(0, 0, 600, 600).some((v: number, i: number) => i % 4 !== 3 && v > 200)
  })
  expect(hasInk).toBe(true)
})

test('[RF-3] an overlong title shrinks and never crosses its max width', async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = (window as any).__frame
    const { measureToFit, frameFont } = (window as any).__frameCore
    const ctx = f.ctx()
    const long = '光落在该落的地方光落在该落的地方光落在该落的地方光落在该落的地方'
    const maxWidth = 300

    const fitted = measureToFit(ctx, long, maxWidth, (s: number) => frameFont(s, 700), 34)
    ctx.font = frameFont(fitted, 700)
    const width = ctx.measureText(long).width

    return { fitted, width, maxWidth, original: 34 }
  })

  expect(result.fitted).toBeLessThan(result.original)
  expect(result.width).toBeLessThanOrEqual(result.maxWidth + 0.5)
})
```

The second test measures the *fitted* string, so it fails if the shrink is wrong by even a pixel — not merely if it looks off.

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/text.spec.ts`
Expected: FAIL — `drawText` is not a function.

- [ ] **Step 3: Implement `src/core/text.ts`**

```ts
import type { Rect, Size, TextConfig, TextSlotId } from './types'

const CJK_FAMILY = '-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif'

export function frameFont(size: number, weight: number): string {
  return `${weight} ${size}px ${CJK_FAMILY}`
}

export function measureToFit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: (size: number) => string,
  size: number,
): number {
  ctx.font = font(size)
  const w = ctx.measureText(text).width
  if (w <= maxWidth || w === 0) return size
  return size * (maxWidth / w)
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  size: Size,
  config: TextConfig,
  values: Partial<Record<TextSlotId, string>>,
  frame: Rect,
  k: number,
): void {
  const { W, H } = size
  const maxW = W * 0.86 * k

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  for (const slot of config.slots) {
    const raw = values[slot.id]
    if (!raw) continue

    const base = (slot.size / 100) * H * 0.20 * k
    const fitted = measureToFit(ctx, raw, maxW, (s) => frameFont(s, slot.weight), base)
    ctx.font = frameFont(fitted, slot.weight)

    let y: number
    if (config.anchor === 'top') y = H * 0.10 * k + (slot.id === 'sub' ? fitted * 1.15 : 0)
    else if (config.anchor === 'center') y = H * 0.50 * k
    else y = H * 0.90 * k

    if (slot.stroke) {
      ctx.lineWidth = fitted * 0.14
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(raw, W * 0.5 * k, y)
    }
    ctx.fillStyle = slot.color
    ctx.fillText(raw, W * 0.5 * k, y)
  }

  ctx.restore()
}
```

Note: `anchor: 'mat'` (text in the bottom mat band) is **not** implemented in this task. It arrives with Task 11's Polaroid template, where the mat band geometry is known. Do not add it speculatively here.

- [ ] **Step 4: Add to the dev API**

```ts
import { drawText, measureToFit, frameFont } from './core/text'
// ...
;(window as unknown as { __frameCore: unknown }).__frameCore = {
  drawMat,
  drawBackground,
  drawText,
  measureToFit,
  frameFont,
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test:pixel -- tests/pixel/text.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/text.ts tests/pixel/text.spec.ts src/main.ts
git commit -m "feat(core): text slots with auto-fit that cannot overflow"
```

---

### Task 7: The render spine

Composes tasks 3–6 into `render()`. This is the spec's spine.

**Files:**
- Create: `src/core/render.ts`
- Create: `tests/pixel/render.spec.ts`
- Modify: `src/main.ts` (dev API exposes `render`)

**Interfaces:**
- Consumes: `resolveSize`/`aspectOf`/`fitRect`/`matRect` (Task 3), `drawMat`/`roundedRect` (Task 4), `drawBackground` (Task 5), `drawText` (Task 6)
- Produces: `render(input: RenderInput): void`

- [ ] **Step 1: Write the failing test**

`tests/pixel/render.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]

const TEMPLATE = {
  id: 'test',
  name: 'test',
  layout: { kind: 'single' as const },
  canvas: { ratio: '1:1' as const },
  background: { mode: 'blur' as const, blur: 20, darken: 40, zoom: 120 },
  frame: { scale: 70, radius: 8, mat: 24, matBottom: 0, shadow: 40 },
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
  await page.evaluate(async () => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = '/sample/sample.webp'
    })
    ;(window as any).__photo = {
      el: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      name: 'sample',
      exif: null,
    }
  })
})

test('render paints the mat white and the background darker than it', async ({ page }) => {
  const [centre, corner] = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    f.setSize(600, 600)
    const { render } = (window as any).__frameCore
    render({
      ctx: f.ctx(),
      size: { W: 600, H: 600 },
      k: 1,
      template: tpl,
      photos: [(window as any).__photo],
      text: {},
      exif: null,
    })
    return [f.pixel(300, 300), f.pixel(4, 4)]
  }, TEMPLATE)

  expect(centre.slice(0, 3)).toEqual([255, 255, 255])
  expect(lum(corner)).toBeLessThan(200)
})

test('k=2 fills twice the area of k=1', async ({ page }) => {
  const sizes = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    const { render } = (window as any).__frameCore
    f.setSize(600, 600)
    render({
      ctx: f.ctx(),
      size: { W: 600, H: 600 },
      k: 1,
      template: tpl,
      photos: [(window as any).__photo],
      text: {},
      exif: null,
    })
    const a = f.pixel(300, 300)

    f.setSize(1200, 1200)
    const ctx = f.ctx()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    render({
      ctx,
      size: { W: 600, H: 600 },
      k: 2,
      template: tpl,
      photos: [(window as any).__photo],
      text: {},
      exif: null,
    })
    return [a, f.pixel(600, 600)]
  }, TEMPLATE)

  expect(sizes[0].slice(0, 3)).toEqual(sizes[1].slice(0, 3))
})

test('render with no photo does not throw', async ({ page }) => {
  const ok = await page.evaluate((tpl) => {
    const f = (window as any).__frame
    f.setSize(300, 300)
    const { render } = (window as any).__frameCore
    try {
      render({
        ctx: f.ctx(),
        size: { W: 300, H: 300 },
        k: 1,
        template: tpl,
        photos: [],
        text: {},
        exif: null,
      })
      return true
    } catch {
      return false
    }
  }, TEMPLATE)
  expect(ok).toBe(true)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/render.spec.ts`
Expected: FAIL — `render` is not a function.

- [ ] **Step 3: Implement `src/core/render.ts`**

```ts
import { drawBackground } from './background'
import { aspectOf, cover, fitRect, matRect } from './geometry'
import { drawMat, roundedRect } from './mat'
import { drawText } from './text'
import type { RenderInput, Rect } from './types'

const PHOTO_OVERDRAW = 1

export function render(input: RenderInput): void {
  const { ctx, size, k, template, photos, text, exif } = input
  const photo = photos[0] ?? null

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)

  const backgroundSource = photo
    ? { el: photo.preview ?? photo.el, width: photo.width, height: photo.height }
    : null
  drawBackground(ctx, size, template.background, backgroundSource, k)

  let frame: Rect | null = null

  if (photo) {
    const aspect = aspectOf(template.canvas.ratio, photo)
    frame = fitRect(size, aspect, template.frame.scale, 0, 0)

    const mat = matRect(frame, template.frame.mat, template.frame.matBottom, k)
    const inset = 1 * k
    drawMat(
      ctx,
      {
        x: mat.x + inset,
        y: mat.y + inset,
        w: Math.max(1, mat.w - inset * 2),
        h: Math.max(1, mat.h - inset * 2),
      },
      Math.max(0, template.frame.radius * k + template.frame.mat * k - inset),
      template.frame.shadow,
      k,
    )

    // photo, clipped to its rounded rect and drawn 1px oversized so the clip
    // can never reveal a seam. `preview` is the downscale for on-screen
    // rendering; export passes photos without one, so `el` is used there.
    const src = photo.preview ?? photo.el
    ctx.save()
    roundedRect(ctx, frame, template.frame.radius * k)
    ctx.clip()
    const g = PHOTO_OVERDRAW * k
    const c = cover(photo.width, photo.height, frame.w + g * 2, frame.h + g * 2, 1)
    ctx.drawImage(
      src,
      frame.x - g + (frame.w + g * 2 - c.w) / 2,
      frame.y - g + (frame.h + g * 2 - c.h) / 2,
      c.w,
      c.h,
    )
    ctx.restore()
  }

  if (template.text && frame) {
    drawText(ctx, size, template.text, text, frame, k)
  }

  void exif // the plate arrives in Task 16

  ctx.restore()
}
```

- [ ] **Step 4: Expose `render` on the dev API**

```ts
import { render } from './core/render'
// ...
;(window as unknown as { __frameCore: unknown }).__frameCore = {
  drawMat, drawBackground, drawText, measureToFit, frameFont, render,
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test:pixel -- tests/pixel/render.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite**

```bash
npm run test && npm run test:pixel
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/core/render.ts tests/pixel/render.spec.ts src/main.ts
git commit -m "feat(core): the render spine composing background, mat and text"
```

---

### Task 8: Photo input and validation

Pins Review Focus 4. Decoding is where a photo app most often fails silently.

**Files:**
- Create: `src/ui/input.ts`
- Create: `tests/unit/input.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Photo`, `Exif` (Task 3)
- Produces:
  - `classifyFile(file: File): 'image' | 'unsupported' | 'empty'`
  - `decodePhoto(file: File, readExif: (buf: ArrayBuffer) => Exif | null): Promise<Photo>` — rejects with a message suitable for display
- Rejects with `new Error('图片读取失败')` for undecodable input, `new Error('文件为空')` for zero bytes.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/input.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyFile, needsDownscale, previewScale } from '../../src/ui/input'

const file = (name: string, type: string, size: number) =>
  ({ name, type, size }) as File

describe('[RF-4] classifyFile', () => {
  it('accepts image mime types', () => {
    expect(classifyFile(file('a.jpg', 'image/jpeg', 1000))).toBe('image')
    expect(classifyFile(file('a.heic', 'image/heic', 1000))).toBe('image')
    expect(classifyFile(file('a.webp', 'image/webp', 1000))).toBe('image')
  })

  it('rejects a zero-byte file before anything downstream sees it', () => {
    expect(classifyFile(file('a.jpg', 'image/jpeg', 0))).toBe('empty')
  })

  it('rejects a PDF renamed to .jpg', () => {
    expect(classifyFile(file('a.jpg', 'application/pdf', 1000))).toBe('unsupported')
  })

  it('rejects a file with no mime type at all', () => {
    expect(classifyFile(file('a', '', 1000))).toBe('unsupported')
  })
})

describe('preview downscaling', () => {
  it('leaves images at or under 12 MP alone', () => {
    expect(needsDownscale(4000, 3000)).toBe(false)
  })

  it('downscales above 12 MP', () => {
    expect(needsDownscale(6000, 4000)).toBe(true)
  })

  it('scales a 50 MP image to about 4 MP', () => {
    const s = previewScale(8660, 5773)
    const result = 8660 * s * (5773 * s)
    expect(result).toBeGreaterThan(3_900_000)
    expect(result).toBeLessThanOrEqual(4_000_000)
  })

  it('does not scale up a small image', () => {
    expect(previewScale(800, 600)).toBe(1)
  })
})
```

`classifyFile` is pure and takes only `{name, type, size}`, so it unit-tests without a DOM.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/input.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/input`.

- [ ] **Step 3: Implement `src/ui/input.ts`**

```ts
import type { Exif, Photo } from '../core/types'

export type FileClass = 'image' | 'unsupported' | 'empty'

/** Spec §9: previews render from ~4 MP; the full image is used only at export. */
export const PREVIEW_MAX_PIXELS = 4_000_000
export const DOWNSCALE_THRESHOLD_PIXELS = 12_000_000

export function classifyFile(file: File): FileClass {
  if (file.size === 0) return 'empty'
  if (!file.type || file.type.indexOf('image/') !== 0) return 'unsupported'
  return 'image'
}

/** Returns a downscaled preview element for a large image, else null. Pure
 *  enough to unit-test the decision, which is separated out below. */
export function needsDownscale(
  width: number,
  height: number,
  threshold = DOWNSCALE_THRESHOLD_PIXELS,
): boolean {
  return width * height > threshold
}

export function previewScale(
  width: number,
  height: number,
  maxPixels = PREVIEW_MAX_PIXELS,
): number {
  const pixels = width * height
  if (pixels <= maxPixels) return 1
  return Math.sqrt(maxPixels / pixels)
}

function downscale(img: HTMLImageElement): HTMLImageElement | null {
  const s = previewScale(img.naturalWidth, img.naturalHeight)
  if (s >= 1) return null
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * s))
  c.height = Math.max(1, Math.round(img.naturalHeight * s))
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const out = new Image()
  out.src = c.toDataURL('image/png')
  return out
}

export async function decodePhoto(
  file: File,
  readExif: (buf: ArrayBuffer) => Exif | null,
): Promise<Photo> {
  const cls = classifyFile(file)
  if (cls === 'empty') throw new Error('文件为空')
  if (cls === 'unsupported') throw new Error('这不是图片文件')

  const buf = await file.arrayBuffer()
  const exif = readExif(buf)

  const url = URL.createObjectURL(file)
  try {
    const el = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () =>
        reject(new Error('图片读取失败 — 该格式可能不被此浏览器支持（HEIC 需要 Safari）'))
      img.src = url
    })
    if (!el.naturalWidth || !el.naturalHeight) throw new Error('图片读取失败')

    let preview: HTMLImageElement | undefined
    if (needsDownscale(el.naturalWidth, el.naturalHeight)) {
      preview = downscale(el) ?? undefined
      if (preview) {
        await new Promise<void>((res) => {
          if (preview!.complete) return res()
          preview!.onload = () => res()
          preview!.onerror = () => res()
        })
      }
    }

    return {
      el,
      preview,
      width: el.naturalWidth,
      height: el.naturalHeight,
      name: (file.name || '').replace(/\.[^.]+$/, ''),
      exif,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function wireInput(
  drop: HTMLElement,
  fileInput: HTMLInputElement,
  onPhoto: (photo: Photo) => void,
  onError: (message: string) => void,
  readExif: (buf: ArrayBuffer) => Exif | null,
): void {
  const handle = async (file: File | undefined | null) => {
    if (!file) return
    try {
      onPhoto(await decodePhoto(file, readExif))
    } catch (e) {
      onError(e instanceof Error ? e.message : '图片读取失败')
    }
  }

  drop.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    void handle(t.files?.[0])
    t.value = ''
  })

  ;['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.add('over')
    }),
  )
  ;['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault()
      drop.classList.remove('over')
    }),
  )
  drop.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer
    void handle(dt?.files?.[0])
  })

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items ?? []
    for (const it of items) {
      if (it.type && it.type.indexOf('image/') === 0) {
        void handle(it.getAsFile())
        return
      }
    }
  })
}
```

`URL.revokeObjectURL` in a `finally` fixes a leak the prototype had — it never revoked on the load path.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/input.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/input.ts tests/unit/input.test.ts
git commit -m "feat(ui): photo input with legible failures and no object-url leak"
```

---

### Task 9: Export

Pins Review Focus 5 — canvas dimension limits, which are a hard browser ceiling and the most likely cause of a mystifying failure on large exports.

**Files:**
- Create: `src/ui/export.ts`
- Create: `tests/unit/export.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `render` (Task 7), `Size`, `Template`, `Photo` (Task 3)
- Produces:
  - `MAX_CANVAS_EDGE = 16384`
  - `fitsCanvas(size: Size, k: number): boolean`
  - `renderToCanvas(size, k, template, photos, text, exif): HTMLCanvasElement`
  - `exportPng(opts): Promise<{ blob: Blob; filename: string }>` — retries at k=1 when 2× does not fit
  - `stamp(d: Date): string`

- [ ] **Step 1: Write the failing unit test**

`tests/unit/export.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fitsCanvas, stamp, MAX_CANVAS_EDGE } from '../../src/ui/export'

describe('fitsCanvas', () => {
  it('accepts sizes well inside the limit', () => {
    expect(fitsCanvas({ W: 1440, H: 1800 }, 2)).toBe(true)
  })

  it('[RF-5] rejects a 2x export past the maximum edge', () => {
    expect(fitsCanvas({ W: 12000, H: 4000 }, 2)).toBe(false)
  })

  it('accepts the same size at 1x', () => {
    expect(fitsCanvas({ W: 12000, H: 4000 }, 1)).toBe(true)
  })

  it('uses the documented maximum', () => {
    expect(MAX_CANVAS_EDGE).toBe(16384)
    expect(fitsCanvas({ W: 8192, H: 100 }, 1)).toBe(true)
    expect(fitsCanvas({ W: 8193, H: 100 }, 2)).toBe(false)
  })
})

describe('stamp', () => {
  it('formats as YYYY-MM-DD-HH-mm-ss in local time', () => {
    expect(stamp(new Date(2026, 9, 7, 15, 4, 9))).toBe('2026-10-07-15-04-09')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/export.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/export`.

- [ ] **Step 3: Implement `src/ui/export.ts`**

```ts
import { render } from '../core/render'
import type { Exif, Photo, Size, Template, TextSlotId } from '../core/types'

export const MAX_CANVAS_EDGE = 16384

export function fitsCanvas(size: Size, k: number): boolean {
  return size.W * k <= MAX_CANVAS_EDGE && size.H * k <= MAX_CANVAS_EDGE
}

export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return [
    d.getFullYear(),
    p(d.getMonth() + 1),
    p(d.getDate()),
    p(d.getHours()),
    p(d.getMinutes()),
    p(d.getSeconds()),
  ].join('-')
}

export function renderToCanvas(
  size: Size,
  k: number,
  template: Template,
  photos: Photo[],
  text: Partial<Record<TextSlotId, string>>,
  exif: Exif | null,
): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = size.W * k
  out.height = size.H * k
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('导出失败：无法创建画布')
  // strip `preview` so the export always draws from the full-resolution image
  const full = photos.map(({ preview: _preview, ...rest }) => rest)
  render({ ctx, size, k, template, photos: full, text, exif })
  return out
}

export type ExportOpts = {
  size: Size
  template: Template
  photos: Photo[]
  text: Partial<Record<string, string>>
  exif: Exif | null
  want?: 2 | 4
}

export async function exportPng(
  opts: ExportOpts,
): Promise<{ blob: Blob; filename: string; k: number; downgraded: boolean }> {
  const want = opts.want ?? 2
  let k = want
  let downgraded = false

  if (!fitsCanvas(opts.size, k)) {
    k = 1
    downgraded = true
  }

  const canvas = renderToCanvas(
    opts.size,
    k,
    opts.template,
    opts.photos,
    opts.text as Partial<Record<TextSlotId, string>>,
    opts.exif,
  )

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('导出失败：图片太大，请降低输出长边')

  const filename = `frame_${canvas.width}x${canvas.height}_${stamp(new Date())}.png`
  return { blob, filename, k, downgraded }
}

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/**
 * Spec §8: export is a ceremony, not a toast. The chrome recedes, the finished
 * poster stands alone on the wall, and its dimensions are stated beneath it.
 *
 * This subsumes the prototype's separate iOS save sheet: on iOS the ceremony's
 * image is the thing the user long-presses, so there is one moment rather than
 * two. `hint` carries that instruction on iOS and is absent elsewhere.
 */
export function showCeremony(
  dataUrl: string,
  width: number,
  height: number,
  onAgain: () => void,
  hint?: string,
): void {
  document.body.classList.add('ceremony-open')

  const el = document.createElement('div')
  el.className = 'ceremony'
  el.innerHTML = `
    <div class="ceremony-art"><img alt="成品"></div>
    <div class="ceremony-copy">
      <h3>已装裱</h3>
      <p class="ceremony-dims">${width} × ${height} PNG</p>
      ${hint ? `<p class="ceremony-hint">${hint}</p>` : ''}
      <div class="ceremony-acts">
        <button class="btn btn-primary" data-act="again">再存一张</button>
        <button class="btn" data-act="done">完成</button>
      </div>
    </div>`

  const img = el.querySelector('img')
  if (img) img.src = dataUrl

  const close = () => {
    document.body.classList.remove('ceremony-open')
    el.remove()
  }

  el.querySelector('[data-act="again"]')?.addEventListener('click', () => {
    close()
    onAgain()
  })
  el.querySelector('[data-act="done"]')?.addEventListener('click', close)

  document.body.appendChild(el)
  requestAnimationFrame(() => el.classList.add('in'))
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(new Error('导出失败'))
    fr.readAsDataURL(blob)
  })
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/export.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the sheet and ceremony styles**

Append to `src/styles/app.css` — values from the design reference:

```css
.sheet {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 26, .90);
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 14px;
}
.sheet img { max-width: 100%; max-height: 72vh; border-radius: 2px; }
.sheet p { color: #fff; font-size: 13px; margin: 0; text-align: center; }
.sheet button {
  padding: 10px 26px;
  border-radius: 2px;
  border: 1px solid var(--bevel);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
}

/* the export ceremony — spec §8 */
body.ceremony-open .dock { opacity: 0; pointer-events: none; }
.ceremony {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 32px;
  background: var(--wall);
  background-image: linear-gradient(180deg, var(--wall-hi), var(--wall) 46%, var(--wall-lo));
  opacity: 0;
  transition: opacity .3s ease;
}
.ceremony.in { opacity: 1; }
.ceremony-art img {
  max-width: min(46vw, 360px);
  max-height: 72vh;
  display: block;
  box-shadow: var(--deep);
  border-radius: 2px;
}
.ceremony-copy h3 {
  font-family: var(--serif);
  font-weight: 400;
  font-size: 21px;
  margin: 0 0 10px;
}
.ceremony-dims {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--quiet);
  margin: 0 0 18px;
}
.ceremony-hint {
  font-size: 12px;
  color: var(--quiet);
  margin: -8px 0 16px;
}
.ceremony-acts { display: flex; gap: 10px; }
.ceremony-acts .btn { flex: none; }
@media (max-width: 760px) {
  .ceremony { flex-direction: column; gap: 24px; text-align: center; }
  .ceremony-art img { max-width: 72vw; max-height: 52vh; }
  .ceremony-acts { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
  .ceremony { transition: none; }
}
```

- [ ] **Step 6: Write the ceremony test**

`tests/pixel/ceremony.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('the ceremony hides the chrome and states the dimensions', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const mod = (window as any).__frameCeremony
    return mod.showCeremony('data:image/gif;base64,R0lGODlhAQABAAAAACw=', 2880, 3600, () => {})
  })

  await expect(page.locator('.ceremony')).toHaveCount(1)
  await expect(page.locator('.ceremony-dims')).toHaveText('2880 × 3600 PNG')

  // the dock is present but receded — not removed, so nothing reflows
  const dockOpacity = await page.locator('.dock').evaluate(
    (el) => getComputedStyle(el).opacity,
  )
  expect(dockOpacity).toBe('0')

  await page.locator('[data-act="done"]').click()
  await expect(page.locator('.ceremony')).toHaveCount(0)
})
```

The `__frameCeremony` handle must exist now, not in Task 12 — Task 12's dev-API block comes later and this test cannot wait for it. Add to `src/main.ts`, in a `?dev=1` guard of its own (Task 12 will fold it into the consolidated dev API):

```ts
import { showCeremony } from './ui/export'
// ...
if (new URLSearchParams(location.search).has('dev')) {
  ;(window as unknown as Record<string, unknown>).__frameCeremony = { showCeremony }
}
```

- [ ] **Step 7: Run and confirm pass**

Run: `npm run build && npm run test && npm run test:pixel`
Expected: PASS, 5 unit + 1 ceremony.

- [ ] **Step 8: Commit**

```bash
git add src/ui/export.ts tests/unit/export.test.ts tests/pixel/ceremony.spec.ts src/styles/app.css src/main.ts
git commit -m "feat(ui): png export, canvas-limit fallback, ios sheet, and the export ceremony"
```

---

### Task 10: The app shell

The frame-first layout: the wall dominates, the dock holds the rail and exactly two actions. No adjustments panel exists in stages 1–4.

**Files:**
- Create: `src/ui/state.ts`, `src/ui/toast.ts`
- Modify: `index.html`, `src/styles/app.css`, `src/main.ts`

**Interfaces:**
- Consumes: `Photo`, `Template` (Task 3)
- Produces: `createState()`, `type AppState`, `toast(msg: string): void`; the DOM structure later tasks bind to — `#cv`, `#rail`, `#save`, `#drop`, `#file`, `#toast`

- [ ] **Step 1: Create `src/ui/state.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/ui/toast.ts`**

```ts
let host: HTMLElement | null = null
let timer: number | undefined

export function toast(message: string): void {
  if (!host) {
    host = document.getElementById('toast')
    if (!host) return
  }
  host.textContent = message
  host.classList.add('show')
  window.clearTimeout(timer)
  timer = window.setTimeout(() => host?.classList.remove('show'), 1800)
}
```

- [ ] **Step 3: Replace `index.html` body**

```html
<body>
<div class="app">
  <main class="stage" id="stage">
    <canvas id="cv"></canvas>
    <div class="toast" id="toast"></div>
  </main>

  <aside class="dock">
    <div class="drop" id="drop">把照片放到墙上<small>点击选择，也可以拖进来或粘贴</small></div>
    <input type="file" id="file" accept="image/*" hidden>

    <div class="rail-h"><b>样式</b></div>
    <div class="rail" id="rail"></div>

    <div class="acts">
      <button class="btn btn-primary" id="save">保存</button>
    </div>
  </aside>
</div>
<div id="app" hidden></div>
<script type="module" src="/src/main.ts"></script>
</body>
```

There is deliberately **no 调整 button** and no sliders. Per spec §4, adjustments are stages 5–6.

- [ ] **Step 4: Style the shell**

Append to `src/styles/app.css`:

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background-image: linear-gradient(180deg, var(--wall-hi), var(--wall) 46%, var(--wall-lo));
}
canvas#cv { max-width: 92%; max-height: 92%; box-shadow: var(--deep); border-radius: 2px; }
.dock {
  flex: none;
  background: var(--surface);
  border-top: 1px solid var(--bevel);
  padding: 14px 18px calc(18px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drop {
  border: 1px dashed var(--bevel);
  border-radius: 2px;
  padding: 14px;
  text-align: center;
  font-size: 13px;
  color: var(--quiet);
  cursor: pointer;
}
.drop small { display: block; font-size: 11.5px; margin-top: 4px; color: var(--faint); }
.drop.over { border-color: var(--ink); color: var(--ink); }
.rail-h b { font-weight: 400; font-size: 12.5px; color: var(--label); }
.rail { display: flex; gap: 9px; overflow-x: auto; padding-bottom: 2px; }
.acts { display: flex; }
.btn {
  font-family: var(--sans);
  font-size: 14px;
  padding: 12px 24px;
  border-radius: 2px;
  cursor: pointer;
  border: 1px solid var(--bevel);
  background: var(--surface);
  color: var(--ink);
}
.btn-primary {
  flex: 1;
  background: var(--action-bg);
  border-color: var(--action-bg);
  color: var(--action-fg);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
}
.toast {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--action-bg);
  color: var(--action-fg);
  font-size: 12.5px;
  padding: 9px 16px;
  border-radius: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .25s;
  white-space: nowrap;
  max-width: 90%;
}
.toast.show { opacity: 1; }

@media (min-width: 901px) {
  .app { flex-direction: row; }
  .stage { order: 1; }
  .dock {
    order: 0;
    flex: none;
    width: 340px;
    border-top: 0;
    border-right: 1px solid var(--bevel);
    overflow-y: auto;
  }
}
```

- [ ] **Step 5: Add the shell pixel test**

`tests/pixel/shell.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('the dock offers exactly one primary action', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.btn-primary')).toHaveCount(1)
  await expect(page.locator('.btn-primary')).toHaveText('保存')
})

test('there is no adjustments control in stages 1-4', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('调整', { exact: true })).toHaveCount(0)
})
```

The second test is a guard rail: it fails if someone reintroduces the adjustments panel before its plan exists.

- [ ] **Step 6: Run**

```bash
npm run build && npm run test:pixel
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add index.html src/ui/state.ts src/ui/toast.ts src/styles/app.css tests/pixel/shell.spec.ts
git commit -m "feat(ui): frame-first app shell with a single primary action"
```

---

### Task 11: Template model and the built-in set

Templates become data. The prototype's eight layouts are migrated into records.

**Files:**
- Create: `src/core/templates.ts`
- Create: `tests/unit/templates.test.ts`

**Interfaces:**
- Consumes: `Template` (Task 3)
- Produces: `TEMPLATES: Template[]`, `validateTemplate(t: unknown): { ok: true; value: Template } | { ok: false; error: string }`, `getTemplate(id: string): Template | undefined`

- [ ] **Step 1: Write the failing test**

`tests/unit/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TEMPLATES, validateTemplate, getTemplate } from '../../src/core/templates'

describe('TEMPLATES', () => {
  it('every built-in template validates', () => {
    for (const t of TEMPLATES) {
      expect(validateTemplate(t), t.id).toEqual({ ok: true, value: t })
    }
  })

  it('has unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks exactly one template premium in v1', () => {
    expect(TEMPLATES.filter((t) => t.premium).map((t) => t.id)).toEqual(['spec-sheet'])
  })

  it('getTemplate finds by id and returns undefined otherwise', () => {
    expect(getTemplate('classic')?.name).toBe('经典')
    expect(getTemplate('nope')).toBeUndefined()
  })
})

describe('validateTemplate', () => {
  it('rejects a non-object', () => {
    expect(validateTemplate(null).ok).toBe(false)
    expect(validateTemplate('x').ok).toBe(false)
  })

  it('rejects a missing id', () => {
    expect(validateTemplate({ name: 'x' }).ok).toBe(false)
  })

  it('rejects an unknown anchor', () => {
    const bad = { ...TEMPLATES[0], text: { anchor: 'sideways', slots: [] } }
    expect(validateTemplate(bad).ok).toBe(false)
  })

  it('accepts a minimal valid template', () => {
    const ok = validateTemplate({
      id: 'a',
      name: 'A',
      layout: { kind: 'single' },
      canvas: { ratio: '1:1' },
      background: { mode: 'blur' },
      frame: { scale: 70, radius: 0, mat: 0, matBottom: 0, shadow: 0 },
    })
    expect(ok.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/templates.test.ts`
Expected: FAIL — cannot resolve `../../src/core/templates`.

- [ ] **Step 3: Implement `src/core/templates.ts`**

```ts
import type { Ratio, Template, TextAnchor } from './types'

const RATIOS: Ratio[] = ['4:5', '1:1', '3:2', '16:9', '9:16', 'orig']
const ANCHORS: TextAnchor[] = ['top', 'bottom', 'center', 'mat']

export type Validation =
  | { ok: true; value: Template }
  | { ok: false; error: string }

export function validateTemplate(t: unknown): Validation {
  if (typeof t !== 'object' || t === null) return { ok: false, error: 'not an object' }
  const o = t as Record<string, unknown>

  if (typeof o.id !== 'string' || !o.id) return { ok: false, error: 'missing id' }
  if (typeof o.name !== 'string' || !o.name) return { ok: false, error: 'missing name' }

  const layout = o.layout as Record<string, unknown> | undefined
  if (!layout || typeof layout.kind !== 'string') return { ok: false, error: 'missing layout' }
  if (!['single', 'split', 'grid'].includes(layout.kind)) {
    return { ok: false, error: 'unknown layout kind' }
  }

  const canvas = o.canvas as Record<string, unknown> | undefined
  if (!canvas || !RATIOS.includes(canvas.ratio as Ratio)) {
    return { ok: false, error: 'invalid ratio' }
  }

  const bg = o.background as Record<string, unknown> | undefined
  if (!bg || !['blur', 'solid', 'none'].includes(bg.mode as string)) {
    return { ok: false, error: 'invalid background mode' }
  }

  const f = o.frame as Record<string, unknown> | undefined
  if (!f) return { ok: false, error: 'missing frame' }
  for (const key of ['scale', 'radius', 'mat', 'matBottom', 'shadow']) {
    if (typeof f[key] !== 'number') return { ok: false, error: `frame.${key} must be a number` }
  }

  if (o.text !== undefined) {
    const tx = o.text as Record<string, unknown>
    if (!ANCHORS.includes(tx.anchor as TextAnchor)) return { ok: false, error: 'invalid anchor' }
    if (!Array.isArray(tx.slots)) return { ok: false, error: 'slots must be an array' }
  }

  if (o.plate !== undefined) {
    const p = o.plate as Record<string, unknown>
    if (typeof p.enabled !== 'boolean') return { ok: false, error: 'plate.enabled must be boolean' }
    if (!Array.isArray(p.fields)) return { ok: false, error: 'plate.fields must be an array' }
  }

  return { ok: true, value: t as Template }
}

export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: '经典',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 28, darken: 30, zoom: 118 },
    frame: { scale: 72, radius: 8, mat: 0, matBottom: 0, shadow: 45 },
    text: {
      anchor: 'bottom',
      slots: [
        { id: 'sub', size: 14, weight: 500, color: '#ffffff' },
        { id: 'title', size: 34, weight: 700, color: '#ffffff', stroke: true },
      ],
    },
  },
  {
    id: 'polaroid',
    name: '拍立得',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 36, darken: 14, zoom: 134 },
    frame: { scale: 64, radius: 0, mat: 16, matBottom: 104, shadow: 38 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 26, weight: 400, color: '#2b2b2b' }] },
  },
  {
    id: 'magazine',
    name: '杂志封面',
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'blur', blur: 46, darken: 54, zoom: 130 },
    frame: { scale: 58, radius: 0, mat: 0, matBottom: 0, shadow: 24 },
    text: {
      anchor: 'top',
      slots: [
        { id: 'title', size: 46, weight: 700, color: '#ffffff', stroke: true },
        { id: 'sub', size: 19, weight: 500, color: '#ffffff' },
      ],
    },
  },
  {
    id: 'cinema',
    name: '电影感',
    layout: { kind: 'single' },
    canvas: { ratio: '16:9' },
    background: { mode: 'blur', blur: 62, darken: 64, zoom: 148 },
    frame: { scale: 62, radius: 4, mat: 0, matBottom: 0, shadow: 55 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 24, weight: 500, color: '#f4f2ee' }],
    },
  },
  {
    id: 'postcard',
    name: '明信片',
    layout: { kind: 'single' },
    canvas: { ratio: '3:2' },
    background: { mode: 'blur', blur: 40, darken: 12, zoom: 126 },
    frame: { scale: 72, radius: 2, mat: 18, matBottom: 74, shadow: 30 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 28, weight: 400, color: '#333333' }] },
  },
  {
    id: 'minimal',
    name: '留白',
    layout: { kind: 'single' },
    canvas: { ratio: '1:1' },
    background: { mode: 'blur', blur: 48, darken: 6, zoom: 126 },
    frame: { scale: 56, radius: 26, mat: 0, matBottom: 0, shadow: 20 },
  },
  {
    id: 'square',
    name: '社媒方形',
    layout: { kind: 'single' },
    canvas: { ratio: '1:1' },
    background: { mode: 'blur', blur: 30, darken: 32, zoom: 120 },
    frame: { scale: 78, radius: 10, mat: 0, matBottom: 0, shadow: 44 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 32, weight: 700, color: '#ffffff', stroke: true }],
    },
  },
  {
    id: 'story',
    name: '竖版故事',
    layout: { kind: 'single' },
    canvas: { ratio: '9:16' },
    background: { mode: 'blur', blur: 34, darken: 36, zoom: 132 },
    frame: { scale: 60, radius: 14, mat: 0, matBottom: 0, shadow: 40 },
    text: {
      anchor: 'bottom',
      slots: [{ id: 'title', size: 30, weight: 700, color: '#ffffff', stroke: true }],
    },
  },
  {
    id: 'spec-sheet',
    name: '样张',
    premium: true,
    layout: { kind: 'single' },
    canvas: { ratio: '4:5' },
    background: { mode: 'solid', color: '#FFFFFF' },
    frame: { scale: 78, radius: 0, mat: 86, matBottom: 150, shadow: 0 },
    text: { anchor: 'mat', slots: [{ id: 'title', size: 24, weight: 400, color: '#1C1B18' }] },
    plate: {
      enabled: true,
      fields: ['focal', 'aperture', 'shutter', 'iso'],
      color: '#3A3833',
      align: 'center',
    },
  },
]

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
```

Note `anchor: 'mat'` is used by three templates but not yet implemented — Task 12 implements it. Templates declaring it before it works is intentional: the validation test passes, and Task 12's test is what proves the rendering.

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/templates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/templates.ts tests/unit/templates.test.ts
git commit -m "feat(core): template model, validation, and the nine built-in templates"
```

---

### Task 12: Mat-anchored text, the template rail, and live rendering

Implements the `'mat'` anchor the Polaroid and spec-sheet templates need, then wires the rail so the app actually renders photos.

**Files:**
- Modify: `src/core/text.ts` (add the `'mat'` anchor)
- Create: `src/ui/rail.ts`
- Modify: `src/main.ts`, `src/styles/app.css`
- Create: `tests/pixel/mat-anchor.spec.ts`

**Interfaces:**
- Consumes: `drawText` (Task 6), `TEMPLATES` (Task 11), `render` (Task 7), `matRect` (Task 3)
- Produces: `drawText(...)` gains mat-anchor support; `renderRail(host, templates, activeId, onPick)`

- [ ] **Step 1: Write the failing test for the mat anchor**

`tests/pixel/mat-anchor.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

test('mat-anchored text lands inside the bottom band, not on the photo', async ({ page }) => {
  const result = await page.evaluate(() => {
    const f = (window as any).__frame
    const { drawText, matRect } = (window as any).__frameCore

    const size = { W: 600, H: 750 }
    const frame = { x: 100, y: 100, w: 400, h: 400 }
    const mat = matRect(frame, 16, 104, 1)
    const bandTop = frame.y + frame.h + 16

    f.setSize(600, 750)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 600, 750)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 600, 750)

    drawText(
      ctx,
      size,
      { anchor: 'mat', slots: [{ id: 'title', size: 26, weight: 400, color: '#000000' }] },
      { title: 'City Walk' },
      frame,
      1,
    )

    const darkRows: number[] = []
    for (let y = Math.round(bandTop); y < Math.round(mat.y + mat.h); y++) {
      const row = f.sample(Math.round(mat.x), y, Math.round(mat.w), 1)
      for (let i = 0; i < row.length; i += 4) {
        if (row[i] < 100) {
          darkRows.push(y)
          break
        }
      }
    }
    return { first: darkRows[0] ?? null, last: darkRows[darkRows.length - 1] ?? null, bandTop }
  })

  expect(result.first).not.toBeNull()
  expect(result.first!).toBeGreaterThanOrEqual(result.bandTop - 1)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/mat-anchor.spec.ts`
Expected: FAIL — text renders at the bottom-of-canvas position, above `bandTop`.

- [ ] **Step 3: Add the `'mat'` anchor to `src/core/text.ts`**

Replace `drawText` in full. The only change from Task 6 is the new `matBottom`
parameter and the `'mat'` branch; `measureToFit` and `frameFont` are unchanged.

```ts
export function drawText(
  ctx: CanvasRenderingContext2D,
  size: Size,
  config: TextConfig,
  values: Partial<Record<TextSlotId, string>>,
  frame: Rect,
  k: number,
  matBottom = 0,
): void {
  const { W, H } = size
  const maxW = W * 0.86 * k

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'

  for (const slot of config.slots) {
    const raw = values[slot.id]
    if (!raw) continue

    const base = (slot.size / 100) * H * 0.20 * k
    const fitted = measureToFit(ctx, raw, maxW, (s) => frameFont(s, slot.weight), base)
    ctx.font = frameFont(fitted, slot.weight)

    let y: number
    if (config.anchor === 'mat' && matBottom > 4 * k) {
      // the white band below the photo: sit 62% down it, which reads as
      // optically centred rather than mathematically centred
      y = frame.y + frame.h + matBottom * k * 0.62
    } else if (config.anchor === 'top') {
      y = H * 0.10 * k + (slot.id === 'sub' ? fitted * 1.15 : 0)
    } else if (config.anchor === 'center') {
      y = H * 0.50 * k
    } else {
      y = H * 0.90 * k
    }

    if (slot.stroke) {
      ctx.lineWidth = fitted * 0.14
      ctx.strokeStyle = 'rgba(0,0,0,.55)'
      ctx.lineJoin = 'round'
      ctx.strokeText(raw, W * 0.5 * k, y)
    }
    ctx.fillStyle = slot.color
    ctx.fillText(raw, W * 0.5 * k, y)
  }

  ctx.restore()
}
```

Note the guard: when `anchor` is `'mat'` but the template has no bottom mat to speak of (`matBottom <= 4 * k`), the branch is skipped and the slot falls through to the default bottom position. That is the spec's stated behaviour — never place text into a band too thin to hold it.

- [ ] **Step 4: Pass `matBottom` through from `render`**

In `src/core/render.ts`, change the text call:

```ts
  if (template.text && frame) {
    drawText(ctx, size, template.text, text, frame, k, template.frame.matBottom)
  }
```

- [ ] **Step 5: Run and confirm pass**

Run: `npm run test:pixel -- tests/pixel/mat-anchor.spec.ts`
Expected: PASS.

- [ ] **Step 6: Create the rail**

`src/ui/rail.ts`:

```ts
import type { Template } from '../core/types'

export function renderRail(
  host: HTMLElement,
  templates: Template[],
  activeId: string | null,
  onPick: (id: string) => void,
): void {
  host.textContent = ''
  for (const t of templates) {
    const b = document.createElement('button')
    b.className = 'print' + (t.id === activeId ? ' on' : '')
    if (t.premium) b.classList.add('brass')
    b.type = 'button'
    b.title = t.name
    b.setAttribute('aria-label', t.name)
    b.setAttribute('aria-pressed', t.id === activeId ? 'true' : 'false')
    b.addEventListener('click', () => onPick(t.id))
    host.appendChild(b)
  }
}
```

- [ ] **Step 7: Add the rail styles**

Append to `src/styles/app.css`:

```css
.print {
  position: relative;
  flex: none;
  width: 50px;
  height: 62px;
  border: 1px solid var(--bevel);
  border-radius: 2px;
  background: var(--surface);
  cursor: pointer;
  padding: 0;
}
.print.on { border-color: var(--ink); box-shadow: var(--lift); }
.print.on::after {
  content: '';
  position: absolute;
  inset: 3px;
  border: 1px solid var(--ink);
  border-radius: 1px;
  opacity: .55;
}
.print.brass::before {
  content: '';
  position: absolute;
  top: -1px;
  right: -1px;
  width: 11px;
  height: 11px;
  background: var(--brass);
  clip-path: polygon(100% 0, 100% 100%, 0 0);
}
```

- [ ] **Step 8: Wire it all in `src/main.ts`**

Replace the app boot with a working editor.

**Note:** Tasks 4–7 each appended a dev-API object to `main.ts` so their pixel tests could run. This step replaces that file wholesale and consolidates the dev API into one block at the bottom of the listing below — the earlier incremental forms are superseded, not lost.

```ts
import { render } from './core/render'
import { resolveSize, matRect } from './core/geometry'
import { TEMPLATES, getTemplate } from './core/templates'
import { drawMat, roundedRect } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { initTheme } from './ui/theme'
import { createState } from './ui/state'
import { toast } from './ui/toast'
import { renderRail } from './ui/rail'
import { wireInput } from './ui/input'
import { readExif } from './core/exif'
import { exportPng, download, isIOS, showCeremony, blobToDataUrl } from './ui/export'
import './styles/tokens.css'
import './styles/app.css'

initTheme()

const state = createState({ template: TEMPLATES[0] ?? null })
const cv = document.getElementById('cv') as HTMLCanvasElement
const ctx = cv.getContext('2d')

function draw(): void {
  if (!ctx || !state.template) return
  const photo = state.photo
  const size = resolveSize(
    state.template.canvas.ratio,
    state.longEdge,
    photo ? { width: photo.width, height: photo.height } : undefined,
  )
  state.size = size
  cv.width = size.W
  cv.height = size.H
  render({
    ctx,
    size,
    k: 1,
    template: state.template,
    photos: photo ? [photo] : [],
    text: state.text,
    exif: state.exif,
  })
}

function pick(id: string): void {
  const t = getTemplate(id)
  if (!t) return
  state.template = t
  renderRail(rail, TEMPLATES, id, pick)
  draw()
}

const rail = document.getElementById('rail') as HTMLElement
const drop = document.getElementById('drop') as HTMLElement
const file = document.getElementById('file') as HTMLInputElement

wireInput(
  drop,
  file,
  (photo) => {
    state.photo = photo
    state.exif = photo.exif
    draw()
    toast(`已载入 ${photo.width} × ${photo.height}`)
  },
  (msg) => toast(msg),
  readExif,
)

document.getElementById('save')?.addEventListener('click', async () => {
  if (!state.photo || !state.template) {
    toast('请先载入图片')
    return
  }
  try {
    const { blob, filename, k, downgraded } = await exportPng({
      size: state.size,
      template: state.template,
      photos: [state.photo],
      text: state.text,
      exif: state.exif,
      want: 2,
    })
    if (downgraded) toast('图片过大，已按 1× 导出')
    if (!isIOS()) download(blob, filename)

    const dataUrl = await blobToDataUrl(blob)
    showCeremony(
      dataUrl,
      state.size.W * k,
      state.size.H * k,
      () => void draw(),
      isIOS() ? '长按图片存储到相册' : undefined,
    )
  } catch (e) {
    toast(e instanceof Error ? e.message : '导出失败')
  }
})

renderRail(rail, TEMPLATES, state.template?.id ?? null, pick)
draw()

// Dev affordance — see spec §8. Enabled only with ?dev=1.
const probeCanvas = document.createElement('canvas')
if (new URLSearchParams(location.search).has('dev')) {
  const w = window as unknown as Record<string, unknown>
  w.__frame = {
    canvas: probeCanvas,
    size: () => ({ W: probeCanvas.width, H: probeCanvas.height }),
    setSize: (W: number, H: number) => {
      probeCanvas.width = W
      probeCanvas.height = H
    },
    ctx: () => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return c
    },
    sample: (x: number, y: number, sw: number, sh: number) => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      return Array.from(c.getImageData(x, y, sw, sh).data)
    },
    pixel: (x: number, y: number): [number, number, number, number] => {
      const c = probeCanvas.getContext('2d')
      if (!c) throw new Error('no 2d context')
      const d = c.getImageData(x, y, 1, 1).data
      return [d[0] as number, d[1] as number, d[2] as number, d[3] as number]
    },
  }
  w.__frameCore = {
    render,
    drawMat,
    drawBackground,
    drawText,
    measureToFit,
    frameFont,
    matRect,
    roundedRect,
  }
  w.__frameTemplates = { TEMPLATES, getTemplate }
  w.__frameCeremony = { showCeremony }
  w.__frameExport = { exportPng, renderToCanvas, fitsCanvas, stamp }
}
```

This replaces the interim `?dev=1` block Task 9 added for `__frameCeremony`.

Task 12 must also retire Task 1's smoke test, which asserted `#app` still read `'ready'`:

```bash
git rm tests/pixel/smoke.spec.ts
```

The shell it checked no longer exists — `#app` was a placeholder from the scaffold and this task deletes the line that filled it. Keeping the file would leave a permanently red test asserting the absence of a feature. The app has real tests now; the smoke test has done its job.

`readExif` arrives in Task 15. **Until then, stub it** as `export function readExif(_buf: ArrayBuffer): Exif | null { return null }` in `src/core/exif.ts` so this task compiles.

Add the imports this block needs at the top of `src/main.ts`:

```ts
import { drawMat, roundedRect } from './core/mat'
import { drawBackground } from './core/background'
import { drawText, measureToFit, frameFont } from './core/text'
import { matRect } from './core/geometry'
import { showCeremony } from './ui/export'
```

- [ ] **Step 9: Run everything**

```bash
npm run build && npm run test && npm run test:pixel
```
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: mat-anchored text, template rail, and live rendering"
```

---

### Task 13: Custom templates

**Files:**
- Create: `src/ui/custom.ts`
- Create: `tests/unit/custom.test.ts`
- Modify: `index.html` (the 存为模板 button), `src/main.ts`

**Interfaces:**
- Consumes: `Template`, `validateTemplate` (Task 11)
- Produces: `loadCustom(storage: Storage | null): Template[]`, `saveCustom(storage: Storage | null, list: Template[]): boolean`

- [ ] **Step 1: Write the failing test**

`tests/unit/custom.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadCustom, saveCustom } from '../../src/ui/custom'
import { TEMPLATES } from '../../src/core/templates'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

describe('custom templates', () => {
  it('round-trips a valid template', () => {
    const s = memoryStorage()
    expect(saveCustom(s, [TEMPLATES[0]])).toBe(true)
    expect(loadCustom(s).map((t) => t.id)).toEqual([TEMPLATES[0].id])
  })

  it('returns an empty list when storage is unavailable', () => {
    expect(loadCustom(null)).toEqual([])
  })

  it('returns an empty list rather than throwing on corrupt json', () => {
    const s = memoryStorage()
    s.setItem('frame-app-custom-v1', '{not json')
    expect(loadCustom(s)).toEqual([])
  })

  it('drops entries that no longer validate', () => {
    const s = memoryStorage()
    s.setItem('frame-app-custom-v1', JSON.stringify([{ id: 'broken' }, TEMPLATES[0]]))
    expect(loadCustom(s).map((t) => t.id)).toEqual([TEMPLATES[0].id])
  })

  it('reports failure when setItem throws', () => {
    const s = memoryStorage()
    s.setItem = () => { throw new Error('quota') }
    expect(saveCustom(s, [TEMPLATES[0]])).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/custom.test.ts`
Expected: FAIL — cannot resolve `../../src/ui/custom`.

- [ ] **Step 3: Implement `src/ui/custom.ts`**

```ts
import { validateTemplate } from '../core/templates'
import type { Template } from '../core/types'

const KEY = 'frame-app-custom-v1'

export function loadCustom(storage: Storage | null): Template[] {
  if (!storage) return []
  let raw: string | null = null
  try {
    raw = storage.getItem(KEY)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Template[] = []
  for (const entry of parsed) {
    const v = validateTemplate(entry)
    if (v.ok) out.push(v.value)
  }
  return out
}

export function saveCustom(storage: Storage | null, list: Template[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/custom.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire save into the dock**

Add a button to `index.html` inside `.acts`, before `#save`:

```html
<button class="btn" id="saveTpl">存为模板</button>
```

In `src/main.ts`:

```ts
import { loadCustom, saveCustom, browserStorage } from './ui/custom'
// ...
document.getElementById('saveTpl')?.addEventListener('click', () => {
  if (!state.template) return
  const name = (prompt('模板名称', state.template.name + ' 副本') || '').trim()
  if (!name) return
  const list = loadCustom(browserStorage())
  const copy: Template = { ...state.template, id: `custom-${Date.now()}`, name, premium: false }
  if (saveCustom(browserStorage(), [...list, copy])) {
    toast(`已保存模板：${name}`)
  } else {
    toast('保存失败：浏览器存储不可用')
  }
})
```

- [ ] **Step 6: Run and commit**

```bash
npm run build && npm run test
git add -A
git commit -m "feat(ui): save custom templates, degrading gracefully without storage"
```

---

### Task 14: Cross-theme pixel suite

The spec's regression net, applied to every built-in template in both themes.

**Files:**
- Create: `tests/pixel/templates.spec.ts`

**Interfaces:**
- Consumes: everything from tasks 1–13
- Produces: no new API — this task exists to catch regressions

- [ ] **Step 1: Write the suite**

```ts
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TEMPLATE_IDS = [
  'classic', 'polaroid', 'magazine', 'cinema', 'postcard',
  'minimal', 'square', 'story', 'spec-sheet',
]

const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]

for (const theme of ['light', 'dark'] as const) {
  for (const id of TEMPLATE_IDS) {
    test(`${id} renders in ${theme}`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto('/?dev=1')
      await page.waitForFunction(() => '__frame' in window)

      const result = await page.evaluate(async (templateId) => {
        const f = (window as any).__frame
        const { render } = (window as any).__frameCore
        const { getTemplate } = (window as any).__frameTemplates

        const img = new Image()
        await new Promise((res, rej) => {
          img.onload = res
          img.onerror = rej
          img.src = '/sample/sample.webp'
        })
        const photo = {
          el: img, width: img.naturalWidth, height: img.naturalHeight,
          name: 'sample', exif: null,
        }

        const size = { W: 480, H: 600 }
        f.setSize(size.W, size.H)
        const ctx = f.ctx()
        ctx.clearRect(0, 0, size.W, size.H)
        render({
          ctx, size, k: 1,
          template: getTemplate(templateId),
          photos: [photo], text: {}, exif: null,
        })
        return Array.from(ctx.getImageData(0, 0, size.W, size.H).data)
      }, id)

      // invariant: something was actually drawn
      const nonBlank = result.some((v: number, i: number) => i % 4 !== 3 && v > 8)
      expect(nonBlank, `${id} drew nothing`).toBe(true)

      // invariant: no fully transparent pixel inside the canvas
      let transparent = 0
      for (let i = 3; i < result.length; i += 4) if (result[i] === 0) transparent++
      expect(transparent, `${id} left transparent pixels`).toBe(0)

      // golden: catches unintended change
      const buf = Buffer.from(result)
      expect(buf).toMatchSnapshot(`${id}-${theme}.rgba`)
    })
  }
}
```

`tests/pixel/__screenshots__/` holds the goldens; commit them. Re-baseline with `npx playwright test --update-snapshots` **only** when a template is intentionally changed — never to make a red test go green.

- [ ] **Step 2: Run it**

```bash
npm run test:pixel -- tests/pixel/templates.spec.ts
```
Expected: PASS, 18 tests, and 18 golden files created on first run.

- [ ] **Step 3: Verify the transparency invariant actually bites**

Temporarily set one template's `frame.scale` to `0` and re-run. Expected: the transparent-pixel assertion fails. Revert.

- [ ] **Step 4: Commit**

```bash
git add tests/pixel/templates.spec.ts tests/pixel/__screenshots__
git commit -m "test: cross-theme pixel suite for all built-in templates"
```

---

### Task 15: The EXIF reader

The differentiator's foundation. Hand-written, zero dependencies. Pins half of Review Focus 2.

**Files:**
- Create: `src/core/exif.ts` (replacing the Task 12 stub)
- Create: `tests/unit/exif.test.ts`
- Create: `tests/fixtures/with-exif.jpg`, `tests/fixtures/no-exif.jpg`, `tests/fixtures/partial-exif.jpg`

**Interfaces:**
- Consumes: `Exif` (Task 3)
- Produces: `readExif(buf: ArrayBuffer): Exif | null`

- [ ] **Step 1: Create the fixtures**

```bash
mkdir -p tests/fixtures
# with-exif.jpg    — any JPEG straight from a phone camera, EXIF intact
# no-exif.jpg      — a JPEG exported by an editor with metadata stripped
# partial-exif.jpg — a JPEG carrying FocalLength but no ApertureValue/ISOSpeedRatings
ls -l tests/fixtures
```

Take `with-exif.jpg` from a real camera if possible. A synthesised file will not exercise the parser honestly.

- [ ] **Step 2: Write the failing test**

`tests/unit/exif.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readExif } from '../../src/core/exif'

const buf = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', name)).buffer as ArrayBuffer

describe('readExif', () => {
  it('reads the core tags from a camera file', () => {
    const e = readExif(buf('with-exif.jpg'))
    expect(e).not.toBeNull()
    expect(e!.focal).toMatch(/^\d+(\.\d+)?mm$/)
    expect(e!.aperture).toMatch(/^f\/\d+(\.\d+)?$/)
    expect(e!.iso).toMatch(/^ISO \d+$/)
  })

  it('[RF-2] returns null for a file with no EXIF segment', () => {
    expect(readExif(buf('no-exif.jpg'))).toBeNull()
  })

  it('[RF-2] returns a partial object when tags are missing, never throwing', () => {
    const e = readExif(buf('partial-exif.jpg'))
    expect(e).not.toBeNull()
    expect(e!.focal).toBeDefined()
    expect(e!.aperture).toBeUndefined()
  })

  it('returns null for a buffer that is not a JPEG', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer
    expect(readExif(junk)).toBeNull()
  })

  it('returns null for a truncated JPEG', () => {
    const full = new Uint8Array(buf('with-exif.jpg'))
    const cut = full.slice(0, 40).buffer
    expect(readExif(cut)).toBeNull()
  })

  it('never throws on random bytes', () => {
    const bytes = new Uint8Array(2048)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256
    expect(() => readExif(bytes.buffer)).not.toThrow()
  })
})
```

The last three tests are the important ones. A hand-written binary parser earning `null` instead of throwing is the whole safety property.

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/unit/exif.test.ts`
Expected: FAIL — stub returns `null` for `with-exif.jpg`.

- [ ] **Step 4: Implement `src/core/exif.ts`**

```ts
import type { Exif } from './types'

const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD = 0x8769
const TAG_FOCAL = 0xa405          // FocalLengthIn35mmFilm
const TAG_FOCAL_RAW = 0x920a      // FocalLength
const TAG_FNUMBER = 0x829d        // FNumber
const TAG_APERTURE = 0x9202       // ApertureValue (APEX)
const TAG_EXPOSURE = 0x829a       // ExposureTime
const TAG_SHUTTER_APEX = 0x9201   // ShutterSpeedValue (APEX)
const TAG_ISO = 0x8827

type Reader = { view: DataView; le: boolean; tiffStart: number }

function u16(r: Reader, off: number): number {
  return r.view.getUint16(r.tiffStart + off, r.le)
}
function u32(r: Reader, off: number): number {
  return r.view.getUint32(r.tiffStart + off, r.le)
}

function rational(r: Reader, valueOffset: number): number | null {
  const num = u32(r, valueOffset)
  const den = u32(r, valueOffset + 4)
  if (den === 0) return null
  return num / den
}

function readTagValue(r: Reader, entry: number): { tag: number; type: number; count: number; valueOffset: number } {
  const tag = u16(r, entry)
  const type = u16(r, entry + 2)
  const count = u32(r, entry + 4)
  const valueOffset = entry + 8
  return { tag, type, count, valueOffset }
}

function ascii(r: Reader, entry: number, count: number): string {
  const size = count
  const off = size <= 4 ? entry + 8 : u32(r, entry + 8)
  let s = ''
  for (let i = 0; i < count; i++) {
    const c = r.view.getUint8(r.tiffStart + off + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}

function scanIfd(r: Reader, ifdOffset: number, into: Map<number, { type: number; count: number; entry: number }>): number {
  if (ifdOffset + 2 > r.view.byteLength - r.tiffStart) return 0
  const count = u16(r, ifdOffset)
  if (count > 512) return 0
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12
    if (entry + 12 > r.view.byteLength - r.tiffStart) break
    const { tag, type, count: c } = readTagValue(r, entry)
    if (!into.has(tag)) into.set(tag, { type, count: c, entry })
  }
  const nextPtr = ifdOffset + 2 + count * 12
  if (nextPtr + 4 > r.view.byteLength - r.tiffStart) return 0
  return u32(r, nextPtr)
}

export function readExif(buf: ArrayBuffer): Exif | null {
  try {
    const view = new DataView(buf)
    if (view.byteLength < 16) return null
    if (view.getUint16(0, false) !== 0xffd8) return null

    // walk JPEG segments to APP1/Exif
    let off = 2
    let tiffStart = -1
    while (off + 4 <= view.byteLength) {
      if (view.getUint8(off) !== 0xff) return null
      const marker = view.getUint8(off + 1)
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      if (marker === 0xda || marker === 0xd9) break
      const size = view.getUint16(off + 2, false)
      if (size < 2) return null

      if (marker === 0xe1) {
        const tagOff = off + 4
        if (tagOff + 6 > view.byteLength) return null
        // "Exif\0\0"
        if (
          view.getUint8(tagOff) === 0x45 &&
          view.getUint8(tagOff + 1) === 0x78 &&
          view.getUint8(tagOff + 2) === 0x69 &&
          view.getUint8(tagOff + 3) === 0x66
        ) {
          tiffStart = tagOff + 6
          break
        }
      }
      off += 2 + size
    }

    if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return null

    const byteOrder = view.getUint16(tiffStart, false)
    const le = byteOrder === 0x4949
    if (!le && byteOrder !== 0x4d4d) return null

    const r: Reader = { view, le, tiffStart }
    if (u16(r, 2) !== 0x002a) return null
    const ifd0 = u32(r, 4)

    const tags = new Map<number, { type: number; count: number; entry: number }>()
    const exifIfdPtrOffset = scanIfd(r, ifd0, tags)

    const exifIfdTag = tags.get(TAG_EXIF_IFD)
    if (exifIfdTag) {
      const ptr = u32(r, exifIfdTag.entry + 8)
      scanIfd(r, ptr, tags)
    } else if (exifIfdPtrOffset) {
      scanIfd(r, exifIfdPtrOffset, tags)
    }

    const out: Exif = {}

    const make = tags.get(TAG_MAKE)
    const model = tags.get(TAG_MODEL)
    const makeStr = make ? ascii(r, make.entry, make.count) : ''
    const modelStr = model ? ascii(r, model.entry, model.count) : ''
    if (modelStr) {
      const dup = makeStr && modelStr.toLowerCase().startsWith(makeStr.toLowerCase())
      out.camera = dup ? modelStr : [makeStr, modelStr].filter(Boolean).join(' ')
    } else if (makeStr) {
      out.camera = makeStr
    }

    const focal35 = tags.get(TAG_FOCAL)
    const focalRaw = tags.get(TAG_FOCAL_RAW)
    if (focal35) {
      const v = u16(r, focal35.entry + 8)
      if (v > 0) out.focal = `${v}mm`
    }
    if (!out.focal && focalRaw) {
      const v = rational(r, u32(r, focalRaw.entry + 8))
      if (v !== null && v > 0) out.focal = `${Math.round(v)}mm`
    }

    const fnum = tags.get(TAG_FNUMBER)
    if (fnum) {
      const v = rational(r, u32(r, fnum.entry + 8))
      if (v !== null && v > 0) out.aperture = `f/${v.toFixed(1)}`
    }
    if (!out.aperture) {
      const ap = tags.get(TAG_APERTURE)
      if (ap) {
        const apex = rational(r, u32(r, ap.entry + 8))
        if (apex !== null) out.aperture = `f/${Math.pow(2, apex / 2).toFixed(1)}`
      }
    }

    const expo = tags.get(TAG_EXPOSURE)
    if (expo) {
      const v = rational(r, u32(r, expo.entry + 8))
      if (v !== null && v > 0) {
        out.shutter = v >= 1 ? `${v}s` : `1/${Math.round(1 / v)}`
      }
    }
    if (!out.shutter) {
      const sh = tags.get(TAG_SHUTTER_APEX)
      if (sh) {
        const apex = rational(r, u32(r, sh.entry + 8))
        if (apex !== null) {
          const v = Math.pow(2, apex)
          out.shutter = v >= 1 ? `${Math.round(v)}s` : `1/${Math.round(1 / v)}`
        }
      }
    }

    const iso = tags.get(TAG_ISO)
    if (iso) {
      const v = u16(r, iso.entry + 8)
      if (v > 0) out.iso = `ISO ${v}`
    }

    const dt = tags.get(TAG_DATETIME)
    if (dt) {
      const raw = ascii(r, dt.entry, dt.count)
      const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw)
      if (m) out.date = `${m[1]}.${m[2]}.${m[3]}`
    }

    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
```

The outer `try` is load-bearing. Every failure path returns `null`; the parser has no throw path at all.

- [ ] **Step 5: Run and confirm pass**

Run: `npx vitest run tests/unit/exif.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/exif.ts tests/unit/exif.test.ts tests/fixtures
git commit -m "feat(core): hand-written exif reader that returns null instead of throwing"
```

---

### Task 16: The spec plate and the 样张 template

Completes Review Focus 2 — the plate must hide or omit gracefully when data is missing.

**Files:**
- Create: `src/core/plate.ts`
- Create: `tests/pixel/plate.spec.ts`
- Modify: `src/core/render.ts`

**Interfaces:**
- Consumes: `Exif` (Task 3), `Plate` (Task 3), `Rect` (Task 3)
- Produces: `plateFields(plate: Plate, exif: Exif | null): string[]`, `drawPlate(ctx, plate: Plate, exif: Exif | null, band: Rect, k: number): void`

- [ ] **Step 1: Write the failing test**

`tests/pixel/plate.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?dev=1')
  await page.waitForFunction(() => '__frame' in window)
})

const FULL = { focal: '140mm', aperture: 'f/2.1', shutter: '1/82', iso: 'ISO 500' }

test('plateFields produces a value per configured field, in order', async ({ page }) => {
  const out = await page.evaluate((exif) => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture', 'shutter', 'iso'], color: '#000', align: 'center' },
      exif,
    )
  }, FULL)
  expect(out).toEqual(['140mm', 'f/2.1', '1/82', 'ISO 500'])
})

test('[RF-2] a null exif yields no fields at all', async ({ page }) => {
  const out = await page.evaluate(() => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture'], color: '#000', align: 'center' },
      null,
    )
  })
  expect(out).toEqual([])
})

test('[RF-2] missing tags are omitted, present ones kept', async ({ page }) => {
  const out = await page.evaluate(() => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: true, fields: ['focal', 'aperture', 'shutter', 'iso'], color: '#000', align: 'center' },
      { focal: '50mm' },
    )
  })
  expect(out).toEqual(['50mm'])
})

test('a disabled plate yields no fields', async ({ page }) => {
  const out = await page.evaluate((exif) => {
    const { plateFields } = (window as any).__frameCore
    return plateFields(
      { enabled: false, fields: ['focal'], color: '#000', align: 'center' },
      exif,
    )
  }, FULL)
  expect(out).toEqual([])
})

test('drawPlate with no fields paints nothing', async ({ page }) => {
  const changed = await page.evaluate(() => {
    const f = (window as any).__frame
    const { drawPlate } = (window as any).__frameCore
    f.setSize(200, 200)
    const ctx = f.ctx()
    ctx.clearRect(0, 0, 200, 200)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 200, 200)
    const before = f.pixel(100, 150)
    drawPlate(ctx, { enabled: true, fields: ['focal'], color: '#000', align: 'center' }, null, { x: 0, y: 100, w: 200, h: 100 }, 1)
    const after = f.pixel(100, 150)
    return { before, after }
  })
  expect(changed.after).toEqual(changed.before)
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm run test:pixel -- tests/pixel/plate.spec.ts`
Expected: FAIL — `plateFields` is not a function.

- [ ] **Step 3: Implement `src/core/plate.ts`**

```ts
import type { Exif, Plate, PlateField, Rect } from './types'

function valueFor(field: PlateField, exif: Exif): string | undefined {
  switch (field) {
    case 'camera':
      return exif.camera
    case 'focal':
      return exif.focal
    case 'aperture':
      return exif.aperture
    case 'shutter':
      return exif.shutter
    case 'iso':
      return exif.iso
    case 'date':
      return exif.date
  }
}

export function plateFields(plate: Plate, exif: Exif | null): string[] {
  if (!plate.enabled || !exif) return []
  const out: string[] = []
  for (const f of plate.fields) {
    const v = valueFor(f, exif)
    if (v) out.push(v)
  }
  return out
}

export function drawPlate(
  ctx: CanvasRenderingContext2D,
  plate: Plate,
  exif: Exif | null,
  band: Rect,
  k: number,
): void {
  const fields = plateFields(plate, exif)
  if (fields.length === 0) return

  const size = Math.max(8, Math.min(band.h * 0.20, 11 * k))
  ctx.save()
  ctx.font = `400 ${size}px 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`
  ctx.fillStyle = plate.color
  ctx.textBaseline = 'middle'

  const gap = size * 1.8
  const widths = fields.map((f) => ctx.measureText(f).width)
  const total = widths.reduce((a, b) => a + b, 0) + gap * (fields.length - 1)

  let x: number
  if (plate.align === 'left') {
    x = band.x + size
    ctx.textAlign = 'left'
  } else {
    x = band.x + band.w / 2 - total / 2
    ctx.textAlign = 'left'
  }
  const y = band.y + band.h / 2

  fields.forEach((f, i) => {
    ctx.fillText(f, x, y)
    x += (widths[i] ?? 0) + gap
  })

  ctx.restore()
}
```

Fields render as separate runs with a fixed gap, so the row stays aligned even when one value is long.

- [ ] **Step 4: Wire the plate into `render`**

In `src/core/render.ts`, replace `void exif` with:

```ts
  if (template.plate && frame) {
    const mat = matRect(frame, template.frame.mat, template.frame.matBottom, k)
    const bandTop = frame.y + frame.h + template.frame.mat * k
    const band = {
      x: frame.x + template.frame.mat * k,
      y: bandTop,
      w: frame.w,
      h: Math.max(1, mat.y + mat.h - bandTop),
    }
    drawPlate(ctx, template.plate, exif, band, k)
  }
```

And import it:

```ts
import { drawPlate } from './plate'
```

- [ ] **Step 5: Expose the plate on the dev API**

In `src/main.ts`, add to the `__frameCore` object built in Task 12:

```ts
import { drawPlate, plateFields } from './core/plate'
// ...
  w.__frameCore = {
    render, drawMat, drawBackground, drawText, measureToFit, frameFont,
    matRect, roundedRect, drawPlate, plateFields,
  }
```

- [ ] **Step 6: Run and confirm pass**

```bash
npm run test:pixel
```
Expected: all green, including the 18 template snapshots. `spec-sheet` may need re-baselining because it now draws a plate with a null exif — which correctly draws nothing, so its snapshot should be unchanged. Verify before updating.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): exif spec plate that hides cleanly when data is absent"
```

---

### Task 17: Entitlement seam and premium UI

The whole monetization footprint, exactly as spec §10 defines it.

**Files:**
- Create: `src/entitlements.ts`
- Create: `tests/unit/entitlements.test.ts`
- Modify: `index.html` (the plaque row), `src/main.ts`

**Interfaces:**
- Consumes: `Template` (Task 3)
- Produces: `isUnlocked(t: Template): boolean`, `canExport(t: Template, quality: 2 | 4): { ok: boolean; reason?: string }`

- [ ] **Step 1: Write the failing test**

`tests/unit/entitlements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isUnlocked, canExport } from '../../src/entitlements'
import { TEMPLATES } from '../../src/core/templates'

const premium = TEMPLATES.find((t) => t.premium)!
const free = TEMPLATES.find((t) => !t.premium)!

describe('entitlements — v1 ships nothing gated', () => {
  it('unlocks premium templates in v1', () => {
    expect(isUnlocked(premium)).toBe(true)
  })

  it('unlocks free templates', () => {
    expect(isUnlocked(free)).toBe(true)
  })

  it('permits any export in v1', () => {
    expect(canExport(premium, 4).ok).toBe(true)
    expect(canExport(free, 2).ok).toBe(true)
  })
})
```

These tests assert the *absence* of gating. When payments land, they are the tests that must be rewritten — and that is the point.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/entitlements.test.ts`
Expected: FAIL — cannot resolve `../../src/entitlements`.

- [ ] **Step 3: Implement `src/entitlements.ts`**

```ts
import type { Template } from './core/types'

/**
 * The entire monetization surface. Spec §10: v1 ships nothing gated.
 * When payments arrive, only this file and its call sites change —
 * no other part of the app learns what money is.
 */
export function isUnlocked(_template: Template): boolean {
  return true
}

export function canExport(
  _template: Template,
  _quality: 2 | 4,
): { ok: boolean; reason?: string } {
  return { ok: true }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run tests/unit/entitlements.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the seam into the export path**

In `src/main.ts`, inside the save handler, before calling `exportPng`:

```ts
const verdict = canExport(state.template, 2)
if (!verdict.ok) {
  toast(verdict.reason ?? '需要解锁')
  return
}
```

One call site. That is the design.

- [ ] **Step 6: Add the premium plaque to the dock**

In `index.html`, after the rail:

```html
<div class="plaque-row" id="plaque" hidden></div>
```

In `src/main.ts`'s `pick()`:

```ts
const plaque = document.getElementById('plaque')
if (plaque) {
  const show = Boolean(t.premium) && !isUnlocked(t)
  plaque.hidden = !show
  plaque.textContent = show ? `${t.name} · 铜角装裱` : ''
}
```

With `isUnlocked` always `true` in v1, the plaque never shows. It is wired and tested, not merely described.

- [ ] **Step 7: Run everything and commit**

```bash
npm run build && npm run test && npm run test:pixel
git add -A
git commit -m "feat: entitlement seam — one boolean, two functions, one call site"
```

---

### Task 18: Dev affordances and README

Preserves the prototype's genuinely useful debug hooks and documents how to run the thing.

**Files:**
- Modify: `src/main.ts` (`?demo=1`)
- Create: `README.md`

**Interfaces:**
- Consumes: everything
- Produces: `?dev=1`, `?demo=1`, `?tpl=<id>`; a README

- [ ] **Step 1: Add the demo photo affordance**

In `src/main.ts`, after `draw()` is defined:

```ts
if (new URLSearchParams(location.search).get('demo') === '1') {
  const d = document.createElement('canvas')
  d.width = 1400
  d.height = 1050
  const c = d.getContext('2d')
  if (c) {
    const g = c.createLinearGradient(0, 0, 1400, 1050)
    g.addColorStop(0, '#c9531f')
    g.addColorStop(0.45, '#e8a13c')
    g.addColorStop(1, '#4a6b3a')
    c.fillStyle = g
    c.fillRect(0, 0, 1400, 1050)
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(${(200 + Math.random() * 55) | 0},${(120 + Math.random() * 80) | 0},${(40 + Math.random() * 60) | 0},.5)`
      c.beginPath()
      c.arc(Math.random() * 1400, Math.random() * 600, 8 + Math.random() * 40, 0, 7)
      c.fill()
    }
  }
  const im = new Image()
  im.onload = () => {
    state.photo = { el: im, width: im.naturalWidth, height: im.naturalHeight, name: 'demo', exif: null }
    state.exif = null
    draw()
  }
  im.src = d.toDataURL()

  const tplId = new URLSearchParams(location.search).get('tpl')
  if (tplId && getTemplate(tplId)) pick(tplId)
}
```

- [ ] **Step 2: Write `README.md`**

````markdown
# 模糊画框 / Frame & Mat

Turn a good photograph into a framed poster worth posting. Drop in a photo;
the app puts a white mat, a shadow, a background treatment, and a camera spec
plate around it, and exports a PNG at social-ready resolution.

Photos never leave the device. There is no backend.

## Develop

```bash
npm install
npx playwright install chromium
npm run dev
```

## Verify

```bash
npm run test        # unit — pure functions, fast
npm run test:pixel  # browser — canvas and pixel invariants
npm run build       # typecheck + production bundle
```

## Deploy

The build is static. `npm run build` and serve `dist/` from any host.
It must be served over HTTP — ES modules do not load from `file://`.

## Dev affordances

| Query | Effect |
|---|---|
| `?dev=1` | Exposes `window.__frame` for tests and console poking |
| `?demo=1` | Loads a procedurally generated photo, no upload needed |
| `?demo=1&tpl=spec-sheet` | Demo photo with a named template |

## Layout

`src/core/` is framework-free and **never imports from `src/ui/`**. That
boundary is what keeps the canvas math testable, and it is the one
architectural rule in this codebase.

## Pixel snapshots

`tests/pixel/__screenshots__/` holds one golden per template per theme.
Re-baseline with `npx playwright test --update-snapshots` **only** when a
template is intentionally changed — never to make a red test go green.

## Not built yet

Adjustments (crop, straighten, tone looks) and collage layouts are
specified but deliberately unbuilt — see
`docs/superpowers/specs/2026-10-07-photo-frame-app-design.md` §4 and §12.
Payments are a seam only: see `src/entitlements.ts`.
````

- [ ] **Step 3: Verify the affordances by hand**

```bash
npm run dev
```
Open `/?demo=1&tpl=spec-sheet`. Expected: the demo landscape renders framed by the 样张 template. Open `/?dev=1` and confirm `window.__frame` exists in the console.

- [ ] **Step 4: Full suite**

```bash
npm run build && npm run test && npm run test:pixel
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: readme and the demo/dev query affordances"
```

---

## Definition of done

- `npm run build && npm run test && npm run test:pixel` all pass.
- `?demo=1&tpl=spec-sheet` renders a framed poster in the browser.
- Dropping a real phone photo produces a framed poster with a spec plate reading its EXIF.
- Dropping a metadata-stripped photo renders identically minus the plate, with no error.
- Toggling the OS between light and dark repaints every surface, and `--mat` stays `#FFFFFF` in both.
- `git log --oneline` shows one commit per task.
