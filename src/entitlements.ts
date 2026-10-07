import type { Template } from './core/types'

/**
 * The entire monetization surface. Spec §10: v1 ships nothing gated.
 * When payments arrive, only this file and its call sites change —
 * no other part of the app learns what money is.
 *
 * What these two functions answer is *entitlement*: may this user use this
 * template, may this user ask for this export quality. What they must never
 * answer is *capability* — whether the device in front of them can physically
 * produce that file. Those are different questions with different owners, and
 * conflating them is how an app ends up telling a paying user they bought
 * something they cannot have. A 4× canvas is 26.5 MP at the default frame, and
 * a phone in WebKit's older area tier cannot hold one; `src/ui/export.ts` is
 * what decides that — it draws the largest rung the device allows and the app
 * names the scale in a toast when it has to come down. So a verdict of `ok`
 * here means the user is entitled to ask, never that the pixels are guaranteed.
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
