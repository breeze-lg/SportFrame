# 模糊画框 / Frame & Mat

Turn a good photograph into a framed poster worth posting. Drop in a photo; the
app puts a white mat, a shadow, a background treatment, and a camera spec plate
around it, and exports a PNG at social-ready resolution.

Photographs are a list. Load one or a dozen — the picker takes several at once,
and a drop or a paste can carry a folder's worth — and the left column keeps them
with the one on the wall marked, switchable, and removable. The wall is always
one of them; removing the last one returns the app to the bare wall it boots on.

Styles are a rack of previews under the wall: each chip is a small render of the
poster that style would make of the photograph in hand, so the mat, the backdrop
and the canvas shape are all visible before you pick one.

Words are optional and typed: the 文字 block offers exactly the slots the chosen
style prints — 经典 takes a title and a subtitle, 拍立得 and 样张 a title in the
mat, 留白 none at all — and what you type follows you from style to style. The
camera plate needs no typing: it is read from the active photograph's own EXIF.

The mount's own geometry is adjustable too. 画面 offers one slider per number the
current template can change — 前景大小, 水平位置/垂直位置, 白边/下白边, and (on a
blurred background) 后景放大/虚化/压暗 — and 存为模板 keeps the numbers you set,
so a look you tuned is a style you can pick again. The sliders cannot be driven
into a poster the renderer would crop: every maximum is the layout's own ceiling,
computed in `src/core/limits.ts`. Nothing you change there is saved until you
press 存为模板; the note beside the heading says 已调整 until you do, and 重置
beside it is how the numbers as authored come back.

A refresh comes back to where you left off. The photographs, the one that was on
the wall, the mount, the words and the numbers are all written as you work, so a
stray ⌘R, a crash, or a phone that reclaims the tab costs nothing. The original
files are stored, not a re-encode of them, so a restored photograph still knows
its own EXIF.

The screen is arranged the way an editor on a phone is: 保存 and the two arrows
across the top, the poster in the middle with its own name and one line about
what it does under it, the collections above the rack of styles, and a switch at
the foot that shows 文字 or 画面 — one at a time. 撤销 and 重做 walk back through
the mount, its numbers and the words; the photograph list is deliberately not in
that history, because removing a photograph takes its bytes with it and a 撤销
that offered to bring one back would be promising what the store no longer has.

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
| `?demo=1` | Loads a procedurally generated photograph into the app — no file needed to try it. A sandbox: it neither reads nor writes the session, so a reload is always the same one-photograph demo and a real session in the same browser is never touched |
| `?demo=1&tpl=spec-sheet` | The demo photo with a named template; `?tpl` is read only alongside `?demo=1` |

## Layout

Two arrangements, one app. On a desk the shell is three columns in a grid: the
photographs on the left, the wall with the rack of styles under it in the middle,
and the actions and 画面 on the right — 保存 at the top of that column with the two
arrows beside it, and the panel switch under it. On a phone the same things arrive
as a stack: a bar across the top (照片 and its count, the arrows, 保存), the
poster, its caption, the collections, the rack, then the switch at the foot with
the open panel above it. The stack fits one screen (`height: 100dvh`, no page
scroll), because a switch that has to be scrolled to is a switch nobody finds.
The photograph list is the left column on a desk and a sheet behind the 照片
button on a phone — with the bare wall carrying its own 添加照片, since a way in
that lives behind a button is no way in for someone who has never used the app.

`tests/pixel/layout.spec.ts` asserts those relationships as geometry — left of,
below, corner of — rather than as a screenshot, so they hold at any window size.

`src/core/` is framework-free and **never imports from `src/ui/`**. That
boundary is what keeps the canvas math testable, and it is the one architectural
rule in this codebase.

Each panel is a pure model with a dumb DOM half beside it, and the model is where
the rules live:

