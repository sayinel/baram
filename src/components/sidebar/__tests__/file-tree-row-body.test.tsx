// §395 spec 0074 D5 · D8 · §5.1 — what a decorated row draws: the plugin icon in place of the default
// one, badges as chips before the git dot, the hover text naming each plugin, and the file name untouched.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetFileDecorations,
  applyDecorations,
} from "../../../plugins/file-decorations/file-decoration-store";
import {
  __resetFileIcons,
  defineIcon,
} from "../../../plugins/file-decorations/icons";
import { FileTreeRowBody } from "../file-tree-row-body";

const noop = () => {};

function row(
  path = "/v/a.md",
  git: "added" | "changes" | "modified" | null = "modified",
) {
  return render(
    <FileTreeRowBody
      entry={{ isDir: false, name: "a.md", path }}
      git={git}
      inputRef={{ current: null }}
      isRenaming={false}
      onCancelRename={noop}
      onConfirmRename={noop}
      onStartRename={noop}
    />,
  );
}

afterEach(() => {
  __resetFileDecorations();
  __resetFileIcons();
});

describe("FileTreeRowBody (D8)", () => {
  it("draws an undecorated row as before: default icon, name, git dot, no title", () => {
    const { container } = row();
    const body = container.querySelector(".file-tree-row-body")!;
    expect(body.getAttribute("title")).toBeNull();
    expect(body.querySelector(".file-tree-name")?.textContent).toBe("a.md");
    expect(body.querySelector(".file-tree-git-badge-modified")).not.toBeNull();
    expect(body.querySelector(".file-tree-plugin-badge")).toBeNull();
  });

  /** What fails this: badges after the git dot, a title missing the plugin whose badge is cut, an
   *  icon that is not hidden from assistive technology, or a colour reaching the file name. */
  it("draws icon, chips before the git dot, and the plugin lines as the title", () => {
    act(() => {
      applyDecorations("a-plug", "A", [
        {
          decoration: { badge: "1", color: "red", icon: { glyph: "★" } },
          where: { absolute: "/v/a.md" },
        },
      ]);
      applyDecorations("b-plug", "B", [
        { decoration: { badge: "2" }, where: { absolute: "/v/a.md" } },
      ]);
      applyDecorations("c-plug", "C", [
        {
          decoration: { badge: "3", tooltip: "third" },
          where: { absolute: "/v/a.md" },
        },
      ]);
    });
    const { container } = row();
    const body = container.querySelector(".file-tree-row-body")!;
    expect(body.getAttribute("title")).toBe("A: 1\nB: 2\nC: third");
    const end = body.querySelector(".file-tree-row-end")!;
    expect([...end.children].map((c) => c.className)).toEqual([
      "file-tree-plugin-badge",
      "file-tree-plugin-badge",
      "file-tree-git-badge file-tree-git-badge-modified",
    ]);
    const [first, second] = end.querySelectorAll(".file-tree-plugin-badge");
    expect(first?.getAttribute("aria-label")).toBe("A: 1");
    expect((first as HTMLElement).style.color).toBe(
      "var(--color-status-danger)",
    );
    expect(second?.getAttribute("aria-label")).toBe("B: 2");
    const glyph = body.querySelector(".file-tree-plugin-glyph")!;
    expect(glyph.textContent).toBe("★");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    const name = body.querySelector(".file-tree-name") as HTMLElement;
    expect(name.textContent).toBe("a.md");
    expect(name.getAttribute("style")).toBeNull();
  });

  it("draws an svg icon as the host's mask class, painted in the decoration's colour", () => {
    act(() => {
      defineIcon("p", "star", "<svg><path d='M0 0'/></svg>");
      applyDecorations("p", "P", [
        {
          decoration: { color: "#a1b2c3", icon: { svg: "star" } },
          where: { absolute: "/v/a.md" },
        },
      ]);
    });
    const { container } = row();
    const mask = container.querySelector(
      ".file-tree-plugin-mask",
    ) as HTMLElement;
    expect(mask.className).toMatch(/^file-tree-plugin-mask fd-icon-\d+$/u);
    expect(mask.style.backgroundColor).toBe("rgb(161, 178, 195)");
  });

  it("finds a Windows path's decoration under the folded key", () => {
    act(() => {
      applyDecorations("p", "P", [
        { decoration: { badge: "1" }, where: { absolute: "C:/v/a.md" } },
      ]);
    });
    const { container } = row("C:\\v\\a.md", null);
    expect(
      container.querySelector(".file-tree-plugin-badge")?.textContent,
    ).toBe("1");
  });
});
