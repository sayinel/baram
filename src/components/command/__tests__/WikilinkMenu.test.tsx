import type { WikilinkSuggestionItem } from "../../../extensions/plugins/wikilink-suggest-utils";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildFileSuggestionItem } from "../../../extensions/plugins/wikilink-suggest-utils";
import { WikilinkMenuList } from "../WikilinkMenu";

/**
 * §95 자동완성 목록이 **화면에 그리는 문자열**을 고정한다.
 *
 * 왜 별도 테스트가 필요한가: 데이터 계층(`buildFileSuggestionItem`)이 제텔 노트에
 * `label = 제목`을 넣는다는 단정은 이미 있었고 계속 초록이었다. 그런데 메뉴는
 * `label`을 무시하고 `target`(= ID)을 그리고 있었다 — 설계 §95의 "사용자는 ID를
 * 타이핑/열람하지 않음"이 목록에서만 깨져 있었고, 그것을 보는 테스트가 없었다.
 *
 * ‼️ 파일 행 픽스처는 손으로 만들지 않고 `buildFileSuggestionItem`으로 만든다.
 * 손으로 만들면 `label`과 `target`을 같게 적기 쉬운데, 그러면 둘 중 무엇을 그리든
 * 통과해서 이 파일이 지키려는 바로 그 구분이 사라진다.
 */
function renderMenu(items: WikilinkSuggestionItem[]) {
  return render(<WikilinkMenuList command={vi.fn()} items={items} />);
}

const fileItem = (name: string, dir = "/vault", id = "0") =>
  buildFileSuggestionItem({ name, path: `${dir}/${name}` }, id);

describe("WikilinkMenuList — 그리는 문자열", () => {
  it("제텔 노트 항목은 ID가 아니라 제목을 그린다", () => {
    const item = fileItem("202607051530 원자적 노트.md", "/vault/notes");
    // 이 픽스처가 구분력을 갖는 근거: 둘이 실제로 다르다.
    expect(item.label).not.toBe(item.target);

    renderMenu([item]);

    expect(screen.getByText("원자적 노트")).toBeInTheDocument();
    expect(screen.queryByText("202607051530")).not.toBeInTheDocument();
  });

  it("일반 노트는 확장자 없는 파일명을 그린다", () => {
    renderMenu([fileItem("daily-notes.md")]);

    expect(screen.getByText("daily-notes")).toBeInTheDocument();
    expect(screen.queryByText("daily-notes.md")).not.toBeInTheDocument();
  });

  it("§278 마크다운이 아닌 항목은 라벨 옆에 타입 배지를 그린다", () => {
    renderMenu([fileItem("attention.pdf", "/vault/papers")]);

    expect(screen.getByText("attention.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });
});

/**
 * §95 설계는 중복 제목을 자동완성이 갈라 준다고 약속한다:
 * "중복 제목: 유일 매칭 실패 → 자동완성으로 유도(**폴더/ID/미리보기로 구분**)".
 *
 * ID를 목록에서 뺀 순간 그 약속의 유일한 이행 수단이 사라졌다 — 제목이 같은 두
 * 노트는 완전히 동일한 두 줄이 되고, 잘못 고른 링크는 `WikilinkView`가 다시
 * 제목으로 렌더하므로 **선택 이후에도 틀렸다는 신호가 없다**. 호버 툴팁은
 * 마우스에만 닿고, 이 메뉴의 주 사용법은 화살표 키다.
 */
describe("WikilinkMenuList — 같은 이름을 가진 행 구별", () => {
  const dupes = () => [
    fileItem("202607051530 회의록.md", "/vault/notes", "0"),
    fileItem("202607060000 회의록.md", "/vault/notes/team", "1"),
  ];

  it("이름이 겹치면 각 행에 상위 폴더를 함께 그린다", () => {
    renderMenu(dupes());

    expect(screen.getAllByText("회의록")).toHaveLength(2);
    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
  });

  it("이름이 겹치지 않으면 폴더를 그리지 않는다 — 흔한 경우는 조용해야 한다", () => {
    renderMenu([
      fileItem("202607051530 회의록.md", "/vault/notes", "0"),
      fileItem("202607060000 회고.md", "/vault/notes/team", "1"),
    ]);

    expect(screen.queryByText("notes")).not.toBeInTheDocument();
    expect(screen.queryByText("team")).not.toBeInTheDocument();
  });

  it("대소문자만 다른 이름도 겹친 것으로 본다", () => {
    renderMenu([
      fileItem("202607051530 Meeting.md", "/vault/notes", "0"),
      fileItem("202607060000 meeting.md", "/vault/notes/team", "1"),
    ]);

    expect(screen.getByText("notes")).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
  });
});
