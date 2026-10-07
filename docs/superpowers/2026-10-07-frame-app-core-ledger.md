# SDD ledger — plan: docs/superpowers/plans/2026-10-07-frame-app-core.md

Spec: docs/superpowers/specs/2026-10-07-photo-frame-app-design.md (present, read)
Branch: feat/core-renderer
Base: f45f6eb

## Workspace ruling

Plan calls for an isolated workspace via superpowers:using-git-worktrees. This
harness discourages creating worktrees without an explicit user request, so
isolation here is a feature branch (feat/core-renderer) off main instead.

Ruling: branch, not worktree — no user request for a worktree, and a branch
gives the same isolation from main — costs nothing if wrong, since a branch
converts to a worktree trivially.

## Pre-flight conflict scan

### Task pairs sharing a file or an interface

| Pair | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | index.html, stylesheet links | clean |
| T1 → T12 | main.ts rewritten wholesale | **CONFLICT** — T1's smoke test asserts `#app` reads 'ready'; T12 deletes the line that fills it. Fixed: T12 now retires smoke.spec.ts. |
| T3 → T4,5,6,7,8,9,10,11,12,13,15,16,17 | types.ts | clean |
| T3 → T5 | `cover()` | clean |
| T3 → T7 | `resolveSize`/`fitRect`/`matRect`/`cover`/`aspectOf` | clean |
| T3 → T12 | `matRect` | clean |
| T3 → T16 | `matRect` | clean |
| T4 → T7 | `drawMat`, `roundedRect` | clean |
| T5 → T7 | `drawBackground` | clean |
| T6 → T7 | `drawText`, `measureToFit`, `frameFont` | clean |
| T6 → T12 | `drawText` gains a `matBottom` param | Expected — T12 replaces the function in full and updates both call sites in the same task. |
| T7 → T9 | `render` via `renderToCanvas` | clean |
| T7 → T16 | render body gains the plate call | **CONFLICT** — T7's import list referenced `./plate`, which does not exist until T16; T7 would not compile. Fixed: import removed from T7; T16 adds it. |
| T8 → T12 | `decodePhoto`, `wireInput` | clean |
| T8 → T15 | `readExif` injected as a param | Expected — T12 wires a stub that T15 replaces with the real parser. Stated in both tasks. |
| T9 → T12 | `exportPng`, `isIOS`, `showCeremony`, `blobToDataUrl` | clean |
| T9 → T12 | `window.__frameCeremony` | **CONFLICT** — T9's ceremony test reads it, but the dev API that defines it is written in T12. T9's test could not pass. Fixed: T9 now creates the handle itself; T12 folds it in. |
| T10 → T12,13,17,18 | `AppState`, `toast` | clean |
| T11 → T12,13,17 | `TEMPLATES`, `getTemplate`, `validateTemplate` | clean |
| T12 → T13,17,18 | main.ts handlers | clean |
| T12 → T14 | `window.__frameTemplates` | clean (T14 runs after T12) |
| T15 → T16 | `Exif` type, render's `exif` param | clean |
| T16 → T14 | plate now draws for `spec-sheet` | Expected — T14 captures goldens before T16 adds the plate, so T16 must re-baseline. T16 Step 6 already says to verify before updating; carried as a note. |

### Per-task self-consistency

| Task | Files it creates vs files it touches | Tests vs code | Finding |
|---|---|---|---|
| T1 | consistent | consistent | clean |
| T2 | consistent (tokens.css, app.css, theme.ts) | `--mat` invariant test is the point | clean |
| T3 | consistent | 15 unit tests, RF-1 pinned | clean |
| T4 | consistent | mat.spec drives `__frameCore`, created in T4 | clean |
| T5 | consistent | needs `public/sample/sample.webp`, copied in T5 | clean |
| T6 | consistent | 'mat' anchor explicitly deferred to T12 | clean |
| T7 | consistent | RF-5 label was missing from T9's test | **fixed** in self-review |
| T8 | consistent | imports `classifyFile`, `needsDownscale`, `previewScale` | **fixed** in self-review |
| T9 | consistent | `__frameCeremony` | **fixed** above |
| T10 | consistent | shell.spec asserts no adjustments control exists | clean |
| T11 | consistent | asserts 9 ids, exactly 1 premium (`spec-sheet`) | clean |
| T12 | consistent | mat-anchor.spec drives `matRect`; T12 exposes it | clean |
| T13 | claimed rail.ts, no step touched it | consistent | **fixed** — now index.html + main.ts |
| T14 | consistent | 9 template ids match T11 | clean |
| T15 | consistent | fixtures created in T15 Step 1 | clean |
| T16 | consistent | `plateFields`/`drawPlate` exposed in T16 Step 5 | **fixed** in self-review |
| T17 | claimed rail.ts, no step touched it | consistent | **fixed** — now index.html + main.ts |
| T18 | consistent | demo block + README | clean |

### Scan rulings

Ruling: T7's `drawPlate` import removed rather than pulling plate.ts forward —
the plan already had `void exif // the plate arrives in Task 16`, so the import
was my error, not a design choice — costs nothing; a forward import would have
broken T7's compile, which is strictly worse.

Ruling: T9 creates its own `__frameCeremony` rather than moving T12's dev API
earlier — T9's test needs the handle, T12 consolidates it; duplicating one line
is cheaper than reordering the dev API ahead of the renderer — costs one
duplicated line, removed in T12.

Ruling: T12 retires `tests/pixel/smoke.spec.ts` rather than rewriting it to
assert something else — the smoke test's subject (the scaffold placeholder) is
deleted by T12, and inventing a new subject for it would be a test written to
stay green — costs the loss of one trivial assertion, which the other 40-odd
tests more than cover.

Rulings are provisional where the plan and spec disagree; both were present and
read, so these are final.

## Progress

Task 1: dispatched (base 273a739, model sonnet). Report: DONE_WITH_CONCERNS.
Task 1: concern raised by implementer — `playwright.config.ts` uses `process.env` with no node types, and Tasks 14/15 import `node:fs` from within tsconfig's `include`. Real forward dependency, so addressed pre-review rather than deferred.
Ruling: fix `@types/node` now in Task 1, which owns `package.json` and `tsconfig.json` — the fix is two lines and unblocks Tasks 14 and 15, both of which import `node:fs` under an `include` that covers `tests/` — costs nothing; deferring it would fail those tasks for a reason unrelated to their work. (commit e8f14b4)
Task 1: review (model sonnet) — Spec ✅ compliant, quality Approved. 1 Important (plan-mandated), 5 Minor.
Ruling: the Important finding was plan-mandated but real — `tsconfig.json`'s include excluded both config files, so neither the sanctioned `vitest/config` deviation nor the `@types/node` fix was covered by any repo command. Accepted rather than dismissed-on-precedent; the plan's authorship does not grade its own work. (commit 2f70898)
Ruling: rolled the `reuseExistingServer` Minor into the same fix dispatch rather than deferring it. It is Minor by the reviewer's calibration, but it silently invalidates the pixel snapshot suite Task 14 builds — a stale preview server means the goldens validate output that is not the current build. Cost is a few seconds per local run; the cost of being wrong is an entire verification mechanism that passes while proving nothing.
Task 1: fix round 1/5 (2 addressed, 0 open — tsconfig include excludes config files; reuseExistingServer can silently test a stale build; commits e8f14b4..2f70898)
Task 1: fix verified by re-review (model haiku) — both ADDRESSED, no new breakage. Re-reviewer independently reproduced the probe (`vite.config.ts(3,7): error TS2322`, verbatim column match) and confirmed against Playwright's own source that `reuseExistingServer` skips `launchProcess` before the build runs.
Task 1: complete (commits 273a739..2f70898, review clean)

