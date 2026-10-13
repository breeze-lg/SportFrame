# 模糊画框 / Frame & Mat

Turn a good photograph into a framed poster worth posting. Drop in a photo;
the app puts a white mat, a shadow, a background treatment, and a camera spec
plate around it, and exports a PNG at social-ready resolution.

Words are optional and typed: the 文字 block offers exactly the slots the chosen
style prints — 经典 takes a title and a subtitle, 拍立得 and 样张 a title in the
mat, 留白 none at all — and what you type follows you from style to style. The
camera plate needs no typing: it is read from the photograph's own EXIF.

Photos never leave the device. There is no backend.

## Develop

```bash
npm install
npx playwright install chromium
npm run dev
```

## Verify

```bash
npm run test        # unit — pure functions in node, fast
npm run test:pixel  # browser — canvas geometry, pixel invariants, the goldens
npm run build       # tsc --noEmit + production bundle
```

The full gate is `npm run build && npm run test && npm run test:pixel`.
`test:pixel` builds the app and serves `dist/` on :4173 itself, so it fails when
the production build fails — run it with nothing else holding that port.

## Deploy

The build is static. `npm run build`, then serve `dist/` from any host. It must
be served over HTTP — ES modules do not load from `file://`.

## Dev affordances

| Query | Effect |
|---|---|
| `?dev=1` | Exposes `window.__frame`, `__frameCore`, `__frameTemplates`, `__frameCeremony`, `__frameExport` for tests and console poking |
| `?demo=1` | Loads a procedurally generated photo — no file needed to try the app |
| `?demo=1&tpl=spec-sheet` | The demo photo with a named template; `?tpl` is read only alongside `?demo=1` |

## Layout

`src/core/` is framework-free and **never imports from `src/ui/`**. That
boundary is what keeps the canvas math testable, and it is the one
architectural rule in this codebase.

## Pixel snapshots

`tests/pixel/__screenshots__/` holds **nine** goldens — one per built-in
template (`<id>-light.rgba`), not one per template per theme. The dark leg of
`tests/pixel/templates.spec.ts` is asserted against the *light* golden: `--mat`
is `#FFFFFF` in both themes and every colour `render` paints is a literal or a
template field, so a byte-identical render while the media query says dark is
the cross-theme assertion. A theme-dependent renderer cannot be re-baselined
out of it — both legs compare to the same file, so whichever render
`--update-snapshots` writes, the other leg is red on the next run.

A red golden is a question, not a verdict. Either the renderer changed by
accident — fix `src/` and keep the golden — or you meant the change. Only then:

```bash
npx playwright test tests/pixel/templates.spec.ts --update-snapshots
```

Re-baseline and commit the new goldens in the same change as the template edit.
The mismatching render is left under `test-results/`.

The suite runs in Chromium (Playwright's default, no `projects`). Text metrics
differ in other engines, so the goldens are Chromium's rendering.

Maintainer note: the mat fit-guard in `tests/unit/templates.test.ts` lays every
template out at 1152×1440 — `resolveSize(ratio, 1440)`, the default of
`state.longEdge`, hardcoded in the test rather than read from the app. Nothing
writes `longEdge` today, so the two agree; give it a writer (a size picker) and
the guard goes on checking 1440 until you change it by hand.

## Known limitations

**A rail chip shows the photograph, not a preview of the style.** Each chip is
the user's own photo cover-cropped to the chip, as `design/style-direction.html`
specifies for `.print .rawshot`, so the nine chips differ only by the selected
ring and the brass corner. A true per-style thumbnail would have to render each
template small — and the frame geometry is absolute pixels tuned to the 1440
long edge (see above), so a 50×62 render of 样张 would be nonsense. Decoupling
the geometry from the long edge is the prerequisite, not a chip-level fix.

**存为模板 saves the style, not the words.** The template record has no room for
text values, so a saved template brings back its typography and the fields come
up empty; `state.text` is one record for the session. Adding values to the
record means touching `validateTemplate`, the storage blob and its versioning.

**The 4× export tier is unverified on real WebKit.** 4× is what the spec (§10)
advertises as the premium unlock, and `src/ui/export.ts` makes it deliverable by
budgeting canvas *area* per rung (`areaBudget`) and walking a fallback ladder
when a rung is refused. Every branch of that ladder is exercised in CI, but the
WebKit refusal itself is **simulated**: the tests stage it by answering
`getImageData` with zeros for any canvas over the floor. WebKit's real
over-budget behaviour — draws that become no-ops and a `toBlob` that yields null
— has never been observed on an actual device by this codebase. Confirm 4× on
real iOS Safari before it is sold to anyone. (Nothing reaches 4× through the UI
today: the save button asks for 2×, and the premium rung is reachable only
through `__frameExport`.)

**The `sign` slot stacks like the rest, and no built-in declares one.** Slots are
laid out as a block — each line advanced from the one before it by the taller of
the two sizes — so `title`, `sub` and `sign` each land on their own baseline
under every anchor, and which end of the block an anchor names depends on the
anchor (`bottom` grows upward, `top` downward). `tests/pixel/text.spec.ts` pins
both. Only a hand-edited stored record reaches `sign`.

## Not built yet

Adjustments (crop, straighten, tone looks) and collage layouts are specified but
deliberately unbuilt — the spec's stage list (§4, stages 5–6, in
`docs/superpowers/specs/2026-10-07-photo-frame-app-design.md`) puts them after
the shippable product, and §12's adjust-panel metric is the test of whether they
were worth taking. `layout` is carried in the data model and nothing reads it:
`render` draws `photos[0]` and no more.

Payments are a seam only — one boolean (`Template.premium`) and two functions in
`src/entitlements.ts`, both answering `true` in v1, wired at two call sites in
`src/main.ts`. Nothing is gated.

**`?selftest=1` and `?pixcheck=1` are not built.** The spec (§8, "Carried over
from the prototype") names both of the prototype's other query affordances and
says they should be preserved; this build has `?dev=1` and `?demo=1` (see above)
and neither of those two. `?pixcheck=1` — the one the spec argues for by name,
because it read exported pixels back to check the mat/frame boundary and is the
hand-rolled ancestor of the pixel suite in §11 — is superseded by
`tests/pixel/`: the invariants there, on the `?dev=1` handles, are the same
reads against the same boundary. Nothing replaces `?selftest=1`. Both were
dropped in the rebuild without a record, which is what this paragraph is for.
Neither query does anything today.
