// §308 M3-a 칩을 눌러 값을 고친다.
//
// 실제 `EditorView`에 플러그인을 꽂고 진짜 `mousedown`을 보낸다. 이 기능의 위험이
// 전부 그 층에 있기 때문이다 — 캐럿이 옮겨가는가, 위젯 DOM에서 위치를 되찾는가,
// 모달이 열린 사이 바뀐 줄을 덮는가. 순수 함수로는 그중 어느 것도 볼 수 없다.
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../../utils/field-dialog";
import { createTaskFieldChipsPlugin } from "../plugins/task-field-chips";

vi.mock("../../utils/field-dialog", () => ({ showFieldDialog: vi.fn() }));

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    taskItem: {
      attrs: { checked: { default: false } },
      content: "paragraph block*",
      toDOM: () => ["li", 0],
    },
    taskList: { content: "taskItem+", group: "block", toDOM: () => ["ul", 0] },
    text: { group: "inline" },
  },
});

let view: EditorView;

function chip(kind: string): HTMLElement {
  const el = view.dom.querySelector<HTMLElement>(`[data-chip-kind="${kind}"]`);
  if (!el) throw new Error(`${kind} 칩이 없다`);
  return el;
}

/**
 * 태스크 한 줄 + 그 아래 빈 문단. 커서를 **그 문단**에 둔다.
 *
 * ‼️ 커서를 태스크 항목 안에 두면 이 플러그인이 그 항목의 데코레이션을 통째로
 * 건너뛴다(편집 중에는 원문을 봐야 하므로) — 칩이 아예 없어 아무것도 누를 수 없다.
 * 그 규칙이 이 기능의 전제이기도 하다: 칩을 누르는 것은 언제나 "커서가 다른 곳에
 * 있을 때"다.
 */
function mount(text: string): EditorView {
  const doc = schema.node("doc", null, [
    schema.node("taskList", null, [
      schema.node("taskItem", null, [
        schema.node("paragraph", null, [schema.text(text)]),
      ]),
    ]),
    schema.node("paragraph"),
  ]);
  const place = document.createElement("div");
  document.body.appendChild(place);
  return new EditorView(place, {
    state: EditorState.create({
      doc,
      plugins: [createTaskFieldChipsPlugin()],
      selection: TextSelection.atEnd(doc),
    }),
  });
}

/** 진짜 mousedown. 기본 동작이 막혔는지도 함께 돌려준다. */
function mousedown(el: HTMLElement): { defaultPrevented: boolean } {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  return { defaultPrevented: event.defaultPrevented };
}

/** 다이얼로그가 이 값을 돌려준다고 세운 뒤, 그것이 반영될 때까지 기다린다. */
async function answer(values: null | Record<string, string>) {
  vi.mocked(showFieldDialog).mockResolvedValueOnce(values);
}

const text = () => view.state.doc.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ locale: "en" });
  useUIStore.getState().dismissToast();
});

afterEach(() => {
  view?.destroy();
  document.body.innerHTML = "";
});

describe("칩 클릭", () => {
  it("‼️ 캐럿을 옮기지 않는다", async () => {
    // 옮기면 이 줄의 데코레이션이 통째로 사라져 누른 그 칩이 그 자리에서 없어진다.
    // 사용자에게는 "눌렀더니 칩이 사라졌다"가 되고, 다음 클릭 대상도 없다.
    view = mount("보고서 📅2026-08-30");
    await answer(null);

    const { defaultPrevented } = mousedown(chip("due"));

    expect(defaultPrevented).toBe(true);
  });

  it("칩이 아닌 곳의 클릭은 통과시킨다", () => {
    view = mount("보고서 📅2026-08-30");

    const { defaultPrevented } = mousedown(view.dom);

    expect(defaultPrevented).toBe(false);
    expect(showFieldDialog).not.toHaveBeenCalled();
  });
});