Task 1: minor (deferred): `tsconfig.json` lists two explicit config filenames rather than a glob — a config file added later is outside the typecheck gate by default.
Task 1: minor (deferred): `"types": ["vite/client", "node"]` exposes Node globals to browser code under `src/`; a `process.env` reference in `src/core/` would now typecheck and then fail in the browser.
Task 1: minor (deferred): `@types/node@^26.6.4` types a newer Node than the installed runtime (v24.19.0); `^24` would match reality.
Task 1: minor (deferred): `index.html:6` hard-codes `theme-color: #E9E8E3`, so dark-mode browser chrome mismatches. **Carried into Task 2's dispatch** — Task 2 owns themes.
Task 1: minor (deferred): the 861-line prototype that `index.html` replaced now exists only in git history (`git show 273a739:index.html`). Its `?pixcheck=1` self-check is prior art for Task 14's pixel invariants. **Carried into Task 14's dispatch.**
Task 1: minor (deferred): `tests/unit/smoke.test.ts` asserts `1 + 1 === 2`; retired by Task 12 along with its pixel counterpart.

Task 2: dispatched (base 2f70898, model sonnet). Report: DONE. Review (model sonnet): Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 6 Minor.
Task 2: complete (commits 2f70898..72a00cb, review clean)

Ruling: accepted the implementer's font evidence rather than re-running it. The reviewer flagged the woff2 binaries as unverifiable from the diff and offered that the controller could re-run the check. The evidence is specific and falsifiable — `wOF2` magic bytes, six faces reporting `loaded` in-browser, and per-weight ink coverage differing (sans 400 = 6286px vs 600 = 8872px) — which is stronger than the diff could have shown anyway. Costs nothing if wrong; a falsely-passing font check would show up as a visible interface collapse the moment anyone opens the app.

Task 2: minor (deferred, CARRIED INTO TASK 10): **first-paint light flash.** Theme is applied from deferred module execution, so a dark-preference user gets a light first paint, and `app.css`'s `.25s ease` background transition turns the correction into a visible fade. Inherent to the brief's Step 8 design, not this implementation's fault. Remedy is a render-blocking inline script in `<head>` before the stylesheet. This matters more here than in most apps: dark mode is a headline feature of this product and the wall colour is the design's whole material metaphor.
Task 2: minor (deferred): `plex-sans-400.woff2` and `plex-sans-600.woff2` are byte-identical — Google served one variable file for both weights, so ~40KB of the sans payload is redundant on every first visit. Collapsing to a single face with `font-weight: 400 600` at one `src` fixes it. Bandwidth only; rendering verified correct.
Task 2: minor (deferred, CARRIED INTO TASK 14): no committed test covers font delivery. If a woff2 were lost, renamed, or not copied by the build, every existing test would stay green while the whole interface dropped to system fallback — precisely the failure the self-hosting constraint exists to prevent. The verification that proved it works today was an ad-hoc script that was deleted.
Task 2: minor (deferred): `initTheme` registers a `matchMedia` change listener unguarded (`theme.ts:53`) while its own helper `systemPrefersDark` guards the same call (`:46-48`). Nothing trips it under the `node` test environment, but the first jsdom-environment unit test that calls `initTheme()` will throw. One-line symmetry fix.
Task 2: minor (deferred): `setTheme`'s localStorage write and the live `matchMedia` change listener are untested. Behaviour reads correct — `initTheme` deliberately does not persist, which is what makes "follow the system until the user chooses" hold — but it is unverified.
Task 2: minor (deferred, informational): the brief's prose asked for IBM Plex Sans 500 while its own `@font-face` block declared only 400 and 600. The implementer correctly followed the block. The reviewer chased this to ground — no consumer anywhere in the design or plan requests sans 500 — so this is a brief-copying artifact with no rendering impact.

Task 3: dispatched (base 72a00cb, model sonnet). Report: DONE_WITH_CONCERNS.
Task 3: concern raised — the plan's `[RF-1]` test could not fail. `fitRect` returns a rect whose aspect equals the aspect handed to it, and `cover` then receives a source of that same aspect, so margins were exactly zero for arithmetic reasons that cannot go wrong; swapping the canvas ratio changed nothing.
Ruling: addressed pre-review rather than deferred to the reviewer. Review Focus item 1 is the plan's stated guard for "a 3:1 panorama must never letterbox", and a guard that cannot fail is worse than no guard — it converts an unverified property into an apparently-verified one. Replaced with a mixed-aspect property test. (commit 770db20)
Task 3: fix round 1/5 (1 addressed, 0 open — RF-1 test was inert; commits 1ab45ea..770db20)
Task 3: review (model sonnet) — Spec ✅ compliant, quality Approved. types.ts verified 16/16 declarations against the brief, no renames or additions. `geometry.ts` byte-identical with the temporary `Math.max`→`Math.min` break fully reverted. 1 Important (plan-mandated), 5 Minor.
Ruling: **the Important finding stands as written — no change.** It is real: `types.ts` references `HTMLImageElement` and `CanvasRenderingContext2D`, which are DOM types living in `src/core/`. I am not keeping it because the plan mandates it; the plan's authorship does not settle the question. I am keeping it on the merits: (a) these are type-only references, erased at compile time, so they contribute zero runtime footprint and `src/core/` remains genuinely runnable under node for everything that can be node-tested — which is the stated purpose of the boundary; (b) `render()`'s entire job is to draw to a canvas, so a canvas-free interface would model a fiction, and hand-rolling a structural `Ctx2D` would duplicate a large slice of the Canvas2D API with a real risk of drifting from the thing it imitates; (c) changing `Photo` and `RenderInput` now breaks the very contract this task exists to establish, across fourteen downstream tasks already written against these names. Costs if wrong: a weaker purity boundary than the spec's wording implies, surfaced to the final review rather than fixed silently. (commit: none)
Task 3: complete (commits 72a00cb..770db20, review clean)

Task 3: minor (deferred): `tests/unit/geometry.test.ts:84` declares a second `import { aspectOf }` mid-file. Legal and hoisted, no linter in the repo, but a needless oddity — merge into the top import.
Task 3: minor (deferred): the retained panorama case's two coverage assertions are arithmetic identities and cannot fail. Disclosed by the implementer; the block is still falsifiable via its distortion assertion. Keep it as the named scenario, but do not count it as coverage.
Task 3: minor (deferred): the zoom describe block goes slightly beyond the sanctioned replacement (one block ordered, two delivered). Falsifiable in both directions and it records a real contract boundary — `zoom >= 1` is required for coverage, and every built-in template sets 118–148.
Task 3: minor (deferred, CARRIED INTO TASK 8): `cover` and `aspectOf` have no zero-dimension guard, so a failed decode presenting width 0 propagates `Infinity` geometry rather than failing cleanly. Task 8 owns input validation and is where an undecodable file is caught.
Task 3: minor (deferred, informational): `aspectOf` is exported and tested but absent from the brief's "Produces" interface list. Correct as built; noted so a downstream task reading only the interface list knows it exists.

Task 4: dispatched (base 770db20, model sonnet). Report: DONE.
Task 4: review (model sonnet) — Spec ✅ compliant, quality Approved. 1 Important (plan-mandated), 2 Minor.
Ruling: **shadow coverage gap — routed to Task 14, not fixed here.** The finding is real: both committed `drawMat` tests pass `shadow = 0`, so the shadow branch is dead in every committed test, and the implementer's probe was deleted before commit. I am not sending it back to Task 4 because the gap is in the *plan's* test list, not in this diff — Task 4 implemented exactly the two tests it was given, and adding a third here would have been unrequested scope. Task 14 owns "the spec's regression net" and is the right home. Carried into Task 14's dispatch as a specific required assertion. The reviewer independently re-derived the shadow alpha values from the committed code and they close (120/94/42/14 predicted 123/95.5/40.5/13.6), so the branch is correct as built; what is missing is the guard, not the behaviour.
Task 4: complete (commits 770db20..f2347fb, review clean)

