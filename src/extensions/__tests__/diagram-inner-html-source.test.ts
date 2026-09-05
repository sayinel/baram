// issue 549 — no node view hands React a fresh `{ __html }` object.
//
// React 19 compares the dangerouslySetInnerHTML prop by identity and re-seeds
// innerHTML for every new object, so an inline literal — or a variable built
// as a literal each render, or a memoised wrapper spread into a new object on
// its way through a prop — re-parses the svg on every render. The views call
// use-inner-html.ts AT the injection sink instead. Two layers:
//
// 1. An INVARIANT over every production .tsx under src/extensions/nodes, read
//    through the TypeScript AST (helpers/inner-html-sites.ts) rather than
//    matched as text, so spacing, line breaks, spreads and name collisions
//    cannot hide a site: each dangerouslySetInnerHTML value must be a const
//    bound to `useInnerHtml(…)` in the SAME function as the JSX.
//    html-block-view.tsx's one deliberate literal is the sole exception. A
//    ninth site in a NEW file (say the svg modals extracted to their own
//    file) is covered without anyone editing this test.
// 2. An INVENTORY of today's sites per file, so a site that disappears — or a
//    file that stops injecting at all — is noticed, not silently accepted.
//
// The fixtures at the top are the analyser's spec: each is a way a site could
// try to slip past, and each must be caught.
//
// The deliberate literal is html-block-view.tsx's HtmlBlockRender, which
// RELIES on the per-render re-seed (its dependency-less layout effect rewrites
// media src on the injected DOM and must run on the same cadence). It is pinned
// at exactly one so a well-meant "cleanup" trips this gate and reads that
// comment first.
//
// ‼️ LIMIT: resolution is lexical, by declaration shape, without the type
// checker. A `useInnerHtml` that is not the real hook (shadowed, or another
// function under that name) passes. Element creation that is neither JSX nor
// a call named `createElement` (an aliased import of it, a custom factory) is
// not seen. Everything the analyser cannot see INTO fails closed as "opaque"
// and must appear in the reviewed list below — each entry was read by hand and
// carries no dangerouslySetInnerHTML. diagram-inner-html-stable.test.tsx
// proves the DOM for today's sites.
import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

import { sitesOfSource } from "./helpers/inner-html-sites";

const NODES_DIR = "src/extensions/nodes";
const HTML_BLOCK_VIEW = "src/extensions/nodes/html-block-view.tsx";

function origins(source: string): string[] {
  return sitesOfSource("fixture.tsx", source).map((s) => s.origin);
}

