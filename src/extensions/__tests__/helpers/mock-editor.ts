import { vi } from "vitest";

// Extracted from ai-slash-commands.test.ts (§338 task 7) — the minimal Editor
// stand-in `buildSlashItems` was already proven against. A real Tiptap
// `Editor` built with a reduced schema (Document/Paragraph/Text only) is not
// a safe substitute: several slash-item builders read `editor.state`/`view`/
// `can`/`schema` at BUILD time, not just inside an action — e.g.
// `buildTaskItems` calls `taskLineTarget(editor.state)` directly — and a
// schema missing nodes those reads expect can behave differently from the
// real app schema. This object supplies just enough surface for those
// build-time reads to run without crashing.
export function createMockEditor() {
  const chainObj: Record<string, unknown> = {};
  chainObj.focus = () => chainObj;
  chainObj.toggleHeading = () => chainObj;
  chainObj.toggleBulletList = () => chainObj;
  chainObj.toggleOrderedList = () => chainObj;
  chainObj.toggleTaskList = () => chainObj;
  chainObj.toggleBlockquote = () => chainObj;
  chainObj.setHorizontalRule = () => chainObj;
  chainObj.toggleCodeBlock = () => chainObj;
  chainObj.insertContent = () => chainObj;
  chainObj.insertTable = () => chainObj;
  chainObj.setTextSelection = () => chainObj;
  chainObj.deleteRange = () => chainObj;
  chainObj.insertContentAt = () => chainObj;
  chainObj.run = () => true;

  return {
    chain: () => chainObj,
    commands: {
      setCallout: vi.fn(),
      setToggle: vi.fn(),
      setMermaidBlock: vi.fn(),
    },
    state: {
      selection: { from: 0, to: 0, $from: { parent: { textContent: "" } } },
      // §308 M3-b `/due`·`/priority`가 커서 자리를 보므로 빈 문서를 흉내 낸다 —
      // 태스크 줄이 아니면 그 둘은 메뉴에 들어오지 않는다.
      doc: {
        content: { size: 0 },
        nodeAt: () => null,
        resolve: () => ({ depth: 0 }),
        textBetween: () => "",
        textContent: "",
      },
    },
  } as never;
}