Task 4: minor (deferred, CARRIED INTO TASK 14): the bevel assertion compares `(105,200)` against `(102,200)`, which pins `BEVEL_INSET` to roughly ±1px rather than to exactly 5 — it would also pass at 6. It is not vacuous (it fails at 3 and 7) but its name claims more precision than it holds, and it is tied to Chromium's antialiasing distribution. Sampling a deep interior pixel instead of one adjacent to the edge would decouple it from AA and make a future second browser project safe.
Task 4: minor (deferred): `let probeCanvas` at `main.ts:12` is never reassigned. Plan-mandated verbatim, and no lint script exists, so nothing gates it.

Task 5: dispatched (base f2347fb, model sonnet). Report: DONE.
Task 5: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 7 Minor. 1 ⚠️ resolved below.
Ruling: **`background.mode: 'none'` keeps the plan's meaning — a flat neutral plate (`#2a3238`), not transparency.** The reviewer correctly noted the spec defines only the union and never its semantics, and asked the controller to confirm rather than assume. Confirming the plan's choice on the merits: (a) no built-in template uses `mode: 'none'`, so the cost of being wrong today is exactly zero; (b) an exported PNG with a transparent background is a surprising artifact for a poster app whose entire premise is an opaque white mat — a downstream platform that does not preserve alpha would render it black or white unpredictably, which is a worse failure than an intentional neutral; (c) `#2a3238` is the prototype's established empty-state colour, so this is continuous with prior behaviour rather than a new invention. If a future template genuinely wants transparency, that is a new mode (`'transparent'`) and not a redefinition of `none`.
Task 5: complete (commits f2347fb..7c950b5, review clean)

Task 5: minor (deferred, CARRIED INTO TASK 14): the darken test's threshold is loose. `darken: 64` yields an actual ratio of 0.36, but the assertion allows `< 0.6` — 1.67× slack, so it would not catch a wash applied at the wrong strength anywhere between 0.36 and 0.60. Not vacuous (a dropped or no-op darken gives 1.0 and fails) and its name claims only that darken lowers luminance. Tighten to `closeTo(0.36 × plain, 0)`.
Task 5: minor (deferred, CARRIED INTO TASK 14): the fallback's blur is far weaker than the filter path's — downscale-by-`div` plus smooth upscale is a few pixels of softening, where `ctx.filter = blur(B)` is a Gaussian with σ = B. The two branches will look visibly different on the legacy engine the fallback exists for. Note it for the device matrix rather than discovering it on a device.
Task 5: minor (deferred): in the fallback, `div = Math.max(4, blur / 2)` means `blur: 0` still softens — a 4× downscale/upscale where the filter path would render sharp. Plan-verbatim and correctly not "fixed" by the implementer.
Task 5: minor (deferred): `tc.imageSmoothingEnabled` is never set before the fallback's downscale. Correct only because the spec default is `true`; an explicit assignment would make the intent local rather than inherited.
Task 5: minor (deferred): `#2a3238` is hardcoded twice within seven lines and is not a design token. A module-level constant would give it one home.
Task 5: minor (deferred): `if (tc)` silently skips the draw when the offscreen context is unavailable, leaving the region transparent with no signal.
Task 5: minor (deferred, CARRIED INTO TASK 8): no guard for a degenerate 0×0 photo, which makes `cover` return `Infinity`/`NaN` into `drawImage`. Not reachable through the app because Task 8 validates, but the same class as Task 3's carried note — Task 8 owns input validation and gets both.

Task 6: dispatched (base 7c950b5, model sonnet). Report: DONE_WITH_CONCERNS.
Task 6: **plan defect found by the implementer** — the brief's first test captured a module-scope `CFG` constant inside a `page.evaluate` callback. `page.evaluate` serialises its callback, so `CFG` was absent in the page and the test died with `CFG is not defined` before reaching any assertion. It could never have passed against a correct implementation. Fixed by passing `CFG` as an evaluate argument. Audited the rest of the plan for the same pattern: Task 7 and Task 14 and Task 16 already pass their captured values as `evaluate` arguments, so this was the only instance.
Task 6: concern raised — `[RF-3]` could not detect a measure-at-one-weight/render-at-another regression, because that CJK string has identical advance widths (1088px) at every weight from 300 to 800 in Chromium.
Ruling: strengthened pre-review rather than deferred, for the same reason as Task 3's `[RF-1]`. The plan's own brief warned that measuring at one size and rendering at another is the classic way this helper breaks silently, and the test designed to catch it could not, for the fixture chosen. (commit 7622e5e)
Task 6: review (model sonnet) — Spec ✅ compliant, **Needs fixes**. 1 Important, 5 Minor.
Ruling: **accepted the Important finding and dispatched a fix.** The band assertion had 0.08px of physical margin per edge with ±1px slack as the entire tolerance, so an ordinary environment font-metric change would turn the plan's central text-overflow guard red with no code defect. I am not treating that as ordinary flakiness: an invariant that false-reds is one people learn to re-run, and a re-run test is not a guard. The prescribed remedy decomposes the assertion rather than widening slack, which would have traded a false red for a false green. (commit c97d597)
Task 6: fix round 1/5 (2 addressed, 0 open — band assertion font-metric-fragile; tests never asserted shrinking was required; commits 7622e5e..c97d597)
Task 6: fix verified by re-review (model sonnet) — both ADDRESSED, no new Critical/Important breakage. The re-reviewer confirmed the two failure modes are genuinely separable rather than one implying the other, and caught that one half of the implementer's evidence was an inference about an unexecuted line — then verified it arithmetically and found the non-degenerate independent case in the round-0 guard.
Task 6: complete (commits 7c950b5..c97d597, review clean)

Task 6: minor (deferred): the two pixel tests re-derive `allowed = W * 0.86` and `base = (size/100)*H*0.20` from the implementation's own constants, so the band is verified against itself for that dimension. A wrong-but-consistent `0.86` is invisible to every test in the file. Ruling on the accompanying ⚠️: 0.86 is intended — it is inherited verbatim from the working prototype's `maxW = W * 0.86`, and nothing in the design spec contradicts it.
Task 6: minor (deferred): the (a)+(b) decomposition widens the composed end-to-end ink bound from ±1px to ±1.5px at the band edge. Inherent to the prescribed fix and acknowledged in a comment; cannot mask a real overflow, whose failure modes are three orders of magnitude larger.
Task 6: minor (deferred): `ctx.font` assignment is the one silent-failure path in `drawText` — an unparseable font string is ignored per spec, leaving the previous font in place so `fillText` could draw at the unfitted size. Reachable only via `maxWidth <= 0` or a malformed `slot.weight` in template data.
Task 6: minor (deferred, CARRIED INTO TASK 11): under `anchor: 'top'`, only the `sub` slot receives a vertical offset, so a `sign` slot would render on the same baseline as `title` and overlap it. Latent — no template anywhere declares a `sign` slot, and the plan's only top-anchor template uses title+sub. Worth knowing when Task 11 authors the template set.
Task 6: minor (deferred): a comment in the test overstates the guarantee — a rasteriser change that grew glyph ink more than 1px past the advance box would also trip the ink assertion. Documentation, not behaviour.