| module | the model | the DOM |
|---|---|---|
| `src/ui/photos.ts` | `addPhotos` / `removePhoto` / `selectPhoto` / `activePhoto` — which photograph is on, after any mutation | the list rows |
| `src/ui/rail.ts` | `styleThumb` — the preview of a style | the rack of chips |
| `src/ui/fields.ts` | — (the slots are the template's) | the 文字 inputs |
| `src/ui/controls.ts` | `controlSpecs` / `setControl` / `settleTemplate` — the whole write path, clamped | the sliders |
| `src/ui/tabs.ts` | `tabsFor` / `inTab` / `filterRail` — which styles a collection holds | the row of collection names |
| `src/ui/modes.ts` | `modeFor` — which panel a template can show | the switch |
| `src/ui/history.ts` | `remember` / `undo` / `redo` — the stack and the burst rule | the two arrows |

That split is the reason `tests/unit/` can answer for the arithmetic (index
shifts on deletion, slider ceilings, preview keys) in `node`, and why the browser
suites are only about what reaches the wall.

## The style previews

A chip is a render, not a crop: `styleThumb` calls the same `render` the wall
does, at the poster's own logical size and at `k = chip / longEdge`. Every
absolute measure in the renderer is absolute in `k` — the mat, the radius, the
shadow, the blur, the type — so one small `k` produces *the same poster*,
smaller, with no second layout path and nothing re-tuned per size. The chip's box
is the canvas ratio at that scale, so the rack says which styles are wide, tall
or square before anything is loaded.

Previews are memoised on everything that can change one (the template's geometry,
the photography, the box) and capped at sixty, because a session that loads
photographs and drags sliders would otherwise hold a bitmap for every combination
it passed through. The words are **not** in a preview: they belong to the user
rather than to the style, and re-rendering ten posters per keystroke would be the
cost of a claim nobody made.

## The spec plate

The plate is the product's differentiator — the app reads what the camera wrote,
so the user types nothing — and it is a caption rather than a row of values: the
model's name on its own line, the exposure in smaller type under it, inset from
the band's left wall. That is a camera's own watermark, and it is why
`src/core/plate.ts` reads its fields as *data* (`plateValues`) rather than as a
list of strings: where the line break goes is a decision about which field means
what, and a list of values has already thrown that away.

Two lines only when there is something for both. A photograph whose EXIF carries
an exposure and no camera — what a phone upload usually looks like — draws one
line, and a band too shallow to hold two (`head + 1.9·detail`) gets one line at
the smaller size rather than two rows printed over each other and over the mat's
edge. `tests/pixel/plate.spec.ts` pins all three, plus the original rule: no
metadata, no plate, and never a blank band.

## What the reference editor gave this app

The arrangement — the bar across the top, the poster with its caption, the
collections, the rack, and the switch at the foot that shows one panel at a time
— comes from a camera app's own editor, which is where a poster is made on a
phone and therefore a fair model for one made here. What did not come across is
its *skin*: the palette, the rounded cards and the accent colour are that
product's, and this app has its own (the design sheet's ink, beige and brass, in
the two themes `tokens.css` defines).

Three things in it were deliberately not taken:

- **取消**, because there is nothing to cancel. This app is not a modal session —
  a poster is saved by 保存 and a visit is left by leaving. The slot it would have
  taken in the bar holds 照片 instead, which is where the photograph list has to
  live when there is no column for it.
- **The settings button in the middle of the selected card.** The gesture is real
  here — pressing the chip that is on opens 画面, and the knob drawn in the middle
  of that chip says so — but it is not a second control: a button inside the chip
  would be a button inside a button, so the chip's own click is the control and
  the knob is its mark.
- **The brand mark** on the caption band, which is somebody's logo. The user's own
  `sign` slot is the honest occupant of that corner, and no built-in declares one
  yet (see below).

`撤销` and `重做` are the one *feature* in the reference rather than a piece of
layout, and the session record made them nearly free: a step is a snapshot of the
same two blocks the record already holds — the mount and the words — and a burst
of edits to one field is one step (700 ms, `COALESCE_MS`). The photograph list is
not in the stack: removing a photograph drops its bytes, and offering to bring one
back would be promising what the store no longer has.

## What this app stores, and where

Four things are kept on the device. Three are `localStorage` keys and one is an
IndexedDB database; all of them are per-origin, and none of them is a server's.

| what | where | kept in `src/` |
|---|---|---|
| the theme | `localStorage` `frame-app-theme` | the head script in `index.html`, `src/ui/theme.ts` |
| saved templates (存为模板) | `localStorage` `frame-app-custom-v1` | `src/ui/custom.ts` |
| the session: the photographs, which one is on the wall, the mount, the words, the numbers | `localStorage` `frame-app-session-v1` | `src/ui/session.ts` |
| the photographs' own bytes | IndexedDB `frame-app-photos` | `src/ui/session.ts` |

The session is two stores because it holds two sizes of thing: the *record* is a
few hundred bytes of JSON, read synchronously before the first paint so the app
comes up wearing the mount the user left it on; the *bytes* are tens of megabytes
and have to be read back and decoded off the event loop, so the wall is bare for
a moment and then filled in. The record is what knows the list's order, and
`active` is an index into it, so the record's `photos` is always one entry per
photograph in the list — an entry with no key is a photograph with no bytes
behind it, either one whose store is still in flight or one the caps evicted.

