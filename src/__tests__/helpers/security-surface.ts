// §359 test helper — queries scoped inside a security surface's shadow root.
//
// `screen` and `render(...).container` both look at the light DOM, and a shadow root
// is not reachable from either: `document.querySelector` does not pierce it and
// `document.body.contains(node)` is false for anything inside one. That is the whole
// point of the isolation, so a test that asserts on one of these three screens has to
// say which shadow root it means.
//
// Tests that render a PARENT can have several surfaces mounted at once — a plugin
// detail screen shows the revocation notice and, mid-install, the consent dialog — so
// `withinSurface` takes the selector of something inside the shadow root it wants
// rather than assuming there is only one.
import type { BoundFunctions, queries } from "@testing-library/react";

import { waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * The element React renders into, inside each mounted surface's shadow root.
 *
 * Document-wide by default. Pass a `root` to restrict it to surfaces mounted inside one
 * render's container — which is only meaningful for the two INLINE surfaces, since the
 * consent dialog's host is portaled to `document.body` and is never a descendant of a
 * test's container.
 */
export function surfaceContents(root: ParentNode = document): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const host of root.querySelectorAll(".security-surface-host")) {
    const content = host.shadowRoot?.querySelector<HTMLElement>(
      ".security-surface-content",
    );
    if (content) found.push(content);
  }
  return found;
}

/**
 * `root.querySelectorAll(selector)`, extended through any security surface inside it.
 *
 * For sweeps that claim to cover everything a component renders. `querySelectorAll` does
 * not pierce a shadow root, so the moment a component grew one, every such sweep quietly
 * narrowed from "every control" to "every control outside the surface" — while its own
 * comment kept promising the wider thing.
 */
export function queryAllPiercing(
  root: ParentNode,
  selector: string,
): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const content of surfaceContents(root)) {
    found.push(...content.querySelectorAll(selector));
  }
  return found;
}

/**
 * Testing-library queries bound inside one surface's shadow root.
 *
 * With `selector`, the surface whose shadow root contains it; without, the only one
 * mounted. Both throw rather than returning the first match when the choice is
 * ambiguous — a test silently asserting against the wrong surface is worse than one
 * that stops.
 */
export function withinSurface(
  selector?: string,
): BoundFunctions<typeof queries> {
  const contents = surfaceContents();
  const matching =
    selector === undefined
      ? contents
      : contents.filter((c) => c.querySelector(selector) !== null);
  if (matching.length !== 1) {
    throw new Error(
      `withinSurface(${selector ?? ""}): expected exactly 1 surface, found ${String(
        matching.length,
      )} of ${String(contents.length)} mounted`,
    );
  }
  return within(matching[0]);
}

/**
 * How many mounted surfaces contain `selector`.
 *
 * For waiting on a surface to appear. Use {@link countAnywhere} for "it is NOT open".
 */
export function surfaceCount(selector: string): number {
  return surfaceContents().filter((c) => c.querySelector(selector) !== null)
    .length;
}

/**
 * Matches for `selector` in the light DOM AND inside every mounted surface.
 *
 * ‼️ This, not `surfaceCount`, is what an "it is not open" assertion needs.
 * `screen.queryByRole("dialog")` returning null stopped meaning that the moment the
 * dialog moved into a shadow root — it returns null whether the dialog is open or
 * not — and `surfaceCount(…) === 0` replaces one blind spot with a smaller one: it
 * is also satisfied by a surface that renders WITHOUT the wrapper, straight into the
 * light DOM. Counting both trees is satisfied only by the thing actually being
 * absent, which is what the test claims.
 */
export function countAnywhere(selector: string): number {
  return (
    document.querySelectorAll(selector).length +
    surfaceContents().reduce(
      (n, content) => n + content.querySelectorAll(selector).length,
      0,
    )
  );
}

/**
 * `withinSurface`, waited for — the async counterpart of `screen.findBy*` for a
 * surface that appears in response to something the test did.
 */
export async function findSurface(
  selector: string,
): Promise<BoundFunctions<typeof queries>> {
  await waitFor(() => {
    expect(surfaceCount(selector)).toBe(1);
  });
  return withinSurface(selector);
}
