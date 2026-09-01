/**
 * Scope helpers for the browser shell.
 *
 * `Scope` knows only how to undo a closure — it has no `listen`, because
 * typing one would mean `core/` naming a DOM event type, and the engine is
 * meant to run headless. The listener helpers live here instead, with the real
 * `HTMLElementEventMap` types, and this is where most of the player's 67
 * listeners already are.
 *
 * It sits in `app/` rather than `hud/` because `app/` is the composition root
 * and may see every layer; a panel that needed this would be reaching for the
 * framework, which `ui-reads-projection-only` counts against for good reason.
 */
import type { Scope } from "../core/scope";

/** `el.addEventListener(type, fn)`, undone when the scope dies. */
export function on<K extends keyof HTMLElementEventMap>(
  scope: Scope, el: HTMLElement, type: K,
  fn: (ev: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void {
  el.addEventListener(type, fn, opts);
  scope.defer(() => el.removeEventListener(type, fn, opts));
}

/** The same, for `window` — resize, keydown, hashchange. */
export function onWindow<K extends keyof WindowEventMap>(
  scope: Scope, type: K, fn: (ev: WindowEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void {
  window.addEventListener(type, fn, opts);
  scope.defer(() => window.removeEventListener(type, fn, opts));
}

/**
 * `setInterval`, cleared when the scope dies.
 *
 * A timer outliving its scope is the quietest leak of the lot: it keeps a
 * closure over a torn-down stage alive and does its work against it.
 */
export function every(scope: Scope, ms: number, fn: () => void): void {
  const id = setInterval(fn, ms);
  scope.defer(() => clearInterval(id));
}

/** `requestAnimationFrame` loop that stops with the scope. */
export function eachFrame(scope: Scope, fn: (now: number) => void): void {
  let id = 0;
  const step = (now: number) => {
    id = requestAnimationFrame(step);
    fn(now);
  };
  id = requestAnimationFrame(step);
  scope.defer(() => cancelAnimationFrame(id));
}