Task 7: dispatched (base c97d597, model sonnet). Report: DONE_WITH_CONCERNS.
Task 7: **two plan defects found by the implementer**, both verified genuine by the reviewer.
  (a) The brief's `render` body mixed logical and device units: `drawBackground` fills `size.W*k` while `fitRect`/`matRect`/`drawMat` were fed logical coordinates, so at `k=2` the frame landed in the top-left quadrant of a 1200×1200 canvas. Compounded by `radius*k + mat*k - inset` handed to a `drawMat` that multiplies radius by `k` again → 31k² device. Fixed by scaling the layout box once (`box = size*k`) and passing `drawMat` a logical radius.
  (b) Two of the brief's three assertions could not pass against any correct render: test 1 sampled `(300,300)` expecting white while the *photograph* is drawn over the mat at that point, and test 2 asserted exact pixel equality between `k=1` and `k=2` renders of a photograph, which Chromium's resampler cannot satisfy (0.66× vs 1.32× differ by up to 8 levels).
Ruling: both deviations accepted. They are plan defects, not scope-taking — the reviewer independently re-derived the arithmetic for both and confirmed the fixes are coherent across all four `k` consumers and bit-identical to the brief at `k=1`. The reviewer also checked the specific risk I named — that the fix might hand `drawText` a device-unit frame while `drawText` treats `size` as logical — and found no factor-`k` error, because `drawText`'s internal coordinate space is device throughout.
Task 7: review (model sonnet) — Spec ✅ compliant, **Needs fixes**. 1 Important, 4 Minor.
Ruling: accepted the Important finding. The predecessor's replacement for the k=2 assertion had become near-tautological — a flat-`#FFFFFF` mat pixel reads white at both scales for any implementation that draws a mat at all — so the only guard on "an image whose content changes with k" had been silently lost. That is precisely the user-exports-something-they-never-saw failure this architecture treats as worst-case, so a weaker-but-passing test was worse than the original strict one. (commit a765e12)
Task 7: fix round 1/5 (1 addressed, 0 open — k=2 test lost its photographic-content guard; commits a52de03..a765e12)
Task 7: fix verified by re-review (model sonnet) — ADDRESSED, no new breakage. The re-reviewer reproduced all three deliberate breaks from geometry rather than narrative, confirmed the reported deltas reproduce to the last bit from the reported means, and confirmed a y-only mat defect genuinely escapes the row scan while the new column scan catches it at 133 ≠ 134.
Task 7: complete (commits c97d597..a765e12, review clean)

Task 7: minor (deferred): `render` ignores `template.layout` entirely — `split` and `grid` are declared in `types.ts` and nothing renders them. Correct for this stage (collage is spec stages 5–6), but **CARRIED INTO TASK 11**: the built-in template set must not ship `split`/`grid` templates, or they will silently render as single-photo posters.
Task 7: minor (deferred, CARRIED INTO TASK 14): the `preview` indirection is correct in code but has no committed guard — both render tests build `__photo` without a `preview`, so a regression to `photo.el` at either site would pass the whole suite. Task 14 owns the fixture set and should add a photo whose `preview` differs in colour from `el`.
Task 7: minor (deferred, CARRIED INTO TASK 12): `drawText`'s `frame` parameter is device pixels while its `size` parameter is logical, and `text.ts`'s docstring does not say so. The prescribed Task-12 expression is arithmetically correct against a device frame, but a Task-12 author who assumes `frame` shares `size`'s units and writes `(frame.y + frame.h + matBottom * 0.62) * k` lands off-canvas at `k=2` and invisibly at `k=1`. **Task 12's dispatch must pin "`frame` is device pixels".**
Task 7: minor (deferred): insideness of the k=2 sample patch rests on a comment plus a deleted probe rather than an in-test assertion; if `sample.webp` were swapped for a low-gradient image the ±2 check could go quietly vacuous rather than red.
Task 7: minor (deferred, CARRIED INTO TASK 9): no export caller exists yet, so the "export always uses full resolution" half of the preview contract is unverified. **Task 9 must pass photos with `preview` stripped** — it already does per the plan, but the dispatch should confirm it rather than assume.

Task 8: dispatched (base a765e12, model sonnet). Report: DONE_WITH_CONCERNS.
Task 8: **plan inconsistency found by the implementer** — the brief's file list named `Modify: src/main.ts` with no corresponding step. The implementer left `main.ts` untouched and asked rather than inventing work.
Ruling: the file list was over-specified; `main.ts` correctly needs no change. This task builds a module and unit-tests it in isolation, and `wireInput` is not called until Task 12. Plan corrected. (commit 4c66435)
Ruling: **Review Focus 4's browser-level half is routed to Task 12, not fixed here.** The requirement is "a legible message **with the canvas left unchanged**", and no canvas exists at this stage — `main.ts` exposes only a bare probe canvas and core render functions, and the pixel suite runs against a build that cannot import `src/ui/input.ts`. The implementer verified the messages with an ad-hoc real-Chromium probe (`文件为空`, `这不是图片文件`, the `onerror` message, 14 MP → 2138×1871 preview, 4 creates / 4 revokes) and deleted it. That evidence is specific and falsifiable, so it stands; the end-to-end assertion belongs where the assertion can exist. **Carried into Task 12.**
Task 8: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 9 Minor. The reviewer re-derived both mutation claims from the assertions as written and confirmed the `finally` ordering holds on the load, error, and early-throw paths.
Task 8: complete (commits a765e12..4c66435, review clean)

Task 8: minor (deferred, CARRIED INTO TASK 9 — highest-value minor in this task): `decodePhoto` revokes the object URL in `finally`, so `Photo.el.src` points at a dead blob URL. `el` is the full-resolution source that export draws from. A browser that discards decoded image data under memory pressure and then re-fetches from that URL would make an export-time `drawImage(el)` throw on a broken image. iOS Safari is aggressive about exactly this, and this product's whole point is full-resolution export of large photos. Not reproducible in Chromium, so it cannot be tested in CI — it belongs to the spec §11 manual device matrix. **Task 9 should verify it explicitly: load a >12 MP photo, let the device settle, then export and confirm full resolution.** `buf` is still in scope in `decodePhoto` if a re-decode source is wanted.
Task 8: minor (deferred): a real image whose `File.type` is empty is rejected as `这不是图片文件` — the one path where a HEIC degrades from a reason-naming message to a wrong one. Frequency is unverifiable here; that check belongs to the spec §11 device matrix.
Task 8: minor (deferred): the `onerror` *handler's* behaviour is testable today (give the `Image` stub a failure mode that calls `onerror`); only "real corrupt bytes reach `onerror` in a browser" needs the dev-API seam. Worth closing when Task 12 adds that seam.
Task 8: minor (deferred): the `preview` load has no dimension guard, unlike `el`, and its `onerror` resolves rather than rejects — so a broken preview would be handed over silently and `drawImage` would throw `InvalidStateError`.
Task 8: minor (deferred): neither await has a timeout; a browser that never settles leaves `decodePhoto` pending forever, so neither callback fires and the blob leaks.
Task 8: minor (deferred): the preview round-trips through `canvas.toDataURL('image/png')` — a synchronous main-thread encode of a ~4 MP canvas producing a multi-megabyte base64 string, then a second full decode. Forced by the frozen `Photo.preview?: HTMLImageElement` contract; a stall on the spec's target devices.
Task 8: minor (deferred): `file.arrayBuffer()` and `readExif(buf)` run outside the `try`, so a failed read surfaces an untranslated English `DOMException` in an otherwise Chinese UI.
Task 8: minor (deferred, CARRIED INTO TASK 12): `onPhoto(...)` sits inside the same `try` as the decode, so a throw from the renderer is reported to the user as a read failure — directly relevant to RF-4's "canvas left unchanged".
Task 8: minor (deferred, CARRIED INTO TASK 10): `drop`'s click handler calls `fileInput.click()`, which recurses if the shell nests the file input inside the drop element.

