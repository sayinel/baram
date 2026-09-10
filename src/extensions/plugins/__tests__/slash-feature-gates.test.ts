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

  it("spreads no group twice for any toggle combination", () => {
    // flatIdx(SlashMenu.tsx:78)는 그냥 배열 인덱스다 — 어떤 배열이든 0..n-1로
    // 자명하게 연속이라 게이팅이 무엇을 하든 깨질 수 없는 성질이고, 그래서
    // 여기서 단정하지 않는다. 실제로 여기서 지키는 건 8개 ai×journal×tasks
    // 조합 전부에서 (a) id 중복 없음 — 같은 그룹이 두 번 spread되면 중복
    // id가 생긴다 — 과 (b) 결과가 비어 있지 않음, 이 둘뿐이다. 상대 순서는
    // 아래 "preserves relative group order" 테스트가 따로 지킨다.
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

// §339 "/Extract Action Items" (extract-tasks) reads from tasks AND calls
// the LLM — it belongs to both features and must require both flags, not
// just the tasks group it happens to sit in.
describe("extract-tasks requires both tasks and ai (§339)", () => {
  const hasExtractTasks = (items: { id: string }[]) =>
    items.some((i) => i.id === "extract-tasks");

  it("is absent when tasks is on but AI is off", () => {
    useSettingsStore.setState({ tasksEnabled: true });
    useAIStore.setState({ aiEnabled: false });
    expect(hasExtractTasks(buildSlashItems(editor))).toBe(false);
  });

  it("is present when both tasks and AI are on", () => {
    useSettingsStore.setState({ tasksEnabled: true });
    useAIStore.setState({ aiEnabled: true });
    expect(hasExtractTasks(buildSlashItems(editor))).toBe(true);
  });

  it("is absent when tasks is off, regardless of AI", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    useAIStore.setState({ aiEnabled: true });
    expect(hasExtractTasks(buildSlashItems(editor))).toBe(false);
  });
});