/** Every production .tsx under `dir`, recursively, tests excluded. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Repository-relative, forward-slash paths on every platform: they are
    // compared against the string keys below.
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...tsxFiles(path));
    } else if (entry.name.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out.sort();
}

describe("the analyser (issue 549)", () => {
  it("accepts a const bound to the hook in the same function", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return <div dangerouslySetInnerHTML={markup} />;
        }`),
    ).toEqual(["memo"]);
  });

  it("flags an inline literal however it is spaced", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          return <div dangerouslySetInnerHTML = {{ __html: svg }} />;
        }`),
    ).toEqual(["literal"]);
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          return <div dangerouslySetInnerHTML={
            { __html: svg }
          } />;
        }`),
    ).toEqual(["literal"]);
  });

  it("flags a fresh object under a memo-like name", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const svgMarkup = { __html: svg };
          return <div dangerouslySetInnerHTML={svgMarkup} />;
        }`),
    ).toEqual(["other"]);
  });

  it("resolves the name lexically, so another component's hook does not certify it", () => {
    expect(
      origins(`
        function A({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return <div dangerouslySetInnerHTML={markup} />;
        }
        function B({ svg }: { svg: string }) {
          const markup = { __html: svg };
          return <div dangerouslySetInnerHTML={markup} />;
        }`),
    ).toEqual(["memo", "other"]);
  });

  it("flags a wrapper that arrived as a prop, renamed or not", () => {
    expect(
      origins(`
        function View({ svgMarkup }: { svgMarkup: InnerHtml }) {
          return <div dangerouslySetInnerHTML={svgMarkup} />;
        }
        function Renamed({ svgMarkup: markup }: { svgMarkup: InnerHtml }) {
          return <div dangerouslySetInnerHTML={markup} />;
        }`),
    ).toEqual(["other", "other"]);
  });

  it("flags a copy, a call and a hook bound in an outer function", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          const Inner = () => <div dangerouslySetInnerHTML={markup} />;
          return <>
            <div dangerouslySetInnerHTML={{ ...markup }} />
            <div dangerouslySetInnerHTML={Object.assign({}, markup)} />
            <Inner />
          </>;
        }`),
    ).toEqual(["other", "literal", "other"]);
  });

  it("looks inside spreads: inline, through a const; a helper call is opaque", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          return <div {...{ dangerouslySetInnerHTML: { __html: svg } }} />;
        }`),
    ).toEqual(["literal"]);
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const props = { className: "x", dangerouslySetInnerHTML: { __html: svg } };
          return <div {...props} />;
        }`),
    ).toEqual(["literal"]);
    expect(
      origins(`
        function markupProps(svg: string) {
          return { dangerouslySetInnerHTML: { __html: svg } };
        }
        function View({ svg }: { svg: string }) {
          return <div {...markupProps(svg)} />;
        }`),
    ).toEqual(["opaque"]);
  });

  it("lets a spread through only when it is proven not to carry the attribute", () => {
    expect(
      origins(`
        function View() {
          const rowProps = { className: "row", ...{ id: "r" } };
          return <div {...rowProps} />;
        }`),
    ).toEqual([]);
  });

  it("does not trust a const object that is touched anywhere but a spread", () => {
    expect(
      origins(`
        function Mutated({ svg }: { svg: string }) {
          const props: { dangerouslySetInnerHTML?: { __html: string } } = {};
          props.dangerouslySetInnerHTML = { __html: svg };
          return <div {...props} />;
        }
        function Assigned({ svg }: { svg: string }) {
          const props = { className: "x" };
          Object.assign(props, { dangerouslySetInnerHTML: { __html: svg } });
          return <div {...props} />;
        }
        function Escaped({ svg }: { svg: string }) {
          const props = { className: "x" };
          decorate(props, svg);
          return <div {...props} />;
        }
        function Twice() {
          const props = { className: "x" };
          return <><div {...props} /><span {...props} /></>;
        }`),
    ).toEqual(["opaque", "opaque", "opaque"]);
  });

  it("grants the createElement exception only to React's own import", () => {
    expect(
      origins(`
        import React, { createElement } from "react";
        type P = { dangerouslySetInnerHTML?: { __html: string } };
        function Real({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          const props = { dangerouslySetInnerHTML: markup };
          return <>{createElement("div", props)}{React.createElement("div", props)}</>;
        }
        function createElementLocal(_tag: string, p: P) { p.dangerouslySetInnerHTML = { __html: "<svg/>" }; }
        function Local() {
          const props: P = {};
          createElementLocal("mutator", props);
          return <div {...props} />;
        }`),
    ).toEqual(["memo", "memo", "opaque"]);
    // The same name, but not React's: an ordinary call that may mutate.
    expect(
      origins(`
        type P = { dangerouslySetInnerHTML?: { __html: string } };
        function createElement(_tag: string, p: P) { p.dangerouslySetInnerHTML = { __html: "<svg/>" }; }
        function View() {
          const props: P = {};
          createElement("mutator", props);
          return <div {...props} />;
        }`),
    ).toEqual(["opaque"]);
  });

  it("resolves var as function-scoped, hoisted out of nested blocks", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const props = { className: "safe" };
          function Inner() {
            { var props = { dangerouslySetInnerHTML: { __html: svg } }; }
            return <div {...props} />;
          }
          return <Inner />;
        }
        function Loop({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          for (var markup = { __html: svg }; ; ) {
            return <div dangerouslySetInnerHTML={markup} />;
          }
        }`),
    ).toEqual(["opaque", "other"]);
  });

  it("never proves a literal with a getter absent — a getter runs on spread", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const props = {
            get className() {
              Object.defineProperty(this, "dangerouslySetInnerHTML", { enumerable: true, value: { __html: svg } });
              return "x";
            },
          };
          return <><div {...props} /><div {...props} /></>;
        }`),
    ).toEqual(["opaque", "opaque"]);
  });

  it("keeps a literal poisoned by a getter even when the attribute is set later", () => {
    expect(
      origins(`
        function Before({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          const props = {
            get className() {
              Object.defineProperty(this, "dangerouslySetInnerHTML", { enumerable: true, configurable: true, writable: true, value: { __html: svg } });
              return "x";
            },
            dangerouslySetInnerHTML: markup,
          };
          return <div {...props} />;
        }
        function After({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return <div {...{ dangerouslySetInnerHTML: markup, get className() { return "x"; } }} />;
        }`),
    ).toEqual(["opaque", "opaque"]);
  });

  it("binds a named function expression's own name inside its body", () => {
    expect(
      origins(`
        import { createElement } from "react";
        type P = { dangerouslySetInnerHTML?: { __html: string } };
        function View({ svg }: { svg: string }) {
          return (function createElement(_tag: string, p?: P) {
            if (p) { p.dangerouslySetInnerHTML = { __html: svg }; return <span />; }
            const props: P = {};
            createElement("mutate", props);
            return <div {...props} />;
          })("start");
        }`),
    ).toEqual(["opaque"]);
  });

  it("applies spread precedence in source order — the last write wins", () => {
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return <div {...{ dangerouslySetInnerHTML: markup, ...{ dangerouslySetInnerHTML: { __html: svg } } }} />;
        }`),
    ).toEqual(["literal"]);
    expect(
      origins(`
        function View({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return <div {...{ ...{ dangerouslySetInnerHTML: { __html: svg } }, dangerouslySetInnerHTML: markup }} />;
        }`),
    ).toEqual(["memo"]);
  });

  it("fails closed on a spread it cannot see into", () => {
    // A parameter (its type could carry the attribute), a call through a
    // member, a non-const, a nested spread of an unresolved name, a computed
    // key — none can be proven absent, so each is a site to be reviewed.
    expect(
      origins(`
        type P = { dangerouslySetInnerHTML: { __html: string } };
        function Sink(props: P) {
          return <div {...props} />;
        }
        function Member({ svg }: { svg: string }) {
          return <div {...helpers.makeProps(svg)} />;
        }
        function Nested({ svg }: { svg: string }) {
          const props = { className: "x", ...unknownThing };
          return <div {...props} />;
        }
        function Mutable() {
          let props = { className: "x" };
          return <div {...props} />;
        }
        function Computed({ key }: { key: string }) {
          return <div {...{ [key]: 1 }} />;
        }`),
    ).toEqual(["opaque", "opaque", "opaque", "opaque", "opaque"]);
  });

  it("resolves loop, catch and switch-case bindings before the outer one", () => {
    expect(
      origins(`
        function Loop({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          for (const markup of [{ __html: svg }]) {
            return <div dangerouslySetInnerHTML={markup} />;
          }
          return null;
        }
        function Catch({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          try { throw { __html: svg }; } catch (markup) {
            return <div dangerouslySetInnerHTML={markup} />;
          }
        }
        function Case({ svg, n }: { svg: string; n: number }) {
          const markup = useInnerHtml(svg);
          switch (n) {
            case 1:
              const markup = { __html: svg };
              return <div dangerouslySetInnerHTML={markup} />;
          }
          return null;
        }`),
    ).toEqual(["other", "other", "other"]);
  });

  it("sees React.createElement as an injection sink too", () => {
    expect(
      origins(`
        import React, { createElement } from "react";
        function Literal({ svg }: { svg: string }) {
          return React.createElement("div", { dangerouslySetInnerHTML: { __html: svg } });
        }
        function Memo({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          return createElement("div", { className: "x", dangerouslySetInnerHTML: markup });
        }
        function Opaque(props: object) {
          return React.createElement("div", props);
        }
        function Clean() {
          return React.createElement("div", null, "text");
        }`),
    ).toEqual(["literal", "memo", "opaque"]);
  });
  it("treats an accessor or method named like the attribute as a fresh value", () => {
    expect(
      origins(`
        import React from "react";
        function Getter({ svg }: { svg: string }) {
          return React.createElement("div", { get dangerouslySetInnerHTML() { return { __html: svg }; } });
        }
        function Method({ svg }: { svg: string }) {
          return <div {...{ dangerouslySetInnerHTML() { return { __html: svg }; } }} />;
        }
        function Computed({ svg, k }: { svg: string; k: string }) {
          return <div {...{ get [k]() { return { __html: svg }; } }} />;
        }`),
    ).toEqual(["other", "other", "opaque"]);
  });

  it("only trusts an undefined that is the global one", () => {
    expect(
      origins(`
        import React from "react";
        function Shadowed({ svg }: { svg: string }) {
          const undefined = { dangerouslySetInnerHTML: { __html: svg } };
          return React.createElement("div", undefined);
        }
        function Clean() {
          return <>{React.createElement("div", undefined)}{React.createElement("div", void 0)}</>;
        }`),
    ).toEqual(["literal"]);
  });

  it("resolves class, enum and import bindings before an outer hook binding", () => {
    expect(
      origins(`
        import { markup as imported } from "./x";
        function Klass({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          label: {
            class markup { static __html = svg; }
            return <div dangerouslySetInnerHTML={markup} />;
          }
        }
        function Enum({ svg }: { svg: string }) {
          const markup = useInnerHtml(svg);
          { enum markup { __html } return <div dangerouslySetInnerHTML={markup} />; }
        }
        function Imported() {
          return <div dangerouslySetInnerHTML={imported} />;
        }`),
    ).toEqual(["other", "other", "other"]);
  });
});

/** Spreads the analyser cannot see into, read by hand: none carries
 *  dangerouslySetInnerHTML. `textareaProps` is use-atom-edit-session's
 *  textarea wiring (focus/blur/ref); `rowProps` is a key/click/class bundle.
 *  Exact texts per file — a new opaque spread, or one that goes away, changes
 *  this list on purpose. */