Task 9: dispatched (base 4c66435, model sonnet). Report: DONE_WITH_CONCERNS.
Task 9: **two more plan defects found by the implementer.** (a) The brief's `exportPng` does not compile: `let k = want` where `want: 2 | 4` infers the union, so the 1× fallback assignment `k = 1` is TS2322. The plan carries the same bug. The reviewer reproduced it with the repo's compiler and also found a *second* type error the implementer had not listed (the brief's return type omits `k` and `downgraded`, TS2353). (b) The ceremony test's `page.goto('/')` cannot reach a handle gated behind `?dev=1`; the plan carries that bug too. Both fixed.
Task 9: review (model sonnet) — Spec ✅ compliant, quality Approved. 3 Important (all plan-mandated), 6 Minor.
Ruling: **all three Important findings accepted and fixed.** The second is the most serious defect found in this session: `fitsCanvas` guarded canvas **edge** length while the binding constraint on iOS Safari — the first-listed supported browser — is canvas **area**, and WebKit exceeds it *silently* (drawing no-ops, `toBlob` returns blank/null rather than throwing). The advertised 4× tier passes the edge check and fails the area cap, so a paying iPhone user could receive a blank poster with no error. That is the spec's own §9 failure class, and the brief implemented the prediction without the recovery. (commit b689864)
Task 9: fix round 1/5 (3 Important + 1 Minor addressed, 0 open — edge-only canvas guard; RF-5 unasserted; revoked object URL still drawn from; invisible dock in the tab order; commits f75f2d0..b689864)
Task 9: fix verified by re-review (model sonnet) — all four ADDRESSED, no new Critical/Important breakage. Re-reviewer confirmed the retry re-renders into a fresh canvas and cannot loop, that the object-URL fix keeps the leak closed in both directions the old code covered, and that the accessibility test asserts the property rather than the CSS value.
Task 9: complete (commits 4c66435..b689864, review clean)

Ruling: **the 4× premium tier's deliverability is carried to Task 17, not resolved here.** The fix chose `MAX_CANVAS_AREA = 16_777_216` (4096²), WebKit's conservative iOS floor. The re-reviewer confirmed this admits every 2× export the app can produce with ≥2× headroom, so the shipping default is not regressed — but it also rejects 26.5 MP, which desktop Chromium and newer iPhones would accept, so `want: 4` is now downgraded on *every* platform. Shipping impact today is zero: no committed caller passes `want: 4`. But the plan's monetization hypothesis sells 4× as the premium unlock, so this must be reconciled with Task 17 before it is sold. The natural resolution is a capability probe or per-tier budget rather than a single conservative constant — and the retry mechanism this fix introduced makes that cheap. **Carried into Task 17.**

Task 9: minor (deferred): the retry keys only on `toBlob` returning `null`. A device that reports an over-budget canvas as a blank *blob* rather than null would slip past both the prediction and the retry. The recovered file is only asserted to be >1000 bytes, not asserted non-blank the way the prediction path is.
Task 9: minor (deferred): a replaced photo's object URL can in principle be revoked while an in-flight export's retry still holds that element — requires a new decode to settle during the encode. No committed call site can trip it, and it is strictly better than the pre-fix state where the live photo's URL was always dead.
Task 9: minor (deferred, CARRIED INTO TASK 10): the ceremony test stands in a fake `.dock` only while none exists; Task 10 must delete that conditional so the test asserts the real shell rather than silently recreating a fake one if the shell ever loses its dock.
Task 9: minor (deferred): `.sheet` and its 23 lines of CSS have no consumer anywhere — the ceremony subsumes it, as `export.ts`'s own comment says. Brief-mandated but dead; a candidate for deletion at the final review.
Task 9: minor (deferred): `hint` is interpolated into `innerHTML`. Today it is a developer literal, so there is no live injection, but it is the exact shape of a future one.
Task 9: minor (deferred): the poster is carried as a base64 data URL (+33% over the blob) alongside the blob and the canvas, on the platform with the tightest memory budget. `URL.createObjectURL` would be lighter; verify long-press-save still works on device before changing.

Task 10: dispatched (base b689864, model sonnet). Report: DONE_WITH_CONCERNS.
Task 10: implementer corrected two errors in the controller's own dispatch — `src/ui/toast.ts` did not exist (the plan's T10 step creates it, and the dispatch said to reuse it), and `#app` is in the brief's own body markup so keeping it was right. Both corrections accurate; the implementer reported rather than working around them.
Task 10: concern raised — an empty `#cv` renders as a default 300×150 transparent box carrying `box-shadow: var(--deep)`, so the app's default state showed a stray shadowed rectangle on the wall.
Task 10: review (model sonnet) — Spec ✅ compliant, **Needs fixes**. 1 Important (plan-mandated), 8 Minor. The reviewer confirmed the phantom rectangle is a rendering fault rather than an intentional empty state, and that Task 12 cannot fix it because drawing requires a photo the no-photo state does not have.
Task 10: fix round 1/5 (1 Important + 2 Minor addressed, 0 open — phantom undrawn canvas; first-paint guard unpinned in two places; no-adjustments guard rail too narrow; commits 386793e..647e9e5)
Task 10: fix verified by re-review (model sonnet) — all findings ADDRESSED, no new Critical/Important breakage.

Ruling: **accepted the fix agent's correction to a controller-prescribed assertion.** The reviewer and I both prescribed `toHaveCSS('color-scheme','dark')` as the guard for the head script's inline `colorScheme` line. The fix agent demonstrated that assertion can never fail: `tokens.css` declares `color-scheme: dark` under `:root[data-theme='dark']`, and the head script sets `data-theme`, so the stylesheet supplies the value whether or not the inline line exists. It kept the prescribed assertion (harmless) and added a third test that aborts the stylesheet *and* the module, leaving the inline style as the only possible source — the re-reviewer confirmed that isolation is genuine. This is the third time in this session that a test specified by the plan or by me turned out to be incapable of failing; the pattern is that verification written from intent rather than from mechanism is usually vacuous, and only deliberate mutation catches it.
Task 10: complete (commits b689864..647e9e5, review clean)

Task 10: minor (deferred, CARRIED INTO TASK 12): the `#cv` guard's safety rests on Task 12 sizing the canvas via `.width =` (the idiom used in `input.ts`, `export.ts`, `background.ts`), which reflects to the `[width]` attribute and reveals it. **If Task 12 instead sizes the on-screen canvas by CSS (`style.width`) and draws at the default 300×150 backing store, the canvas will stay hidden.** Pin the sizing idiom in Task 12's dispatch.
Task 10: minor (deferred, CARRIED INTO TASK 12): `#drop` has no keyboard affordance and `#file` is `hidden`, so keyboard-only desktop users have no path to add a photo. `wireInput` should make it focusable with Enter/Space or swap it for a `<button>`.
Task 10: minor (deferred): the head-script guard inspects only the *first* `<script>` in `<head>`; a future task inserting another head script before it would make the guard inspect the wrong tag.
Task 10: minor (deferred): the theme-color meta is not updated by the head script, so a dark first visit gets a light browser chrome bar until the deferred module runs. Fixing it in the head would duplicate two hexes and create a second drift pair.
Task 10: minor (deferred): `tests/pixel/shell.spec.ts` counts `.btn-primary` page-globally; it means "in the default state" and will break spuriously when any overlay with a primary action mounts at load.
Task 10: minor (deferred, CARRIED INTO TASK 11): `createState`'s defaults are unexercised — `state.ts` and `toast.ts` are typechecked but the build drops them, so any defect ships invisible until they are wired.
Task 10: minor (deferred): `index.html` retains an inert `#app` node referenced by nothing. Brief-mandated and harmless.

