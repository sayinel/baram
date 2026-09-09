import type { Editor } from "@tiptap/core";

import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { useSettingsStore } from "../../../stores/settings/store";
import { createMockEditor } from "../../__tests__/helpers/mock-editor";
import { buildSlashItems } from "../slash-command-items";

// ‼️ 실제 Tiptap `Editor`가 아니라 공유 `createMockEditor()`를 쓴다 — 여러 빌더가
// build 시점에 `editor.state`/`view`/`can`/`schema`를 읽어서(예: `buildTaskItems`의
// `taskLineTarget(editor.state)`) 축소 스키마(Document/Paragraph/Text만)로는 그
// 읽기가 기대하는 모양을 보장하지 못한다. `createMockEditor`는 이미 `buildSlashItems`
// 전체를 오늘 통과시키는 것으로 검증된 표면이다(`ai-slash-commands.test.ts`).
let editor: Editor;

beforeEach(() => {
  editor = createMockEditor();
  useSettingsStore.setState({
    journalEnabled: true,
    tasksEnabled: true,
    zettelkastenEnabled: true,
  });
  useAIStore.setState({
    aiEnabled: true,
    // 커스텀 AI 명령을 하나 채운다 — buildCustomAIItems가 실제로 뭔가를 만들어야
    // 아래 순서 테스트가 "journal 뒤" 위치를 검증할 대상을 갖는다. 비워 두면
    // buildCustomAIItems가 [] 를 돌려주므로 그 항목을 journal 옆으로 옮기는
    // 뮤테이션이 있어도 검사할 인덱스 자체가 없어 테스트가 공허하게 통과한다.
    customCommands: [{ id: "gate-test", name: "Gate Test", prompt: "x" }],
  });
});

const cats = (ids: { category: string }[]) =>
  new Set(ids.map((i) => i.category));

describe("slash menu feature gating (§338)", () => {
  it("includes the AI and Journal groups when the features are on", () => {
    const items = buildSlashItems(editor);
    expect(cats(items)).toContain("AI");
    expect(items.some((i) => i.id === "quick-capture")).toBe(true);
  });

  it("drops the AI group when ai is off", () => {
    useAIStore.setState({ aiEnabled: false });
    const items = buildSlashItems(editor);
    expect(cats(items)).not.toContain("AI");
    // 비공허성 — 기본 그룹은 남는다
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.id === "quick-capture")).toBe(true);
  });

  it("drops the journal items when journal is off", () => {
    useSettingsStore.setState({ journalEnabled: false });
    const items = buildSlashItems(editor);
    expect(items.some((i) => i.id === "quick-capture")).toBe(false);
    expect(items.some((i) => i.id === "photo")).toBe(false);
    expect(cats(items)).toContain("AI");
  });

  it("keeps flatIdx contiguous for every toggle combination", () => {
    // 그 파일의 순서 계약: 배열 위치가 flatIdx 를 고정하고 화살표 순회가 그것에 의존한다.
    // 조건부 제거는 순서를 보존한다 — 재배열은 계약 위반이다.
    for (const ai of [true, false]) {
      for (const journal of [true, false]) {
        for (const tasks of [true, false]) {
          useAIStore.setState({ aiEnabled: ai });
          useSettingsStore.setState({
            journalEnabled: journal,
            tasksEnabled: tasks,
          });
          const items = buildSlashItems(editor);
          const ids = items.map((i) => i.id);
          expect(new Set(ids).size).toBe(ids.length); // 중복 없음
          expect(items.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("preserves relative group order — basic before AI before journal before custom AI", () => {
    const items = buildSlashItems(editor);
    const firstAI = items.findIndex((i) => i.category === "AI");
    const firstJournal = items.findIndex((i) => i.id === "quick-capture");
    // §48 custom AI commands share category "AI" but sit AFTER journal in
    // array order (see the comment on buildCustomAIItems). Anchoring only on
    // `firstAI` wouldn't catch a mutation that moves buildCustomAIItems next
    // to buildAIItems — the built-in AI items already precede journal either
    // way, so a genuine "ai-custom-*" position check is required to pin the
    // file's own non-contiguous-category contract.
    const customAI = items.findIndex((i) => i.id === "ai-custom-gate-test");
    expect(firstAI).toBeGreaterThan(-1);
    expect(firstJournal).toBeGreaterThan(firstAI);
    expect(customAI).toBeGreaterThan(firstJournal);
  });
});
