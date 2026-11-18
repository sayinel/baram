// §396 zoom input goes to the topmost fullscreen viewer (the zoom owner), not the
// editor behind it. With no owner on the stack the editor zooms as before — that
// half is pinned by use-zoom-gesture.test.ts and zoom-and-navigation-keys.test.ts.

import type { ZoomAnchor, ZoomOwner } from "../../utils/viewer-zoom";

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { pushZoomOwner } from "../../utils/viewer-zoom";
import { useZoom, zoomByWheel } from "../use-zoom";

interface FakeOwner extends ZoomOwner {
  calls: [number, null | ZoomAnchor][];
  scale: number;
}

const realPlatform = navigator.platform;

function fireCtrlWheel(
  deltaY: number,
  coords: { clientX?: number; clientY?: number } = {},
): void {
  window.dispatchEvent(
    new WheelEvent("wheel", {
      cancelable: true,
      ctrlKey: true,
      deltaY,
      ...coords,
    }),
  );
}

// jsdom has no GestureEvent constructor; the hook reads type, scale and the
// optional clientX/clientY, so an Event carrying those is the same contract.
function fireGesture(
  type: string,
  scale: number,
  coords: { clientX?: number; clientY?: number } = {},
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "scale", { configurable: true, value: scale });
  for (const [key, value] of Object.entries(coords)) {
    Object.defineProperty(e, key, { configurable: true, value });
  }
  window.dispatchEvent(e);
  return e;
}

// Like a real owner, it keeps the scale it was given — otherwise a router that re-reads
// getScale() on every gesturechange would read the same base as one that captured it at
// gesturestart, and the pinch tests below could not tell the two apart.
function makeOwner(): FakeOwner {
  const owner: FakeOwner = {
    calls: [],
    getScale: () => owner.scale,
    scale: 1,
    setScale: (scale, anchor) => {
      owner.calls.push([scale, anchor]);
      owner.scale = scale;
    },
  };
  return owner;
}

function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(e);
  return e;
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

const zoom = () => useSettingsStore.getState().zoomLevel;

let fake: FakeOwner;
let pops: (() => void)[];

function push(owner: FakeOwner): () => void {
  const pop = pushZoomOwner(owner);
  pops.push(pop);
  return pop;
}

beforeEach(() => {
  setPlatform("MacIntel");
  useSettingsStore.setState({ zoomLevel: 1 });
  pops = [];
  fake = makeOwner();
  renderHook(() => useZoom(null));
  push(fake);
});
afterEach(() => {
  // The owner stack is module-level — a leftover owner would capture every later test's zoom.
  for (const pop of pops) pop();
  // A gesture a test left open would keep suppressing ctrl+wheel in the next one.
  fireGesture("gestureend", 1);
  setPlatform(realPlatform);
  useSettingsStore.setState({ zoomLevel: 1 });
});

describe("§396 zoom owner routing", () => {
  it("Mod+= goes to the owner and leaves the editor zoom", () => {
    press({ key: "=", metaKey: true });
    expect(fake.calls).toEqual([[1.25, null]]);
    expect(zoom()).toBe(1);
  });

  it("Mod+- and Mod+0 too", () => {
    press({ key: "-", metaKey: true });
    expect(fake.calls).toEqual([[0.9, null]]);
    // Away from 1, so Mod+0's setScale(1) cannot pass as setScale(getScale()).
    fake.scale = 3;
    press({ key: "0", metaKey: true });
    expect(fake.calls).toEqual([
      [0.9, null],
      [1, null],
    ]);
    expect(zoom()).toBe(1);
  });

  it("ctrl+wheel carries the pointer as the anchor", () => {
    fireCtrlWheel(-100, { clientX: 30, clientY: 40 });
    expect(fake.calls[0][0]).toBeCloseTo(Math.exp(0.5), 10);
    expect(fake.calls[0][1]).toEqual({ clientX: 30, clientY: 40 });
    expect(zoom()).toBe(1);
  });

  it("a pinch multiplies the owner's scale at gesturestart", () => {
    fake.scale = 2;
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5, { clientX: 5, clientY: 6 });
    expect(fake.calls.at(-1)).toEqual([3, { clientX: 5, clientY: 6 }]);
    // e.scale is cumulative from gesturestart: 2 × 1.6. Re-reading the owner's scale on each
    // change would compound it, 3 × 1.6 = 4.8.
    fireGesture("gesturechange", 1.6, { clientX: 5, clientY: 6 });
    expect(fake.calls.at(-1)?.[0]).toBeCloseTo(3.2, 10);
    expect(zoom()).toBe(1);
  });

  it("a gesture event without finite coordinates anchors at null", () => {
    fireGesture("gesturestart", 1);
    fireGesture("gesturechange", 1.5);
    expect(fake.calls.at(-1)).toEqual([1.5, null]);
    fireGesture("gesturechange", 1.6, { clientX: Number.NaN, clientY: 3 });
    expect(fake.calls.at(-1)).toEqual([1.6, null]);
  });

  it("when the owner leaves mid-gesture the rest of the gesture goes nowhere", () => {
    const pop = pops[0];
    fireGesture("gesturestart", 1);
    pop();
    fireGesture("gesturechange", 1.5);
    expect(fake.calls).toEqual([]);
    expect(zoom()).toBe(1);
    // Back on the stack, the same gesture still stays dropped until the next gesturestart.
    push(fake);
    fireGesture("gesturechange", 1.6);
    expect(fake.calls).toEqual([]);
    expect(zoom()).toBe(1);
  });

  it("a gesture that began on the editor ignores an owner that appears mid-gesture", () => {
    pops[0]();
    fireGesture("gesturestart", 1);
    push(fake);
    fireGesture("gesturechange", 1.5);
    expect(fake.calls).toEqual([]);
    expect(zoom()).toBe(1);
  });

  it("zoomByWheel (the HTML preview's path) routes with a null anchor", () => {
    zoomByWheel(-100);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0][0]).toBeCloseTo(Math.exp(0.5), 10);
    expect(fake.calls[0][1]).toBeNull();
    expect(zoom()).toBe(1);
  });

  it("the top of two owners receives", () => {
    const top = makeOwner();
    push(top);
    press({ key: "=", metaKey: true });
    expect(top.calls).toEqual([[1.25, null]]);
    expect(fake.calls).toEqual([]);
  });

  it("with no owner the editor zooms (pair of the first test)", () => {
    for (const pop of pops) pop();
    press({ key: "=", metaKey: true });
    expect(zoom()).toBeCloseTo(1.1, 4);
  });
});