Task 11: dispatched (base 647e9e5, model sonnet). Report: DONE_WITH_CONCERNS.
Task 11: concern raised — a corruption probe found the validator admitted malformed data. Worst case verified by direct call, not inferred: `text.slots = [null]` passed `validateTemplate` and then threw `TypeError: Cannot read properties of null (reading 'id')` at `src/core/text.ts:51`. Also admitted: `NaN` frame values (`typeof NaN === 'number'`), non-numeric optional background numerics, malformed slot entries, non-boolean `premium`, and `text`/`plate` set to `null` (which threw inside the validator itself).
Ruling: hardened pre-review rather than deferred. `validateTemplate` is the gate Task 13 relies on to drop corrupted `localStorage` entries, so a validator that admits a verified renderer crash undermines that task's entire safety property — and the fix is additive and small. The fix used `Number.isFinite`, which catches `Infinity` as well as `NaN`, and closed the `text: null` hole that made the gate itself throw. (commit 34369b1)
Task 11: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 5 Minor. The reviewer mechanically diffed the nine records against the brief (109/109 lines identical, no retune), verified every enum list covers its union's members and every optional stays optional, and traced Task 13's only writer — `{...state.template, id, name, premium: false}` through `JSON.stringify` — to confirm nothing the save path can emit is now rejected. It also confirmed there is no second crash path: the values the validator still accepts degrade rather than throw.
Task 11: complete (commits 647e9e5..34369b1, review clean)

Task 11: minor (deferred): `RATIOS`/`ANCHORS`/`SLOT_IDS` are hand-maintained runtime mirrors of the `types.ts` unions, and nothing type-level forces them to track it. A typed array literal rejects a typo but silently accepts an *omission* — if `TextSlotId` ever gains a member, a type-valid saved template would fail the gate and Task 13 would delete it. This is the only residual path by which the gate could wrongly reject valid data; a compile-time exhaustiveness map closes it in three lines.
Task 11: minor (deferred): the validator's older error strings say "missing layout" when `layout` is present but malformed, and collapse absent/invalid for `canvas`. Mixed granularity now that newer checks say "text must be an object"; a restore diagnostic pointing at the wrong problem costs the developer time.
Task 11: minor (deferred): the layout-kind membership test pins only `.ok`, unlike its 19 siblings which pin the exact error string — a wrong-reason rejection would pass it.
Task 11: minor (deferred): two corruption tests index `TEMPLATES[8]` for `spec-sheet`; inserting a template before it would leave the premium test passing while no longer exercising a record that carries `premium`. `findIndex` by id is the robust form.
Task 11: minor (deferred, CARRIED INTO TASK 13): `validateTemplate` accepts a `sign` slot — correct, since `TextSlotId` declares it and rejecting it would delete valid user data — but a restored custom template with one will be drawn on `title`'s baseline by `drawText`. Task 13's restore path should know.
Task 11: minor (deferred): no test pins any template's *design values*; `frame.scale` could change 72→60 unnoticed. Correct for this task — Task 14 renders all nine in both themes as goldens — but until then the only guard on the design numbers is review against the brief.

Task 12: dispatched (base 34369b1, model sonnet). Report: DONE_WITH_CONCERNS.
Task 12: **two more plan defects found by the implementer, both verified genuine by the reviewer.**
  (a) The brief's own `mat-anchor` test could not pass against the brief's own `drawText`. The test passes six arguments, so `matBottom` defaults to `0`, the new branch's guard `matBottom > 4 * k` is false at `k=1`, and the `'mat'` anchor falls through to the canvas-bottom baseline at y=675 — outside the scanned band (516–619), so `first` is `null`. The brief's Step 5 "Expected: PASS" was unreachable.
  (b) The brief's literal `draw()` assigns `cv.width` unconditionally, which releases Task 10's `canvas#cv:not([width])` guard and fails two committed shell tests — and would repaint the phantom rectangle Task 10's review ruled a rendering fault.
Task 12: a third deviation — catching the renderer's throw inside `wireInput` with a distinct `渲染失败：` message — was accepted as satisfying carried finding 5; all three `handle(...)` call sites are `void`-prefixed, so the literal reading leaves an unhandled rejection and user-visible silence.
Ruling: all three deviations accepted. The reviewer reproduced (a) and (b) numerically rather than taking them on trust, and confirmed a fourth claimed deviation (the save handler "does not compile under strict") was **not** reproducible — the reviewer typechecked the brief's literal handler against the repo's own tsc and it exits 0. The code change is harmless and clearer, but the rationale is false, and the reviewer is right that an inaccurate "forced" claim is what lets a later reviewer accept real scope-taking on the same reasoning. Ledgered as such rather than as a defect.
Task 12: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 6 Minor. The reviewer verified the dev-API consolidation handle-by-handle against all eight pre-existing pixel specs and confirmed every shape they reach is preserved.
Task 12: complete (commits 34369b1..09af2d4, review clean)

Task 12: minor (deferred, CARRIED INTO TASK 14): the `matBottom * k` scaling — the exact hazard the carried device-pixel/united-units finding named — has no test at `k≠1`. The reviewer verified the arithmetic by hand and it is correct, but a k=2 assertion on a mat-anchored template is cheap insurance for the one failure mode this architecture calls its worst (preview and export diverging).
Task 12: minor (deferred): `src/core/templates.ts`'s comment saying `drawText` does not implement the `'mat'` anchor yet became stale when this task landed.
Task 12: minor (deferred): `tests/pixel/export.spec.ts`'s comment referring to "the interim `?dev=1` handle" is stale now the handle is consolidated.
Task 12: minor (deferred): `wireInput` now owns the renderer's failure vocabulary, coupling input wiring to the render path; catching in `main.ts`'s `onPhoto` callback would keep the module ignorant of rendering. It also converts any `onPhoto` throw — including a programming error — into a toast.
Task 12: minor (deferred, CARRIED INTO TASK 17/18): `pick()` rebuilds every chip, so the clicked chip is removed and focus falls to `<body>` — a keyboard user loses their place on a second consecutive rail pick. Brief-verbatim, self-reported, and now the only untested focus path.

Task 13: dispatched (base 09af2d4, model sonnet). Report: DONE.
Task 13: review (model sonnet) — **Spec ❌**, quality Needs fixes. 2 Important (both plan-mandated), 7 Minor.
Ruling: **both Important findings accepted and fixed.** The first is a plan omission rather than an implementation defect: the plan had a save path with no read path, and the reviewer verified that no task in 14–18 closes it and that the plan's own "Not built yet" list omits it. So a user was told `已保存模板：X` and could never see, select or delete the result — the toast asserted a success the app could not honour. The design spec lists custom templates as v1 scope, so the feature was meant to work. The second is a named spec behaviour the plan dropped: §9 requires session-only degradation when storage is unavailable, and the implementation degraded to total loss plus a notice. (commit 96c84e6)
Task 13: fix round 1/5 (2 Important + 1 Minor addressed, 0 open — saved templates unreachable; session-only fallback missing; save handler silently inert; commits 50b99af..96c84e6)
Task 13: fix verified by re-review (model sonnet) — all three ADDRESSED, no new Critical/Important breakage. The re-reviewer confirmed the no-duplicate property holds *by construction* (one store, no shadow array, the session store reachable only while the browser store is null), checked all seven falsifiability breaks against real line numbers, and confirmed the premium-count invariant survives the merged rail.
Task 13: complete (commits 09af2d4..96c84e6, review clean)

