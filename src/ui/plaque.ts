import type { Template } from '../core/types'

/**
 * 铜角装裱 — the plaque under the rail that shows when a template is premium
 * *and* locked, naming the pack it belongs to. A locked chip that does nothing
 * and says nothing is a broken button; this is the sentence that makes it a
 * thing with a name.
 *
 * Spec §10 ships nothing gated, so `isUnlocked` answers true for every
 * template and this returns `''` — the plaque is wired and never shown, which
 * is v1's claim rather than an omission. `unlocked` is a parameter instead of a
 * call to `isUnlocked` so the locked branch has a test today; the call site in
 * `main.ts` passes the verdict it already has. The rule lives here, and not
 * inline in the picker, because the branch no v1 user can reach is the branch
 * that most needs asserting.
 */
export function plaqueText(template: Template, unlocked: boolean): string {
  return template.premium && !unlocked ? `${template.name} · 铜角装裱` : ''
}
