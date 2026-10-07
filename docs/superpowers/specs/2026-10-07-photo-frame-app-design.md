# 模糊画框 / Frame & Mat — Product & Design Spec

**Date:** 2026-10-07
**Status:** Design approved, ready for implementation planning
**Supersedes:** the single-file prototype at `index.html`

---

## 1. What this is

A web app that turns a good photograph into a framed poster worth posting. The user drops in a photo, the app puts a white mat, a shadow, a background treatment, and a camera spec plate around it, and they export a PNG at social-ready resolution.

The existing `index.html` proves the compositing works. It fails as a product for one reason: it exposes eleven always-visible sliders and asks the user to do the design work. This spec replaces that with curated templates.

## 2. Who it's for

Chinese-speaking phone-photography enthusiasts who post to 小红书, 朋友圈, and Instagram. They already took a good photo. They want it to look *curated* rather than *shot*, and they will not open Lightroom to get there.

**The job:** "I have a photo I'm proud of. Make it look like it deserves to be posted, in under a minute, without me having to understand design."

## 3. The bet

**Curated taste, minimal controls.** The app's value is its design judgment, expressed as a small set of beautiful templates. The default experience is zero decisions: photo in, framed result out. Fine-tuning exists, but it is opt-in and scoped to serving the frame — never a general-purpose editor.

This is a deliberate rejection of the prototype's premise. If the templates are not good enough to use unmodified, the product has no reason to exist.

## 4. Scope

### In v1

| Capability | Why |
|---|---|
| Curated template set (single-photo) | The product itself |
| **EXIF camera caption** | Auto-reads camera body, focal length, aperture, shutter, ISO and renders a spec plate. Zero typing, and generic frame apps don't do it. The differentiator. |
| **Multi-photo / collage layouts** | 2-up and grid posters. Popular for social; a template `layout` variant, not a second engine. |
| **Photo adjustments** | Crop, straighten, and four one-tap tone looks. Scoped to serving the frame. |
| Frame-first IA | Photo lands → framed result instantly. Adjustments one tap away. |
| Light + dark themes | See §6. A requirement, not a nice-to-have. |
| Custom templates (local) | Snapshot current settings, save to localStorage. Carried over from the prototype. |
| PNG export at 2× | Carried over, including the iOS long-press save sheet. |

### Out of v1

| Excluded | Reason |
|---|---|
| Batch export | The strongest premium hook and the feature most likely to be built and never used by a casual poster. Deferred, marked premium in the data model. |

### Build sequence

The v1 scope is one app, but it is not one sitting. The natural order, each stage independently shippable:

1. **Skeleton and themes** — Vite/TS setup, token system, light/dark, static shell. No rendering yet.
2. **Core renderer, single-photo** — `render()` at parity with the prototype: background, mat, frame, text, export. Replaces `index.html`.
3. **Template data model** — migrate the prototype's eight layouts into `Template` records; add schema validation and the pixel snapshot suite.
4. **EXIF plate** — `exif.ts`, `plate.ts`, and the 样张 template. The differentiator lands here.
5. **Adjustments** — crop, straighten, the four tone looks, behind the 调整 panel.
6. **Collage** — `layout` variants and the slot solver.

Stages 1–4 constitute a complete, shippable product. Stages 5 and 6 are the ones §12 exists to justify — if the adjust-panel open rate is near zero, they were scope we should not have taken.
| Accounts, sync, payments | Seams only. See §10. |
| A general editor (curves, HSL, exposure) | Turns the product into a Lightroom competitor and destroys the value proposition. |
| Server-side rendering | Photos never leave the device. See §5. |

## 5. Architecture

**Static-first.** Vite + TypeScript. No backend. Deploy to any static host.

Three reasons, in priority order:

1. **Photos never leave the device.** Marketable as a privacy property for a photo app, costs nothing to run, and keeps user photographs entirely outside PIPL exposure.
2. **Zero operating cost.** No server, no database, no upload bandwidth.
3. **Offline-capable.** A service worker and PWA installable layer are a natural later addition, not a rewrite.

Honest cost: there is a build toolchain, and client-side entitlement is bypassable by anyone who opens devtools. §10 accepts this deliberately.

### The spine

```
render(template, photos[], adjustments[]) → canvas
```

Everything is one pure function. Templates are **data**, not code. This single decision:
- makes templates authorable without touching the renderer,
- reduces premium to one boolean and one gate,
- makes the renderer testable by pixel snapshot.

### Module structure

```
src/
  core/                    framework-free, pure, no DOM
    render.ts              the spine
    geometry.ts            frame box, cover-crop, collage slot solver
    mat.ts                 mat + bevel + shadow
    text.ts                slots, auto-fit, stroke
    plate.ts               EXIF spec-bar layout
    exif.ts                minimal reader, zero deps
    tones.ts               the one-tap looks
    templates.ts           built-in template data + schema validation
  ui/                      the only code that touches DOM or CSS
    app.ts                 wires state → core
    state.ts               one state object + subscribe
    controls.ts
    theme.ts               light/dark token switching
  entitlements.ts          isUnlocked(id) → boolean
  export.ts                encode, download, iOS sheet
```