Task 13: minor (deferred, CARRIED INTO TASK 14): the custom-template marker is **occluded on a selected saved chip** — `.custom::before` sits at `bottom: 3px` exactly where `.on`'s ring bottom border lands, and `::after` paints after `::before`, so a selected saved chip looks like a selected built-in. No test covers the selected+saved combination. `bottom: 6px` separates them.
Task 13: minor (deferred, CARRIED INTO TASK 14): the marker's dark-theme appearance is reasoned from tokens, not asserted — no spec emulates dark for the rail chips.
Task 13: minor (deferred): the session-mode toast `已保存模板：X（仅本次会话，浏览器存储不可用）` can clip on narrow viewports against `.toast`'s `nowrap`/`max-width: 90%`.
Task 13: minor (deferred, unreachable): `persist`'s failed arm sets the browser store to null before the fallback write succeeds, so a hypothetical failure there would drop templates still readable on disk.
Task 13: minor (deferred): merging the two id spaces has no collision guard — a hand-written storage record reusing a built-in id renders a duplicate chip. Not reachable through the UI, since saved ids are `custom-<Date.now()>`.
Task 13: minor (deferred): a hand-edited `premium: true` in the storage blob would render a brass chip. Devtools-only, outside the UI trust boundary, and the same leniency is pre-existing.
Task 13: minor (deferred, deferred by ruling): **deletion is absent** — a user can accumulate templates with no way to remove one. Deliberately excluded from the fix round to keep it focused; the final review triages it.

Task 14: dispatched (base 96c84e6, model sonnet). Report: DONE_WITH_CONCERNS. All seven carried-in findings covered, none by an assertion that cannot fail.
Task 14: **plan defect found by the implementer** — the brief's Step 3 demonstration does not work as written. Setting `frame.scale = 0` leaves the canvas fully opaque because `drawBackground` runs before the frame is fitted and always covers the canvas, so the transparency assertion stays green and only the golden reddens. Demonstrated a different way and reported rather than silently substituting.
Task 14: review (model sonnet) — Spec ✅ compliant, **Needs fixes**. 1 Important, 6 Minor.
Ruling: accepted the Important finding. The `preview` guard covered only the photo call site; the probe template's frame filled the canvas, so the background was invisible and `render` could revert *that* occurrence to `photo.el` undetected. The unguarded half was the one the finding exists for — the background pass uploads and blurs at canvas-plus-padding size every render, so its regression makes the app slow rather than wrong, which a correctness-focused suite misses. (commit af4347f)
Ruling: **accepted the fixture-format recommendation.** The reviewer measured that the 18 goldens cost ~3 MB of object store, not the 20 MB the checkout suggests, so switching to PNG would buy little — but nine of the eighteen are byte-identical to their `-light` twins, because the wall is a CSS surface while the rendered canvas is the artifact and does not follow the theme. Dropping the duplicates halves the checkout *and* halves the re-baseline surface. The time-sensitivity argument decided it: a later switch would have to land in a commit that re-baselines every golden at once, which is exactly the move the plan forbids, and Task 16 re-baselines `spec-sheet` regardless.
Task 14: fix round 1/5 (1 Important + 3 Minor addressed, 0 open — preview guard blind to the background call site; two vacuous assertions; bevel pinned on one side only; nine duplicate goldens; commits 11fa733..af4347f)
Task 14: fix verified by re-review (model sonnet) — all four ADDRESSED, no new Critical/Important breakage. The re-reviewer verified the two `preview` breaks are genuinely independent (two single-site mutations, two disjoint failing key sets) and confirmed no golden was re-baselined by comparing file mtimes against the round's activity window.
Task 14: complete (commits 96c84e6..af4347f, review clean)