const REVIEWED_OPAQUE_SPREADS: Record<string, string[]> = {
  "src/extensions/nodes/math-block-view.tsx": ["{...textareaProps}"],
  "src/extensions/nodes/mermaid-block-view.tsx": ["{...textareaProps}"],
  "src/extensions/nodes/query-block-view.tsx": [
    "{...rowProps(file.path)}",
    "{...rowProps(file.path)}",
    "{...rowProps(file.path)}",
  ],
  "src/extensions/nodes/svg-block-view.tsx": ["{...textareaProps}"],
};

describe("node views inject markup only through the hook at the sink (issue 549)", () => {
  const files = tsxFiles(NODES_DIR);
  const sitesOf = (file: string) =>
    sitesOfSource(file, readFileSync(file, "utf8"));

  it("scans the real node-view tree, not an empty one", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain(HTML_BLOCK_VIEW);
    const total = files.reduce(
      (n, f) => n + sitesOf(f).filter((s) => s.origin !== "opaque").length,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(9);
  });

  it.each(files)("%s", (file) => {
    const sites = sitesOf(file);
    const opaque = sites
      .filter((s) => s.origin === "opaque")
      .map((s) => s.text)
      .sort();
    expect(opaque).toEqual([...(REVIEWED_OPAQUE_SPREADS[file] ?? [])].sort());
    const injecting = sites.filter((s) => s.origin !== "opaque");
    if (file === HTML_BLOCK_VIEW) {
      // The deliberate exception — exactly one literal, and it says why.
      expect(injecting.map((s) => s.origin)).toEqual(["literal"]);
      expect(readFileSync(file, "utf8")).toContain("use-inner-html");
      return;
    }
    expect(injecting.filter((s) => s.origin !== "memo")).toEqual([]);
  });

  it("lists no reviewed spread for a file that has none", () => {
    for (const file of Object.keys(REVIEWED_OPAQUE_SPREADS)) {
      expect(files).toContain(file);
    }
  });

  it.each([
    // preview, editing-state faded preview, fullscreen viewer, fullscreen
    // editor preview
    ["src/extensions/nodes/svg-block-view.tsx", 4],
    // preview, editing-state faded preview (the modals live in their own file)
    ["src/extensions/nodes/mermaid-block-view.tsx", 2],
    // fullscreen viewer, fullscreen editor preview — each memoised in place
    ["src/extensions/nodes/views/MermaidFullscreenModals.tsx", 2],
  ])("%s still injects at %i sites", (file, sites) => {
    expect(
      sitesOf(file)
        .filter((s) => s.origin !== "opaque")
        .map((s) => s.origin),
    ).toEqual(Array<string>(sites).fill("memo"));
  });
});