**Enforceable boundary: `core/` never imports from `ui/`.** Core is pure, so it runs under test without a browser. This is the boundary that keeps canvas math honest as the template count grows.

## 6. Design direction — 装裱 (mounting)

Full visual reference: `design/style-direction.html`.

The app is built from the same material logic as the mats it produces. Where the brief left an axis free, the choice is derived from the subject matter rather than from a UI convention.

### Palette

Six named values. These are the conceptual palette; the implementation derives further functional tokens from them (`--surface` for chrome panels, `--action-bg`/`--action-fg` for inverted surfaces, `--wall-hi`/`--wall-lo` for the gallery-lighting gradient), but every one traces back to a row of this table.

The wall is *darker* than the mat — a mat reads white because of what is behind it.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--wall` | `#E9E8E3` | `#191815` | App background |
| `--mat` | `#FFFFFF` | `#FFFFFF` | **The artifact. Never changes.** |
| `--bevel` | `#D6D4CD` | `#3A3833` | Every hairline |
| `--ink` | `#1C1B18` | `#EDEBE5` | Text, actions, filled track |
| `--quiet` | `#7A776E` | `#8B877C` | Secondary text |
| `--brass` | `#8A6A2F` | `#BE9A4A` | **Premium only** |

### The two rules that matter

**The UI is achromatic.** There is no accent color. Buttons are ink, state is a line, and the only color on screen comes from the user's photograph. A photo tool's most valuable property is that the photo is the most saturated thing in it.

**`--mat` is the exported artifact, `--surface` is chrome.** These are separate tokens. The white card on screen is a preview of a real file; dimming it in dark mode would show the user something they will not receive. Only the wall, chrome surfaces, and hairlines follow the theme.

### Dark mode rules

1. **The mat does not move.** It is the output, not the interface. A white mat on a dark wall is what a framed photo looks like in a dim room.
2. **Elevation stops being shadow.** Shadows are invisible on dark, so panels lift by being lighter than the wall (`#211F1C` on `#191815`).
3. **Hairlines flip polarity.** Darker-than-surface in light, lighter-than-surface in dark. Same 1px, inverted — otherwise the entire structural system disappears.
4. **Brass brightens** to stay legible. Still brass, not gold; a premium marker must not become decoration.
5. **Thumbnails are chrome.** Only the centre artwork is a true mat. Six white rectangles orbiting one white rectangle would flatten the hierarchy.
6. **The primary action steps back.** In light it is a filled ink block; in dark a full-white block would compete with the mat, so it uses `--action-bg` (`#C9C5BB`) instead.

### Type

Two families, corresponding to the two languages this product speaks:

- **Newsreader** (serif) — the museum wall label. The app's voice, headings, wordmark.
- **IBM Plex Mono / Sans** — the camera readout. Spec plates, values, control labels.

CJK rides the system stack (PingFang SC). Latin and numerals carry the personality. This avoids shipping a multi-megabyte Chinese webfont.

**Both faces must be self-hosted, not loaded from Google Fonts.** Google Fonts is unreliable from mainland China, and a blocked stylesheet would silently drop the entire interface into fallback — the design's personality lives almost entirely in these two faces.

Deliberately avoided: all-caps tracked eyebrows, `·`-joined meta strings, numbered section markers, a monospace face used for generic UI labels. The EXIF plate uses photographic convention, but the plate is *content*, not chrome.

### The bevel

A mat is cut at 45°, and the cut exposes a slightly darker core. That hairline — inset 5px, 1px, `--bevel` — is the structural motif: panel edges, selection state, thumbnails, slider tracks. The primary button chamfers two opposite corners at 7px. **State is expressed by whether the line is present, not by colour**, which is what allows the UI to stay colourless.

## 7. Data model

### Template

```ts
type Template = {
  id: string
  name: string                    // 样张
  premium?: boolean
  layout:
    | { kind: 'single' }
    | { kind: 'split', gap: number, direction: 'row' | 'column' }
    | { kind: 'grid', cols: number, rows: number, gap: number }
  canvas:     { ratio: '4:5' | '1:1' | '3:2' | '16:9' | '9:16' | 'orig' }
  background: { mode: 'blur' | 'solid' | 'none', zoom?: number, blur?: number, darken?: number, color?: string }
  frame:      { scale: number, radius: number, mat: number, matBottom: number, shadow: number }
  text?:      { slots: TextSlot[], anchor: 'top' | 'bottom' | 'center' | 'mat' }
  plate?:     { enabled: boolean, fields: PlateField[], color: string, align: 'center' | 'left' }
}
```

Collage is a `layout` variant. The EXIF plate is a first-class template feature, not an add-on.

### Adjustments

```ts
type Adjustments = {
  crop:       { x: number, y: number, zoom: number }   // per photo slot
  straighten: number                                    // degrees
  tone:       'clean' | 'film' | 'warm' | 'bw' | null
}
```

**Tone is a named look, not a slider bank.** This is what preserves the minimal-controls promise while still delivering the four looks shown in the design. Each look is a small data definition, authorable exactly like a template.

## 8. Behaviour

### Frame-first

