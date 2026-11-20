/**
 * A scene behind the empty state's text (the Sky toy, a screensaver) can
 * give the text a look that reads on it: light on a night sky
 * (`data-scene-night`), dark on a day sky (`data-scene-day`). Two scenes can
 * hand the same elements (the card's title) to each other, and React tears
 * one down and sets the next one up at different moments. So a scene owns
 * the look it set, and clears only that: a scene leaving after the next one
 * has set its look doesn't clear the new one (owner, 2026-11-19: the title
 * flickered when the sky and a screensaver took over from each other).
 */
export type SceneLook = "night" | "day" | null;

const owners = new WeakMap<HTMLElement, object>();

function apply(el: HTMLElement, look: SceneLook) {
  if (look === "night") el.dataset.sceneNight = "";
  else delete el.dataset.sceneNight;
  if (look === "day") el.dataset.sceneDay = "";
  else delete el.dataset.sceneDay;
}

/** Sets the look, taking the elements over from any scene that set one. */
export function claimLook(owner: object, els: (HTMLElement | null)[], look: SceneLook) {
  for (const el of els) {
    if (!el) continue;
    owners.set(el, owner);
    apply(el, look);
  }
}

/** Sets the look on the elements no other scene has taken over. */
export function setLook(owner: object, els: (HTMLElement | null)[], look: SceneLook) {
  for (const el of els) {
    if (!el) continue;
    const held = owners.get(el);
    if (held && held !== owner) continue;
    owners.set(el, owner);
    apply(el, look);
  }
}

/** Clears the look this scene set, where no other scene has taken over. */
export function releaseLook(owner: object, els: (HTMLElement | null)[]) {
  for (const el of els) {
    if (!el || owners.get(el) !== owner) continue;
    owners.delete(el);
    apply(el, null);
  }
}
