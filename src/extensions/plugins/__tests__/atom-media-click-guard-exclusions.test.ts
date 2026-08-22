// §296 fix (M3, whole-branch review): the video error card had no exclusion
// in video.ts's `excludeSelectors`, so it was the only one of video's four
// render shapes that this guard's own `event.preventDefault()` on mousedown
// (below) suppressed native drag-initiation for — being unable to move or
// delete a BROKEN embed is worse than the alternative, since that's exactly
// the node a user wants to relocate.
//
// This exercises the plugin directly against a real ProseMirror EditorView
// (no React NodeView) — the guard finds its wrapper by DOM class + document
// order, not by any tiptap NodeView machinery, so a minimal `toDOM` fixture
// reproduces the real render shape exactly.
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import { createAtomMediaClickGuard } from "../atom-media-click-guard";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    video: {
      group: "block",
      atom: true,
      toDOM: () => [
        "div",
        { class: "video-node-view" },
        [
          "div",
          { class: "video-figure" },
          ["div", { class: "video-error" }, "load error"],
        ],
      ],
    },
  },
});

function setup(excludeSelectors: string[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [schema.nodes.video.create()]),
    plugins: [
      createAtomMediaClickGuard({
        nodeName: "video",
        wrapperClass: "video-node-view",
        excludeSelectors,
        excludeTagNames: ["VIDEO", "IFRAME"],
      }),
    ],
  });
  return { host, view: new EditorView(host, { state }) };
}

describe("atom media click guard — .video-error exclusion (§296 M3)", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  it("does NOT call preventDefault on a mousedown inside .video-error once it is excluded — native drag stays possible", () => {
    const setupResult = setup([".video-error"]);
    view = setupResult.view;
    const errorEl = setupResult.host.querySelector(
      ".video-error",
    ) as HTMLElement;
    expect(errorEl).not.toBeNull();

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    errorEl.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  // Mutation control: proves the assertion above actually discriminates,
  // by showing what the bug looked like — before this fix `.video-error`
  // was NOT in excludeSelectors, so the guard treated it like any other
  // in-bounds click and suppressed the native drag gesture.
  it("WOULD call preventDefault without the exclusion — this is the bug the fix closes", () => {
    const setupResult = setup([]);
    view = setupResult.view;
    const errorEl = setupResult.host.querySelector(
      ".video-error",
    ) as HTMLElement;

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    errorEl.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("still swallows a click on video/iframe-tag targets the same as before (excludeTagNames untouched)", () => {
    // Regression guard for the fix's own scope: only .video-error was added;
    // the pre-existing tag-name exclusions must keep working unchanged.
    const videoSchema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
        video: {
          group: "block",
          atom: true,
          toDOM: () => ["div", { class: "video-node-view" }, ["video", {}]],
        },
      },
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    view = new EditorView(host, {
      state: EditorState.create({
        schema: videoSchema,
        doc: videoSchema.nodes.doc.create(null, [
          videoSchema.nodes.video.create(),
        ]),
        plugins: [
          createAtomMediaClickGuard({
            nodeName: "video",
            wrapperClass: "video-node-view",
            excludeSelectors: [".video-error"],
            excludeTagNames: ["VIDEO", "IFRAME"],
          }),
        ],
      }),
    });

    const videoEl = host.querySelector("video") as HTMLElement;
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    videoEl.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