The caps are `MAX_PHOTOS` (24) and `MAX_BYTES` (256 MB), and past either one the
oldest photographs stop coming back — oldest first, because the list is
append-only and what has been there longest is what the user has already looked
at. The record is written on every edit (a keystroke, a slider tick, a pick, a
photograph added or removed) rather than on a debounce, because a record that
lags by one edit restores the wrong poster, and a few hundred bytes of JSON is
not worth a timer.

Every path degrades rather than throwing: a refused IndexedDB, a quota that
refuses a write, a record an older build wrote, a blob that will not decode. A
session that cannot be restored is a fresh session, which is where the app
started anyway.

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
the guard goes on checking 1440 until you change it by hand. The style previews
read it too: their scale is `chip / longEdge`, so a longer edge is a sharper
chip and a slower rail.

## The 画面 panel

`src/ui/controls.ts` describes the panel as data — `controlSpecs(template,
context)` returns one `ControlSpec` per slider, with the value it holds and the
range it may be dragged over — and `setControl` is the whole write path: one
value, clamped, on a copy of the record. Both are pure, which is why the whole
of the panel is testable in `node` (`tests/unit/controls.test.ts` sweeps every
control on every built-in across its range) and why the DOM half is dumb enough
to have nothing in it to test.

The ceilings are not round numbers and they are not the panel's own opinion:
`src/core/limits.ts` derives them from the arithmetic in `fitRect` and `matRect`,
so a slider's maximum is the largest value that still lays the mat inside the
canvas. `tests/unit/limits.test.ts` keeps the closed forms honest by laying
posters out with the same two functions `render` calls. Two rules follow from
that, and both are load-bearing:

- Raising one control never moves another *except* the offsets, which have less
  room as the photograph grows — so a write settles the frame afterwards rather
  than clamping only what the user touched.
- 后景 is not offered where there is no 后景. 样张 paints a flat white card, so a
  虚化 slider there would accept a drag and change nothing, which is the failure
  文字 already refuses for 留白.

The panel's heading carries its two actions. 重置 puts the mount back to the
numbers as authored — the gesture that used to be a second click on the chip
already selected, which is now what opens this panel — and is live only while
已调整 is showing. 存为模板 keeps them under a name. Both belong here rather than
beside 保存, because they act on the numbers *in* the panel; that is also why 保存
is alone in the dock's top row on a desk and alone in the bar on a phone.

## Known limitations

**`?demo=1` no longer stores its photograph, and the copies it once did are still
there.** The demo used to persist like any other photograph, so a reload of that
URL restored the demo it had stored and then added a second one — the list grew
by one per refresh, and a demo visit wrote a generated photograph into the user's
own session. It is a sandbox now (see the dev affordances above). What that does
not fix is the photographs it already stored: they come back on `/` until they
are removed with the × on each row. They are not cleaned up on sight, on purpose
— a stored photograph named `demo` is indistinguishable from a real file somebody
named `demo`, and guessing wrong there deletes a photograph.

**The list is capped where it persists, not where it lives.** Every photograph
loaded is decoded and held in memory — 48 MB per 12 MP frame — for as long as its
row is in the list, and there is no cap on that: a folder of forty dropped in at
once is roughly 2 GB of bitmaps and the browser will not survive it. What *is*
capped is what comes back after a refresh: 24 photographs or 256 MB, oldest
evicted first. So the two limits are different numbers, and the one a user meets
first is the browser's. A photograph whose bytes were evicted stays in the list —
it is the user's, and the wall can still draw it — and is simply not there after
the next reload, which is what the one-off 存储已满 toast is about. Restoring a
full session re-decodes every photograph in it, so a slow device shows a bare wall
for a second or two before the list fills in.

**The list is for switching, not for collage.** `render` draws `photos[0]` and no
more; the other photographs are reachable through the wall one at a time. Collage
is spec stages 5-6 and unbuilt — see below.

**存为模板 saves the style, not the words.** The template record has no room for
text values, so a saved template brings back its typography and the fields come
up empty; `state.text` is one record for the session. Adding values to the
record means touching `validateTemplate`, the storage blob and its versioning.
What a saved template *does* carry is its geometry — the numbers the 画面 panel
wrote (see above). The two are not the same problem: a style's typography and
its measurements are the template's, while the words are the user's, and 文字's
whole design is that they follow the user from mount to mount.

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
were worth taking. The 画面 panel adjusts the *mount* — how large the photograph
is, where it sits, how deep the mat, how the backdrop is treated — and stops
there: nothing in this app crops, straightens or grades the photograph itself,
and no panel value changes a pixel of the image. `layout` is carried in the data
model and nothing reads it: `render` draws the active photograph and no more.

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
