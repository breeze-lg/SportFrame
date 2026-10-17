/**
 * The typefaces a poster may print in.
 *
 * A record stores an **id**, never a CSS stack. A template travels — it is
 * exported as JSON, saved into `localStorage`, handed to another machine — and
 * a raw `"Hanzipen SC", cursive` in a saved record is a font nobody can rename,
 * retarget or list in a picker. The stack lives here, beside the label, where
 * both can change without touching a single stored record.
 *
 * Every stack ends in `SYSTEM_STACK`, and that is the whole reason the ids are
 * worth having: these are *system* families, so a record made on a Mac and
 * opened on Windows or Linux falls back through the chain to
 * `KaiTi`/`SimSun`/`STKaiti`, and failing all of those to the app's own sans
 * rather than to whatever `cursive` means on that machine. A poster is a
 * photograph with words on it; printing the words in Times New Roman because a
 * font was missing is a worse answer than printing them in the app's own face.
 *
 * This file is framework-free data plus two lookups (`src/core/` never imports
 * from `src/ui/`), because `drawText` needs the stack and cannot reach the
 * picker. The half that *loads* a file a user brought — `FontFace`, IndexedDB,
 * the file input — is `src/ui/fonts.ts`.
 */

/**
 * The stack the app's own data is set in — every number, every readout, the spec
 * plate. Exported because two very different places have to agree on it: the
 * DOM's `--mono` token, and `src/core/plate.ts`, which draws the plate on a
 * canvas. They are the same four families in the same order, and a canvas never
 * asks the browser for a face it needs the way a DOM node does — see
 * `loadFaces` in `main.ts`, which is the request a canvas cannot make itself.
 */
export const MONO_STACK = `'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace`

/**
 * The system stack. Chinese text renders from here and there is no webfont
 * behind it: a CJK webfont costs megabytes, and this app ships none. The one
 * exception is a font the user loads themselves — their file, their disk — and
 * that is exactly why loading is worth building: it is the only way to get a
 * handwriting face onto a poster without shipping the typeface to everyone.
 */
export const SYSTEM_STACK =
  '-apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif'

/** Which end of the picker a choice belongs in. */
export type FontGroup = 'zh' | 'latin' | 'user'

export type FontChoice = {
  id: string
  label: string
  group: FontGroup
  stack: string
}

export const FONT_GROUP_LABELS: Record<FontGroup, string> = {
  zh: '中文',
  latin: '西文',
  user: '我加载的',
}

/**
 * The presets: faces that are already on the machine, each with the closest
 * relatives from the other platforms behind it. Nothing is downloaded and
 * nothing is bundled, which is why this list can be long without costing a
 * byte — and why a missing one is a fallback rather than a broken poster.
 */
export const FONT_CHOICES: FontChoice[] = [
  { id: 'default', label: '默认黑体', group: 'zh', stack: SYSTEM_STACK },
  {
    id: 'songti',
    label: '宋体',
    group: 'zh',
    stack: `"Songti SC","STSong","SimSun",serif,${SYSTEM_STACK}`,
  },
  {
    id: 'kaiti',
    label: '楷体',
    group: 'zh',
    stack: `"Kaiti SC","STKaiti","KaiTi",serif,${SYSTEM_STACK}`,
  },
  // The two faces this feature exists for: 行楷 and 手写体 are the handwriting
  // this platform ships, and neither is a black body face.
  {
    id: 'xingkai',
    label: '行楷',
    group: 'zh',
    stack: `"Xingkai SC","STXingkai","KaiTi",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'hanzipen',
    label: '手写体',
    group: 'zh',
    stack: `"Hanzipen SC","HanziPen SC","KaiTi",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'yuanti',
    label: '圆体',
    group: 'zh',
    stack: `"Yuanti SC","STYuanti","YouYuan",sans-serif,${SYSTEM_STACK}`,
  },
  {
    id: 'baoli',
    label: '隶书',
    group: 'zh',
    stack: `"Baoli SC","STBaoli","LiSu",serif,${SYSTEM_STACK}`,
  },
  {
    id: 'wawati',
    label: '娃娃体',
    group: 'zh',
    stack: `"Wawati SC","STWawati","YouYuan",sans-serif,${SYSTEM_STACK}`,
  },
  // 花体 / script: the Latin half of the same request.
  {
    id: 'snell',
    label: '花体（Snell）',
    group: 'latin',
    stack: `"Snell Roundhand","Apple Chancery","Segoe Script",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'savoye',
    label: '花体（Savoye）',
    group: 'latin',
    stack: `"Savoye LET","Apple Chancery","Segoe Script",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'zapfino',
    label: '书法（Zapfino）',
    group: 'latin',
    stack: `"Zapfino","Apple Chancery","Brush Script MT",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'bradley',
    label: '手写（Bradley）',
    group: 'latin',
    stack: `"Bradley Hand","Comic Sans MS","Segoe Print",cursive,${SYSTEM_STACK}`,
  },
  {
    id: 'marker',
    label: '马克笔',
    group: 'latin',
    stack: `"Marker Felt","Comic Sans MS","Segoe Print",sans-serif,${SYSTEM_STACK}`,
  },
  {
    id: 'copperplate',
    label: '铜版体',
    group: 'latin',
    stack: `"Copperplate","Optima","Georgia",serif,${SYSTEM_STACK}`,
  },
  {
    id: 'didot',
    label: '衬线（Didot）',
    group: 'latin',
    stack: `"Didot","Bodoni 72","Georgia",serif,${SYSTEM_STACK}`,
  },
]

/** The prefix that marks a family the user loaded. The rest of the id is their
 *  font's own name, which is what `FontFace` registers and what the stack
 *  quotes — see `src/ui/fonts.ts`. */
export const USER_PREFIX = 'user:'

export function isUserFont(id: string | undefined): boolean {
  return !!id && id.startsWith(USER_PREFIX)
}

/** The font's own name, out of a `user:` id. Tolerates `undefined` and an id
 *  that is not one, because both callers guard with `isUserFont` and TypeScript
 *  cannot see through a helper — and a name of `''` is the answer that fails
 *  safely at the picker rather than at the renderer. */
export function userFontName(id: string | undefined): string {
  return typeof id === 'string' ? id.slice(USER_PREFIX.length) : ''
}

export function userFontId(name: string): string {
  return `${USER_PREFIX}${name}`
}

/**
 * The CSS stack for a stored id.
 *
 * A `user:` id quotes the user's font name and then falls back to the system
 * stack, so a font they loaded on one machine and a record opened on another
 * still prints the words — in the app's face rather than in nothing.
 *
 * An id nothing knows — a record from a newer build, a hand-edited one — is the
 * system stack rather than a throw. `render` runs on every keystroke and inside
 * every export; it is the wrong place to discover a typo.
 */
export function stackOf(id: string | undefined): string {
  if (isUserFont(id)) {
    const name = userFontName(id).replace(/"/g, '')
    return `"${name}",${SYSTEM_STACK}`
  }
  const found = FONT_CHOICES.find((f) => f.id === id)
  return found ? found.stack : SYSTEM_STACK
}

/** The label to show for a stored id, for a readout rather than a picker. */
export function labelOfFont(id: string | undefined): string {
  if (isUserFont(id)) return userFontName(id)
  return FONT_CHOICES.find((f) => f.id === id)?.label ?? FONT_CHOICES[0]!.label
}
