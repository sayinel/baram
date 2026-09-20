// Real prosemirror-model with a minimal list schema — not the app's. A third-party
// plugin cannot import Baram's internals, so neither do its tests; what this file pins
// is the position arithmetic, which is prosemirror's and the same everywhere.
import { Schema } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { ancestorRungs } from "../thread";

const schema = new Schema({
  nodes: {
    bulletList: { content: "listItem+", group: "block" },
    doc: { content: "block+" },
    listItem: { content: "paragraph block*" },
    paragraph: { content: "text*", group: "block" },
    taskItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    text: {},
  },
});

const { bulletList, doc, listItem, paragraph, taskItem, taskList } = schema.nodes;
const p = (t: string) => paragraph.create(null, schema.text(t));

/** Resolve inside the first text node whose content is `text`. */
function resolveIn(node: ReturnType<typeof doc.create>, text: string) {
  let pos = -1;
  node.descendants((n, p2) => {
    if (pos === -1 && n.isText && n.text === text) pos = p2 + 1;
  });
  expect(pos, `no text node "${text}"`).toBeGreaterThan(0);
  return node.resolve(pos);
}

describe("ancestorRungs", () => {
  it("is empty outside a list — the common case must cost nothing", () => {
    expect(ancestorRungs(resolveIn(doc.create(null, [p("plain")]), "plain"))).toEqual([]);
  });

  it("returns one rung for a top-level item", () => {
    const d = doc.create(null, [bulletList.create(null, [listItem.create(null, [p("one")])])]);
    expect(ancestorRungs(resolveIn(d, "one"))).toHaveLength(1);
  });

  it("returns the whole chain, outermost first and properly nested", () => {
    const inner = listItem.create(null, [p("c")]);
    const mid = listItem.create(null, [p("b"), bulletList.create(null, [inner])]);
    const outer = listItem.create(null, [p("a"), bulletList.create(null, [mid])]);
    const d = doc.create(null, [bulletList.create(null, [outer])]);

    const rungs = ancestorRungs(resolveIn(d, "c"));
    expect(rungs).toHaveLength(3);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i].depth).toBeGreaterThan(rungs[i - 1].depth);
      // Strictly nested: each rung's span sits inside the one before it. A chain that
      // merely had three entries would pass a length check while being wrong.
      expect(rungs[i].from).toBeGreaterThan(rungs[i - 1].from);
      expect(rungs[i].to).toBeLessThan(rungs[i - 1].to);
    }
  });

  it("counts task items as rungs", () => {
    const d = doc.create(null, [taskList.create(null, [taskItem.create(null, [p("t")])])]);
    expect(ancestorRungs(resolveIn(d, "t"))).toHaveLength(1);
  });

  it("skips the list containers, counting only the items", () => {
    // bulletList sits between the items and would double every rung if the filter
    // were "any ancestor in a list" rather than "the item nodes".
    const mid = listItem.create(null, [p("b")]);
    const outer = listItem.create(null, [p("a"), bulletList.create(null, [mid])]);
    const d = doc.create(null, [bulletList.create(null, [outer])]);
    expect(ancestorRungs(resolveIn(d, "b"))).toHaveLength(2);
  });
});