describe("날짜 칩", () => {
  it("현재 값으로 열리고, 고친 값이 들어간다", async () => {
    view = mount("보고서 📅2026-08-30");
    await answer({ date: "2026-09-15" });

    mousedown(chip("due"));
    await vi.waitFor(() => expect(text()).toBe("보고서 📅2026-09-15"));

    // 열 때 현재 값이 들어 있어야 고치는 다이얼로그다.
    expect(vi.mocked(showFieldDialog).mock.calls[0][0].fields[0].value).toBe(
      "2026-08-30",
    );
  });

  it("상대 날짜를 받는다 — 에디터 입력 규칙과 같은 어휘", async () => {
    // ‼️ 기대값을 정확한 날짜로 적는다. `/📅\d{4}-\d{2}-\d{2}$/`로 기다리면 **원본도**
    // 그 모양이라 `waitFor`가 첫 시도에 통과하고, 뒤따르는 단언이 아직 바뀌지 않은
    // 텍스트를 본다 — 기다린 척하는 테스트가 된다.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    view = mount("보고서 📅2026-01-01");
    await answer({ date: "today" });

    mousedown(chip("due"));
    await vi.waitFor(() => expect(text()).toBe(`보고서 📅${iso}`));
  });

  it("비우면 필드가 앞 공백까지 사라진다", async () => {
    view = mount("보고서 📅2026-08-30");
    await answer({ date: "  " });

    mousedown(chip("due"));
    await vi.waitFor(() => expect(text()).toBe("보고서"));
  });

  it("취소하면 문서가 그대로다", async () => {
    view = mount("보고서 📅2026-08-30");
    await answer(null);

    mousedown(chip("due"));
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());
    expect(text()).toBe("보고서 📅2026-08-30");
  });

  it("해석할 수 없는 값은 쓰지 않고 알린다", async () => {
    view = mount("보고서 📅2026-08-30");
    await answer({ date: "어제" });

    mousedown(chip("due"));
    await vi.waitFor(() =>
      expect(useUIStore.getState().toast?.type).toBe("error"),
    );
    expect(text()).toBe("보고서 📅2026-08-30");
  });

  it("‼️ 같은 **종류**가 한 줄에 둘이어도 누른 그것만 바뀐다", async () => {
    // 종류만으로 스팬을 고르면 언제나 첫 번째가 바뀐다 — 두 번째 칩을 눌러도
    // 첫 번째가 고쳐지고, 사용자는 자기가 안 누른 값이 바뀌는 것을 본다.
    view = mount("보고서 📅2026-08-30 재검토 📅2026-09-01");
    await answer({ date: "2026-12-25" });

    const dues = view.dom.querySelectorAll<HTMLElement>(
      '[data-chip-kind="due"]',
    );
    expect(dues).toHaveLength(2);
    mousedown(dues[1]);

    await vi.waitFor(() =>
      expect(text()).toBe("보고서 📅2026-08-30 재검토 📅2026-12-25"),
    );
  });

  it("다른 종류가 섞여 있어도 누른 그것만 바뀐다", async () => {
    view = mount("보고서 📅2026-08-30 ⏳2026-08-20");
    await answer({ date: "2026-09-15" });

    mousedown(chip("scheduled"));
    await vi.waitFor(() =>
      expect(text()).toBe("보고서 📅2026-08-30 ⏳2026-09-15"),
    );
  });

  it("‼️ §303 순서가 흔들리지 않는다 — 값만 갈아끼운다", async () => {
    // 값을 지웠다 다시 붙이는 구현이면 그 필드가 줄 끝으로 밀린다(M2-b2가 실제로
    // 겪은 드리프트다). 여기서는 스팬만 교체하므로 자리가 유지된다.
    view = mount("보고서 ➕2026-08-01 ⏳2026-08-20 📅2026-08-30 ⏫");
    await answer({ date: "2026-09-15" });

    mousedown(chip("scheduled"));
    await vi.waitFor(() =>
      expect(text()).toBe("보고서 ➕2026-08-01 ⏳2026-09-15 📅2026-08-30 ⏫"),
    );
  });
});

describe("우선순위 칩", () => {
  it("마커를 갈아끼운다", async () => {
    view = mount("보고서 ⏫");
    await answer({ priority: "1" });

    mousedown(chip("priority"));
    await vi.waitFor(() => expect(text()).toBe("보고서 🔺"));
  });

  it("현재 단계로 열린다", async () => {
    view = mount("보고서 ⏫");
    await answer(null);

    mousedown(chip("priority"));
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());
    expect(vi.mocked(showFieldDialog).mock.calls[0][0].fields[0].value).toBe(
      "2",
    );
  });

  it("‼️ '보통'은 마커가 없으므로 제거와 같은 뜻이다", async () => {
    view = mount("보고서 ⏫");
    await answer({ priority: "3" });

    mousedown(chip("priority"));
    await vi.waitFor(() => expect(text()).toBe("보고서"));
  });
});

describe("낙관적 잠금", () => {
  it("‼️ 다이얼로그가 열린 사이 그 줄이 바뀌면 아무것도 쓰지 않는다", async () => {
    // 위치만 믿고 쓰면 사용자가 그 사이에 친 글자를 덮는다. 디스크 쓰기의
    // `expected_raw`와 같은 계약이다.
    view = mount("보고서 📅2026-08-30");

    let release!: (v: null | Record<string, string>) => void;
    vi.mocked(showFieldDialog).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mousedown(chip("due"));
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());

    // 모달이 열려 있는 동안 그 줄이 바뀐다(다른 창의 편집·외부 변경 리로드).
    view.dispatch(view.state.tr.insertText("!", 3));
    const changed = text();

    release({ date: "2026-09-15" });
    await vi.waitFor(() =>
      expect(useUIStore.getState().toast?.type).toBe("error"),
    );
    expect(text()).toBe(changed);
  });
});
