// §278.1 인라인 링크 `[label](target)`의 경로 해석.
import { describe, expect, it } from "vitest";

import {
  isMarkdownHref,
  planLocalLinkNavigation,
  resolveLocalLinkTarget,
} from "../local-link-nav";

const SOURCE_DIR = "/vault/notes";

/** 이름만 다른 파일 여러 개 — 한 후보만 맞는 픽스처는 어떤 규칙도 고정 못 한다. */
const TREE = [
  { path: "/vault/notes/Paper.pdf" },
  { path: "/vault/notes/My Paper.pdf" },
  { path: "/vault/notes/50% off.md" },
  { path: "/vault/notes/sub/Nested.pdf" },
  { path: "/vault/papers/Attention.pdf" },
  { path: "/vault/notes/guide.md" },
  { path: "/vault/Root.png" },
];

describe("§278.1 resolveLocalLinkTarget", () => {
  it("resolves a sibling PDF — the case §278 left leaking to openUrl", () => {
    expect(resolveLocalLinkTarget("Paper.pdf", SOURCE_DIR, TREE)).toBe(
      "/vault/notes/Paper.pdf",
    );
  });

  it("resolves any extension in the tree, with no allowlist to update", () => {
    // §69가 뷰어 타입을 더해도 이 테스트가 그대로 통과해야 한다 — 확장자를
    // 열거하는 구현으로 되돌리면 .png가 먼저 깨진다.
    expect(resolveLocalLinkTarget("../Root.png", SOURCE_DIR, TREE)).toBe(
      "/vault/Root.png",
    );
  });

  it("walks ../ out of the source directory", () => {
    expect(
      resolveLocalLinkTarget("../papers/Attention.pdf", SOURCE_DIR, TREE),
    ).toBe("/vault/papers/Attention.pdf");
  });

  it("normalises ./ and redundant segments rather than passing them through", () => {
    // 정규화하지 않으면 "/vault/notes/./sub/../sub/Nested.pdf"가 되어 트리의
    // 어떤 항목과도 문자열이 같지 않다 — 열려도 탭 중복이 생긴다.
    expect(
      resolveLocalLinkTarget("./sub/../sub/Nested.pdf", SOURCE_DIR, TREE),
    ).toBe("/vault/notes/sub/Nested.pdf");
  });

  it("decodes a percent-encoded name (how other editors write spaces)", () => {
    expect(resolveLocalLinkTarget("My%20Paper.pdf", SOURCE_DIR, TREE)).toBe(
      "/vault/notes/My Paper.pdf",
    );
  });

  it("keeps a literal % in a filename — decoding it would throw", () => {
    // decodeURIComponent("50% off.md")는 URIError를 던진다. 원본 후보가 함께
    // 있어야만 이 파일이 열린다.
    expect(resolveLocalLinkTarget("50% off.md", SOURCE_DIR, TREE)).toBe(
      "/vault/notes/50% off.md",
    );
  });

  it("prefers the raw form over the decoded one when both name real files", () => {
    const both = [
      { path: "/vault/notes/a%2Fb.md" },
      { path: "/vault/notes/a/b.md" },
    ];
    expect(resolveLocalLinkTarget("a%2Fb.md", SOURCE_DIR, both)).toBe(
      "/vault/notes/a%2Fb.md",
    );
  });

  it("reads a leading / as an OS absolute path, not as a suffix of the source dir", () => {
    expect(
      resolveLocalLinkTarget("/vault/papers/Attention.pdf", SOURCE_DIR, TREE),
    ).toBe("/vault/papers/Attention.pdf");
  });

  it("returns null for a scheme-less external address", () => {
    // 이것이 openUrl 폴백을 살려 두는 유일한 근거다.
    expect(resolveLocalLinkTarget("www.example.com", SOURCE_DIR, TREE)).toBe(
      null,
    );
  });

  it("returns null when the file simply is not there", () => {
    expect(resolveLocalLinkTarget("Missing.pdf", SOURCE_DIR, TREE)).toBe(null);
  });

  it("returns null for a relative target with no source directory", () => {
    expect(resolveLocalLinkTarget("Paper.pdf", null, TREE)).toBe(null);
  });

  it("still resolves an absolute target with no source directory", () => {
    expect(resolveLocalLinkTarget("/vault/notes/Paper.pdf", null, TREE)).toBe(
      "/vault/notes/Paper.pdf",
    );
  });

  it("returns null on an empty tree", () => {
    expect(resolveLocalLinkTarget("Paper.pdf", SOURCE_DIR, [])).toBe(null);
  });

  describe("case handling", () => {
    it("falls back to a case-insensitive match", () => {
      expect(resolveLocalLinkTarget("paper.PDF", SOURCE_DIR, TREE)).toBe(
        "/vault/notes/Paper.pdf",
      );
    });

    it("lets an exact match win over a case-insensitive one", () => {
      // 대소문자 구분 파일시스템에서 두 파일이 공존할 수 있다. 케이스 무시
      // 조회가 먼저 돌면 목록 순서에 따라 엉뚱한 쪽이 열린다.
      const both = [
        { path: "/vault/notes/paper.pdf" },
        { path: "/vault/notes/Paper.pdf" },
      ];
      expect(resolveLocalLinkTarget("Paper.pdf", SOURCE_DIR, both)).toBe(
        "/vault/notes/Paper.pdf",
      );
    });
  });
});