A photo dropped onto the wall renders a framed result immediately, with no interaction. The default state exposes exactly two actions: 调整 and 保存.

The adjust panel is opt-in and contains only what serves the frame: which part of the photo fills the frame (crop), a tilted horizon (straighten), and the four tone looks. No curves panel exists.

### Export as ceremony

Export is not a toast. The chrome recedes, the finished poster remains alone on the wall, and its dimensions are stated beneath it. iOS routes through a `toDataURL` sheet for long-press saving; everything else uses a `toBlob` download named with dimensions and timestamp.

### Carried over from the prototype

The `?demo=1`, `?selftest=1`, `?debug=1`, and `?pixcheck=1` query affordances proved genuinely useful. `?pixcheck=1` — which reads exported pixels back to verify the mat/frame boundary — is a hand-rolled ancestor of the pixel snapshot suite in §11 and should be preserved as a dev tool.

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| Photo has no EXIF | Plate hides itself; template still renders. Never an error. |
| HEIC on a browser that cannot decode | Explicit message naming the reason. Never a blank canvas. |
| Very large image (>12 MP) | Preview renders from a ~4 MP downscale; full resolution is used only at export. |
| Export OOM / canvas limit | Catch, retry at lower scale, tell the user what happened. |
| localStorage unavailable or full | Custom templates degrade to session-only, with a notice. |
| Opened over `file://` | ES modules will not load. Requires a static server; documented. |

**HEIC is the highest-risk item in this document.** iPhones shoot HEIC and desktop Chrome cannot decode it, but every iOS browser is WebKit and WebKit can — so iPhone-first means no server is required. This must be tested on real devices and must fail legibly. This is the detail that quietly kills mobile photo apps.

**EXIF is frequently already gone.** 小红书 and 微信 strip metadata on upload, but the original in the camera roll retains it. The plate therefore works from the photo library and never from a re-downloaded image.

## 10. Monetization — seams only

The hypothesis: the free tier gets **every template and 2× export** — which is exactly what v1 ships. Premium unlocks **4× export**, premium template packs, and batch export.

**Nothing ships gated in v1.** What ships is the seam:

```ts
Template.premium?: boolean
entitlements.isUnlocked(id)  → always true in v1
canExport(template, quality) → always true in v1
```

Plus the locked-state UI already designed: a brass corner on the thumbnail and a plaque naming the pack.

That is the entire footprint. One boolean, two functions, one call site. When payments arrive, only those change — no other part of the app learns what money is.

**Accepted trade-off:** client-side entitlement is bypassable. Accepting this keeps the app static and serverless. If piracy becomes material, the fix is a server-checked entitlement at export, which is an additive change to `entitlements.ts` alone.

## 11. Testing

Three layers, matched to what can actually break.

**Unit (node, fast).** Geometry, cover-crop, collage slot solver, EXIF parser against real fixture files, template schema validation, the entitlement gate.

**Pixel snapshots (headless Chromium via Playwright).** Every built-in template × light and dark, rendered against a fixture set, diffed against committed PNGs. The fixture set is the project's `sample/` macro (hard fur edges catch antialiasing seams that a smooth photo would hide) plus a handful of EXIF-bearing and EXIF-stripped JPEGs. This is the layer that catches the bugs this product actually has: a hairline seam at the mat edge, text overflowing its band, the bevel vanishing on dark. Unit tests cannot see any of those. Must be a real browser, not `node-canvas`, because text metrics differ.

**Manual device matrix.** iOS Safari (HEIC), 微信内置浏览器, Android Chrome. A documented checklist, because none of it automates cheaply.

**Known cost:** the snapshot suite holds committed PNGs that go stale whenever a template is intentionally changed, and re-baselining is real work. Accepted as the price of testing a visual product.

## 12. Success metrics

Because there is no backend, measurement requires a third-party analytics script (Umami or Plausible, self-hostable and cookie-free). No photo content is ever transmitted.

| Metric | What it tells us |
|---|---|
| **Photo loaded → export completed** | The core funnel. If this is low, the templates are not good enough. |
| **Adjust-panel open rate** | Directly tests the frame-first bet. If nobody opens it, the adjustments were wasted scope and should be cut. |
| **Template concentration** | If 80% of exports use 2 of 12 templates, the curated set should shrink. |
| **Repeat use within 7 days** | Whether this is a tool or a habit. |

The second one is the most important. It is a falsifiable test of the product's central assumption, and it is cheap to instrument.

## 13. Open questions

1. **Product name.** 留白 appears in the design mockups as a proposal. It is the Chinese painting principle of deliberate empty space, which is precisely what a mat does, and the target audience would recognise it as a mark of taste. **This has not been approved and is a rename of the existing project.** Until decided, the working title remains 模糊画框.
2. **Tone look count.** Four looks (`clean`, `film`, `warm`, `bw`) are designed but not validated. This is a data-only change to extend.
3. **Analytics provider.** Self-hosted Umami versus a hosted service. Affects nothing structurally; needed before launch to satisfy §12.

## 14. Out of scope, explicitly

Print fulfilment. Social platform direct-posting integrations. Any server-side processing of user photographs. Video. RAW decoding.
