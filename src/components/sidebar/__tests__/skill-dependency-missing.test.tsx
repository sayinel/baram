// §72b — 찾지 못한 요구 스킬 행은 `dep-list-item` 과 `dep-list-item--missing` 을 **둘 다**
// 가져야 한다. 템플릿이 공백 없이 이어 붙여 `dep-list-itemdep-list-item--missing` 한
// 단어가 되면, 행은 flex 레이아웃(.dep-list-item)과 빨간색(--missing)을 함께 잃는다.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSkillStore } from "../../../stores/ai/skill";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { SkillDependencySection } from "../SkillDependencySection";

const PATH = "/v/skills/writer.md";

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: "",
        filePath: PATH,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "writer.md",
        type: "file",
      },
    ],
  });
  useFileStore.setState({
    fileTree: [],
    openFiles: new Map([
      [PATH, "---\nname: writer\nrequires: [ghost]\n---\nbody\n"],
    ]),
  });
  useSkillStore.setState({ isSkill: true });
});

describe("SkillDependencySection — a missing requirement", () => {
  it("keeps both classes on the row", async () => {
    render(<SkillDependencySection />);
    const row = (await screen.findByText("ghost")).parentElement;
    expect(row?.classList.contains("dep-list-item")).toBe(true);
    expect(row?.classList.contains("dep-list-item--missing")).toBe(true);
  });
});

// §72c — 머리 버튼(`.dep-section-header`)의 자식 넷(화살표·제목·경고 개수·로딩 점) 가운데 펼침
// 상태를 보여 주는 것은 화살표 아이콘뿐이고, lucide 는 접근성 속성 없는 svg 에 `aria-hidden` 을
// 붙인다. 그래서 보조 기술에 그 상태를 전하는 것은 버튼의 `aria-expanded` 다.
describe("SkillDependencySection — the header names its disclosure state", () => {
  it("reports expanded by default and collapsed after a click", async () => {
    render(<SkillDependencySection />);
    await screen.findByText("ghost");
    const header = screen.getByRole("button", { name: /dependencies/i });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });
});
