// §394 spec 0073 D10 · D17 · D8 ⑥ — the element a rendered block draws into, and drawing.
import { describe, expect, it } from "vitest";

import { createRenderedHost, drawRendered } from "../rendered-body";
import { sanitizePluginMarkup } from "../sanitize-markup";

describe("createRenderedHost", () => {
  /** What fails this: a closed shadow root (export reads `host.shadowRoot`, D12), a host the
   *  editor could put a caret in (D17), or a host without the vim island marker (P17). */
  it("is a non-editable, vim-suspending host with an open shadow root", () => {
    const { host, shadow } = createRenderedHost();
    expect(host.classList.contains("plugin-block-host")).toBe(true);
    expect(host.getAttribute("contenteditable")).toBe("false");
    expect(host.hasAttribute("data-vim-suspend")).toBe(true);
    expect(host.shadowRoot).toBe(shadow);
    expect(shadow.mode).toBe("open");
  });
});

describe("drawRendered", () => {
  /** What fails this: appending the cached fragment itself — the second draw of the same cached
   *  result would find it empty, because `append` moves a fragment's children. */
  it("draws a clone, so one cached result can be drawn again", () => {
    const content = {
      css: "",
      fragment: sanitizePluginMarkup("<p>x</p>").fragment,
    };
    const first = createRenderedHost();
    const second = createRenderedHost();
    drawRendered(first.shadow, content);
    drawRendered(second.shadow, content);
    expect(first.shadow.querySelector("p")?.textContent).toBe("x");
    expect(second.shadow.querySelector("p")?.textContent).toBe("x");
    expect(content.fragment.childNodes.length).toBe(1);
  });

  /** The CSS goes into THIS shadow root as one `<style>` and nowhere else — the document's
   *  stylesheets do not change. The isolation itself is the browser's (shadow DOM scoping). */
  it("puts the CSS in the shadow root only, and no style element when there is none", () => {
    const { shadow } = createRenderedHost();
    const before = document.querySelectorAll("style").length;
    drawRendered(shadow, {
      css: "p{color:red}",
      fragment: sanitizePluginMarkup("<p>x</p>").fragment,
    });
    expect(shadow.querySelector("style")?.textContent).toBe("p{color:red}");
    expect(document.querySelectorAll("style").length).toBe(before);
    drawRendered(shadow, {
      css: "",
      fragment: sanitizePluginMarkup("<p>y</p>").fragment,
    });
    expect(shadow.querySelector("style")).toBeNull();
    expect(shadow.querySelector("p")?.textContent).toBe("y");
  });
});
