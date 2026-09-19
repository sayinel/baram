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

/** The element React renders into, inside each mounted surface's shadow root. */
export function surfaceContents(): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const host of document.querySelectorAll(".security-surface-host")) {
    const content = host.shadowRoot?.querySelector<HTMLElement>(
      ".security-surface-content",
    );
    if (content) found.push(content);
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
 * For "the dialog is not open" assertions. `screen.queryByRole("dialog")` returning
 * null stopped meaning that the moment the dialog moved into a shadow root: it now
 * returns null whether the dialog is open or not.
 */
export function surfaceCount(selector: string): number {
  return surfaceContents().filter((c) => c.querySelector(selector) !== null)
    .length;
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