Ruling: **the fix agent deleted the theme-equality test, and that was right.** With the `-dark.rgba` files gone it would have compared a file against itself — the same "assertion that cannot fail" defect this round was fixing. The claim survives in strictly stronger form: the dark leg now renders live under a dark media query and must reproduce the light golden byte for byte. The re-reviewer confirmed no coverage was lost and that the arrangement is un-silenceable (a `--update-snapshots` run would leave one leg's render in the shared file and redden the other on the next normal run).
Task 14: minor (deferred): `.gitattributes` and two places in the plan still say "18 goldens / one per template per theme" — stale after the fixture drop.
Task 14: minor (deferred): `tests/pixel/mat.spec.ts`'s rewritten comment says x=101 clean rules out an inset of 4 or less; it actually rules out only ≤2. The pinning is correct (x=105 dark rules out ≤4, x=106 clean rules out 6); the prose is wrong.
Task 14: minor (deferred): the bevel is pinned exactly, but `BEVEL_INSET` still lives in `src/core/mat.ts` without a test asserting the constant itself rather than its visual consequence.
Task 14: minor (deferred): goldens are shared across operating systems — `playwright.config.ts` supplies a fixed `snapshotPathTemplate` with no `{platform}` token, so the first CI job on Linux will write-and-fail all nine at once. Latent (no CI config exists); remedy is `{platform}` in the template or running the suite in the pinned Playwright container.

Task 15: dispatched (base af4347f, model sonnet). Report: DONE_WITH_CONCERNS.
Task 15: the implementer resolved the fixture problem the controller flagged — it scanned all 5372 JPEGs on the machine, deliberately avoided personal photos, and used real vendor image-library files (a Nikon D810 sample in **both byte orders**, a no-APP1 file, a Paint.NET export with an empty IFD0, a genuine date-only export). Only `partial-exif.jpg` was synthesised, via Pillow's TIFF writer rather than hand-assembled bytes. It validated the parser against PIL's independent reader across 2911 real JPEGs.
Task 15: **bug in the plan's transcription found by the implementer** — `ShutterSpeedValue` is APEX `log2(1/T)`, so the brief's `Math.pow(2, apex)` captions a 1/125 s frame as `125s`. Corrected to `Math.pow(2, -apex)`. The reviewer verified this from the fixture's own bytes rather than the report (`ExposureTime = 1/125` alongside `ShutterSpeedValue = 6.965784`, and log2(125) = 6.965784) and confirmed the brief's APEX *aperture* formula is separately correct — `ApertureValue = 7.813781` and 2^(7.813781/2) = 15.0 matches the `FNumber` tag exactly.
Task 15: review (model sonnet) — Spec ✅ compliant, **Needs fixes**. 2 Important, 5 Minor.
Ruling: **both Important findings accepted and fixed.** The first is a semantic bug in a user-visible string: the parser read `DateTime` (0x0132 — when the *file* was last changed) instead of `DateTimeOriginal` (0x9003 — when the photograph was *taken*), and the fixture proved the difference with a one-day drift introduced by an editor's re-save. For a product whose whole differentiator is showing what the camera actually did, printing an editor's save date is simply wrong. The second is a licensing problem: 192 KB of third-party vendor photography committed with no attribution or source URL. (commit 651d395)
Task 15: fix round 1/5 (2 Important + 1 Minor addressed, 0 open — save date vs capture date; unlicensed vendor fixtures; unsigned SRATIONAL read; commits 70ed404..651d395)
Task 15: fix verified by re-review (model haiku→sonnet) — all three ADDRESSED, no new Critical/Important breakage. The re-reviewer proved the vendor bytes are gone rather than taking it on trust: it re-ran the generator and got sha256-identical files, and confirmed the two thumbnail slots (which the implementer flagged as a judgment call) hold the generator's procedural pattern, not vendor photography.
Task 15: complete (commits af4347f..651d395, review clean)

Ruling: **the de-vendoring fix replaced pixel content while preserving the original EXIF bytes verbatim, and that was the right reading.** The valuable part of those fixtures is the real metadata — real IFD structures, real maker notes, real byte orders written by real firmware — and that is factual data which exercises the parser. The copyrighted part is the photography. Preserving one and replacing the other keeps the coverage the brief demanded while removing the redistribution problem.
Task 15: minor (deferred, CARRIED INTO TASK 16): the date field's semantics are settled (capture date preferred), so the plate's field list and any caption copy should reflect that rather than "date".
Task 15: minor (deferred, CARRIED INTO TASK 16): `f/${v.toFixed(1)}` prints `f/15.0` for whole-stop apertures, against photographic convention (`f/16`). Design-owned; the plate is where a reader would notice.
Task 15: minor (deferred): the `DateTimeOriginal` fallback is keyed on tag *absence*, not on yielding a parseable date — a file with a present-but-blank `0x9003` now loses its date entirely where the pre-fix parser printed the save date.
Task 15: minor (deferred): `tests/fixtures/README.md` does not carry over the source library and original filenames that the pre-fix report recorded. The licensing substance is solved; the paper trail for the surviving metadata is thinner than it was.
Task 15: minor (deferred): an `s`-format wart is reachable with impossible exposure values (|Tv| ≈ 10²–10³ stops), producing `Infinitys` or exponent notation on corrupt input. Correctly deferred; whoever owns display formatting should clamp.

**FLAGGED FOR THE USER — not mine to act on.** `sample/samples-from-x9-pro-with-some-editing-v0-m6wmpeint76g1.webp` and `public/sample/sample.webp` are byte-identical (66,662 bytes) vendor phone-sample photography with no recorded licence — the same class of issue as Task 15's finding 2, which was fixed for `tests/fixtures/` only. This is the user's own asset, added before this work began, and the licence question is theirs to resolve. Surfaced in the final report.

Task 16: dispatched (base 651d395, model sonnet). First implementer returned NEEDS_CONTEXT rather than guessing — correct behaviour.
Task 16: **design defect in the plan's template data found by the implementer.** The plate drew correctly but landed **off the poster**: at the app's preview size (1152×1440), `spec-sheet`'s mat needed `86 + 150 = 236`px of bottom margin and the frame geometry left 158.4, so the card's bottom edge fell ~78px below the canvas and the user saw a clipped smear of glyph tops. The template had both the highest `frame.scale` (78) of any template and the deepest mat; those cannot coexist. The golden never caught it because at the probe size 480×600 all four hairlines were already off-canvas.
Ruling: **option A — change `spec-sheet.frame.scale` to 66** so the composition fits, plus a new invariant test that no template's mat overflows its canvas. Rejected option B (clamping the band in `render.ts`) because it would mask the defect and still ship a cropped card. The implementer offered A as recommended; I accepted it and added the systemic guard it had not proposed, because the template data model lets anyone write the same combination again and nothing prevented it. (commit 89def74)
Task 16: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 5 Minor. The reviewer independently decoded the golden to check the 172,282-changed-pixel claim against the scale-66 geometry, proved the invariant test's canvas aspect is the unique maximiser of all four overhangs (so an easier photo aspect cannot overflow undetected), and confirmed the guard is general rather than pinned to the one template that failed.
Task 16: complete (commits 651d395..89def74, review clean)

Task 16: minor (deferred, CARRIED INTO TASK 17/18): **the product's differentiator has no golden coverage.** `templates.spec.ts` renders every template with `exif: null`, so the plate contributes zero dark pixels to any committed golden — verified in the binary. The plate's own spec renders in the default theme only, so the one global constraint with no pixel evidence behind it is plate theme-independence (true by construction, since `drawPlate` reads `plate.color` and no `src/core/` file consults the theme). One dark-theme render compared against the light one closes it.
Task 16: minor (deferred): the invariant test's `LONG_EDGE = 1440` duplicates `src/ui/state.ts`'s `longEdge` rather than reading it, so the guard is not tied to the app's actual output size. Exact today — `state.longEdge` has no writer — but a later task lowering it would let the app crop while the test stayed green.
Task 16: minor (deferred): `drawPlate`'s `align: 'left'` branch is untested (no built-in sets it) although `validateTemplate` accepts any `align`, so a hand-edited stored template can reach it.
Task 16: minor (deferred): the goldens' probe size 480×600 is a canvas the app never renders, and `spec-sheet`'s card is still cropped there. A property of the probe, not a defect — named so nobody reads that golden as evidence the card fits at the size users see.
Task 16: minor (deferred, CARRIED INTO TASK 18): the report's §9 claims the fit guard "fails loudly if they don't" match the app's long edge; that is wrong, and the prose should be corrected so the next reader does not rely on it.

Task 17: dispatched (base 89def74, model sonnet). Report: DONE_WITH_CONCERNS.
Task 17: the implementer chose **option (a)** on the carried 4× decision — made the premium tier genuinely deliverable rather than declaring a capability the pipeline lacked. It added a per-tier budget (`PREMIUM_CANVAS_AREA`, WebKit's raised 8192² cap, spendable by the 4× rung only), a bounded 4→2→1 rung ladder whose fallbacks are all held to the conservative floor, and an in-band `holdsPixels` check aimed at the documented failure mechanism (WebKit's over-area refusal leaves the canvas with no backing store, so putImageData/getImageData are as dead as the draws). It rewrote two committed tests from Task 9's fix, which it disclosed.
Ruling: **option (a) accepted, and the test rewrite verified as a contract change rather than an easier test.** The reviewer compared the rewritten tests against their pre-rewrite form: the removed assertions are exactly the ones option (a) contradicts (`k === 1`, `downgraded`, the fixed filename), and every safety assertion is retained — the decode, the byte count, and the centre-alpha check that is the blank-poster detector, which now runs against the 26.5 MP artifact the premium bet is placed on. It also confirmed `PREMIUM_CANVAS_AREA`'s provenance against the real WebKit commit rather than accepting the constant, and that the seam stayed a seam: one import, one call site, no monetization concept anywhere else. (commit 65411a3)
Task 17: review (model sonnet) — Spec ✅ compliant, quality Approved. 0 Critical, 0 Important, 5 Minor.
Task 17: complete (commits 89def74..65411a3, review clean)

Task 17: minor (deferred, CARRIED INTO TASK 18 — the most important carry): **the real-device precondition exists only in the report.** Every branch of the ladder is exercised in CI, but WebKit's actual refusal is *simulated* by answering `getImageData` with zeros. WebKit's real 4096²-tier refusal needs confirmation on device before 4× is sold, and nothing in the repo carries that precondition. The README must state it.
Task 17: minor (deferred): the fallback delivery lost its real-pixel assertion. The refusal test asserts `k`, `downgraded`, filename, dimensions and `bytes > 1000` — but `bytes > 1000` cannot detect blankness, since a 2304×2880 all-transparent PNG deflates to roughly 25 KB. The pre-rewrite test pinned the downgraded delivery as a real image; the new one keeps that check for the admitted path only, which is the less fragile of the two, on the device class the bug was actually about.
Task 17: minor (deferred): a rung that *throws* aborts the ladder instead of stepping down. `draw(rung)` throws when `getContext` fails, and WebKit enforces a separate total-canvas-memory cap whose failure is a thrown error rather than a null — so that shape escapes to the user as an engine message on a device that would have produced a fine 2× file.
Task 17: minor (deferred): the plaque is not painted at boot; only `hidden` in the markup covers it. No v1 consequence, but when payments land a locked template selected at boot would show no plaque until the first pick.
Task 17: minor (deferred): the brass assertion in the entitlements spec hardcodes the light-theme value without emulating the scheme, so "premium is brass in both themes" is half-covered.
Task 17: minor (deferred): `canExport`'s tests never assert `(premium, 2)` — the exact call the app makes for the template a user is most likely to have selected. The brief's test text is the source of the gap.
