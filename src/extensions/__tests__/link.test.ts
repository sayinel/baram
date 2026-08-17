// §278.1 Link mark 클릭 라우팅 — 앱 내 열기 vs OS opener.
//
// ‼️ 이 스위트는 **진짜 Tiptap 에디터에 진짜 mousedown을 보낸다.** 라우팅 함수를
// 직접 부르면 셋 중 무엇도 검증되지 않는다: 렌더된 `<a>`가 실제로 잡히는지,
// ProseMirror가 mousedown을 우리 핸들러까지 흘리는지, meta 키 게이트가 맞는지.
// 우리를 여기까지 오게 한 결함(§278의 인라인 링크 누수)이 정확히 그 층에 있었다.
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import { Link } from "../marks/link";
import { Paragraph } from "../nodes/paragraph";

/** 렌더된 앵커에 Cmd 누른 mousedown. 실제 사용자 동작과 같은 경로. */
function cmdClickAnchor(element: HTMLElement): boolean {
  const anchor = element.querySelector("a");
  if (!anchor) throw new Error("link mark did not render an <a> element");
  return !anchor.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    }),
  );
}

/** 링크 하나를 담은 에디터. `onNavigateLocal`이 무엇을 반환할지 지정한다. */
function mountLink(href: string, handled: boolean) {
  const onNavigateLocal = vi.fn(() => handled);
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    content: `<p><a href="${href}">label</a></p>`,
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Link.configure({ onNavigateLocal }),
    ],
  });
  return { editor, element, onNavigateLocal };
}

beforeEach(() => {
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
  logger.error.mockClear();
  document.body.innerHTML = "";
});

describe("§278.1 scheme-less hrefs are offered to the app first", () => {
  it("does NOT reach the OS opener when the app handles the href", () => {
    // 이것이 회귀 테스트다: 예전 isLocalFileLink는 .md만 인정해
    // `[label](Paper.pdf)`를 곧장 openUrl로 넘겼다.
    const { element, onNavigateLocal } = mountLink("Paper.pdf", true);
    const prevented = cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("Paper.pdf");
    expect(openUrl).not.toHaveBeenCalled();
    expect(prevented).toBe(true);
  });

  it("falls back to the OS opener when the app declines the href", () => {
    // 스킴 없는 외부 주소(www.example.com)가 계속 열리는 이유.
    const { element, onNavigateLocal } = mountLink("www.example.com", false);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("www.example.com");
    expect(openUrl).toHaveBeenCalledWith("www.example.com");
  });

  it("offers a markdown href to the app, exactly as before", () => {
    const { element, onNavigateLocal } = mountLink("sub/doc.md", true);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("sub/doc.md");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("§278.1 hrefs the app is never asked about", () => {
  it("sends an http URL straight to the OS opener", () => {
    const { element, onNavigateLocal } = mountLink(
      "https://example.com/a",
      true,
    );
    cmdClickAnchor(element);

    // handled=true인데도 호출되지 않아야 한다 — 스킴이 있으면 질문 자체를 안 한다.
    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("sends a mailto URL straight to the OS opener", () => {
    const { element, onNavigateLocal } = mountLink("mailto:a@b.com", true);
    cmdClickAnchor(element);

    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("mailto:a@b.com");
  });

  it("keeps a #fragment in the document even when the app declines it", () => {
    // ‼️ 프래그먼트는 이 문서 자신을 가리킨다. 반환값과 무관하게 openUrl로
    // 새면 안 된다 — 네비게이션이 전부 no-op인 §89 단독 창에서 실제로 난다.
    const { element, onNavigateLocal } = mountLink("#heading", false);
    cmdClickAnchor(element);

    expect(onNavigateLocal).toHaveBeenCalledWith("#heading");
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("§278.1 the click gate itself", () => {
  it("ignores a plain click — no modifier, no navigation", () => {
    const { element, onNavigateLocal } = mountLink("Paper.pdf", true);
    const anchor = element.querySelector("a");
    anchor?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(onNavigateLocal).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("defaults to declining, so an unconfigured editor still opens URLs", () => {
    // createBaramExtensions의 기본값이 바뀌면 여기서 걸린다.
    const element = document.createElement("div");
    document.body.appendChild(element);
    new Editor({
      content: `<p><a href="www.example.com">label</a></p>`,
      element,
      extensions: [Document, Paragraph, Text, Link],
    });
    cmdClickAnchor(element);

    expect(openUrl).toHaveBeenCalledWith("www.example.com");
  });
});
