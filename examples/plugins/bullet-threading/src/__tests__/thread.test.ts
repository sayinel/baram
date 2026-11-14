// Real prosemirror-model with a minimal list schema — not the app's. A third-party
// plugin cannot import Baram's internals, so neither do its tests; what this file pins
// is the position arithmetic, which is prosemirror's and the same everywhere.
import { Schema } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { ancestorRungs, rungLists } from "../thread";

const schema = new Schema({
  nodes: {
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    doc: { content: "block+" },
    listItem: { content: "paragraph block*" },
    paragraph: { content: "text*", group: "block" },
    taskItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    text: {},
  },
});

const { blockquote, bulletList, doc, listItem, paragraph, taskItem, taskList } =
  schema.nodes;
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

describe("rungLists", () => {
  /** The list each span covers, checked to be the one holding the rung beside it. */
  function listsOf(d: ReturnType<typeof doc.create>, text: string) {
    const $pos = resolveIn(d, text);
    const rungs = ancestorRungs($pos);
    const lists = rungLists($pos, rungs);
    expect(lists).toHaveLength(rungs.length);
    return lists.map((list, i) => {
      const node = d.nodeAt(list.from);
      // The span is that node's, end to end — a span one token off would decorate a
      // different node, or be dropped by DecorationSet.create without a word.
      expect(list.to).toBe(list.from + (node?.nodeSize ?? 0));
      // ...and it is the very node the rung's position sits in, not merely a list.
      expect(node).toBe(d.resolve(rungs[i].from).parent);
      return node?.type.name;
    });
  }

  it("returns the list holding each rung, outermost first", () => {
    const inner = listItem.create(null, [p("c")]);
    const mid = listItem.create(null, [p("b"), bulletList.create(null, [inner])]);
    const outer = listItem.create(null, [p("a"), bulletList.create(null, [mid])]);
    const d = doc.create(null, [bulletList.create(null, [outer])]);
    expect(listsOf(d, "c")).toEqual(["bulletList", "bulletList", "bulletList"]);
  });

  it("returns a task item's list", () => {
    const child = taskItem.create(null, [p("t")]);
    const parent = taskItem.create(null, [p("parent"), taskList.create(null, [child])]);
    const d = doc.create(null, [taskList.create(null, [parent])]);
    expect(listsOf(d, "t")).toEqual(["taskList", "taskList"]);
  });

  it("returns a list wherever it sits, leaving the shape to the stylesheet", () => {
    // `:has(> li.bt-thread)` found this list too, inside a blockquote of the item above. The
    // selector's two forms, `li > :is(ul, ol)` and `li > div > :is(ul, ol)`, are what left
    // it out — a `<blockquote>` is not a `div` — and still do.
    const child = listItem.create(null, [p("quoted")]);
    const parent = listItem.create(null, [
      p("parent"),
      blockquote.create(null, [bulletList.create(null, [child])]),
    ]);
    const d = doc.create(null, [bulletList.create(null, [parent])]);
    expect(listsOf(d, "quoted")).toEqual(["bulletList", "bulletList"]);
  });

  it("is empty outside a list", () => {
    const $pos = resolveIn(doc.create(null, [p("plain")]), "plain");
    expect(rungLists($pos, ancestorRungs($pos))).toEqual([]);
  });
});