describe("§278.1 isMarkdownHref", () => {
  it.each([
    ["guide.md", true],
    ["guide.markdown", true],
    ["GUIDE.MD", true],
    ["sub/guide.md", true],
    ["Paper.pdf", false],
    ["www.example.com", false],
    ["notes", false],
    // ‼️ 예전 isLocalFileLink는 `#fragment`가 붙은 href 전체를 봤다. 호출부가
    // 먼저 잘라서 넘기므로 여기서는 확장자로 끝나야 한다.
    ["guide.md#section", false],
  ])("%s → %s", (href, expected) => {
    expect(isMarkdownHref(href)).toBe(expected);
  });
});

// §278.1 결정 자체 — 스토어도 에디터도 없이 직접 단정한다. 훅을 통과시키면
// `claimed`와 "열지 않았다"가 같은 관찰로 뭉개져서 서로 구별되지 않는다.
describe("§278.1 planLocalLinkNavigation", () => {
  it("claims and opens a file that exists", () => {
    expect(planLocalLinkNavigation("Paper.pdf", SOURCE_DIR, TREE)).toEqual({
      claimed: true,
      scrollHeading: null,
      target: "/vault/notes/Paper.pdf",
    });
  });

  it("declines a non-markdown href that resolves to nothing", () => {
    expect(
      planLocalLinkNavigation("www.example.com", SOURCE_DIR, TREE),
    ).toEqual({ claimed: false, scrollHeading: null, target: null });
  });

  it("claims a missing markdown href AND still names a target to open", () => {
    expect(planLocalLinkNavigation("gone.md", SOURCE_DIR, TREE)).toEqual({
      claimed: true,
      scrollHeading: null,
      target: "/vault/notes/gone.md",
    });
  });

  it("claims a markdown href with nothing to open when there is no source dir", () => {
    // ‼️ claimed=true 인데 target=null 인 유일한 조합. 훅 밖에서만 구별된다 —
    // 이 둘이 뭉개지면 §89 단독 창의 계약이 검증되지 않는다.
    expect(planLocalLinkNavigation("gone.md", null, TREE)).toEqual({
      claimed: true,
      scrollHeading: null,
      target: null,
    });
  });

  it("carries a fragment for a markdown target", () => {
    expect(
      planLocalLinkNavigation("guide.md#my-section", SOURCE_DIR, TREE),
    ).toEqual({
      claimed: true,
      scrollHeading: "my section",
      target: "/vault/notes/guide.md",
    });
  });

  it("drops a fragment on a viewer target", () => {
    expect(
      planLocalLinkNavigation("Paper.pdf#page=3", SOURCE_DIR, TREE),
    ).toEqual({
      claimed: true,
      scrollHeading: null,
      target: "/vault/notes/Paper.pdf",
    });
  });

  it("truncates a fragment at a second # — pre-existing, pinned not endorsed", () => {
    // `split("#", 2)`의 limit은 나머지를 이어붙이지 않고 **버린다**. §278.1
    // 이전부터의 동작이라 여기서 바꾸지 않았다. CommonMark대로라면 첫 `#`
    // 뒤 전체가 프래그먼트이므로 "a b#c"가 맞다. dev/backlog.md에 적어 뒀다.
    expect(
      planLocalLinkNavigation("guide.md#a-b#c", SOURCE_DIR, TREE).scrollHeading,
    ).toBe("a b");
  });
});
