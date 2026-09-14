/*
 * Pull-to-refresh gesture maths — deliberately free of React and JSX so the
 * tricky part (deciding whether a downward drag is a pull, a scroll, or
 * neither) can be unit-tested without a browser.
 *
 * The rule that matters: Cloak's app shell pins the viewport (`h-dvh`) and
 * scrolls an inner `<main class="overflow-y-auto">`. `window.scrollY` stays
 * 0 no matter how far the user scrolls a chat list, so a pull is only real
 * when EVERY scrollable ancestor between the finger and the document is
 * already at the top.
 */

/** Release past this many pixels to refresh. */
export const TRIGGER_PX = 72;
/** Visual ceiling for the indicator travel. */
export const MAX_PULL_PX = 110;
/** Resistance — the indicator moves slower than the finger. */
export const PULL_DAMPING = 0.55;
/** Below this the gesture is a scroll, not a pull. */
export const PULL_START_PX = 6;

/** Elements where a downward drag belongs to the field/dialog, not to us. */
export const IGNORED_TARGETS = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[data-no-pull-refresh]",
].join(", ");

/** True when the gesture started on something that owns its own drag. */
export function isExcludedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(IGNORED_TARGETS);
}

/**
 * True when nothing between `target` and the document is scrolled. Pulling is
 * only meaningful from the very top of every scrollable ancestor — otherwise
 * the user is simply scrolling a list back up.
 *
 * A target that is not an Element is refused: without it we cannot see which
 * container the gesture belongs to, and refusing is the safe failure — the
 * gesture falls through to normal scrolling instead of being hijacked.
 */
export function isAtTop(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  let node: Element | null = target;
  while (node) {
    if (node.scrollTop > 0) return false;
    node = node.parentElement;
  }
  const doc = document.scrollingElement;
  if (doc && doc.scrollTop > 0) return false;
  return window.scrollY <= 0;
}

/** True on any device that can actually perform the gesture. */
export function supportsPull(): boolean {
  if (typeof window === "undefined") return false;
  if (navigator.maxTouchPoints > 0) return true;
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

/** Indicator travel for a raw finger delta, with resistance and a ceiling. */
export function pullForDelta(delta: number): number {
  if (delta <= PULL_START_PX) return 0;
  return Math.min(MAX_PULL_PX, delta * PULL_DAMPING);
}

/** Should releasing at this travel distance trigger a refresh? */
export function shouldRefreshAt(pull: number): boolean {
  return pull >= TRIGGER_PX;
}

/** Bounded wait — bookkeeping must never block the reload. */
export function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(undefined), ms);
    const settle = (value: T | undefined) => {
      window.clearTimeout(timer);
      resolve(value);
    };
    promise.then(settle, () => settle(undefined));
  });
}
