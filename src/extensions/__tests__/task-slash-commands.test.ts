// §308 M3-b `/due`·`/priority` — 태스크 줄의 필드를 슬래시 커맨드로.
//
// 이 기능의 위험 셋이 서로 다른 층에 있어 층마다 본다:
//   1. `/`가 줄 중간에서 **열리는가** — 열리지 않으면 기능이 통째로 닿지 않는다.
//   2. 항목이 **태스크 줄에서만** 보이는가 — 아무 데서나 보이면 눌러도 아무 일이 없다.
//   3. 고른 값이 그 줄에 **쓰이는가** — 실제 `EditorView`에 진짜 트랜잭션이 가야 한다.
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { findSuggestionMatch } from "@tiptap/suggestion";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../../utils/field-dialog";
import { SLASH_TRIGGER } from "../plugins/slash-command";
import { buildSlashItems } from "../plugins/slash-command-items";
import { taskLineTarget, taskLineText } from "../plugins/task-field-edit";
import { isVimExternalEdit } from "../plugins/vim/vim-keys";

vi.mock("../../utils/field-dialog", () => ({ showFieldDialog: vi.fn() }));

const schema = new Schema({
  marks: { strong: { toDOM: () => ["strong", 0] } },
  nodes: {
    doc: { content: "block+" },
    // `#tag`는 인라인 **노드**다(`tag-node.ts`가 `atom: true`) — 글자를 내놓지 않으면서
    // 위치는 차지한다. 태스크 줄에 태그를 다는 것은 이 앱에서 흔한 모양이다.
    tagNode: {
      atom: true,
      attrs: { name: {} },
      group: "inline",
      inline: true,
      toDOM: () => ["span", { class: "tag" }],
    },
    // 내용을 가진 인라인 노드 — 자리를 **두 칸 넘게** 차지한다. 지금 앱의 인라인 노드는
    // 전부 atom(한 칸)이지만, `taskLineText`가 지키는 것은 "한 칸"이 아니라 "제 크기만큼"이다.
    wrapper: {
      content: "text*",
      group: "inline",
      inline: true,
      toDOM: () => ["em", 0],
    },
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

/** `buildSlashItems`가 보는 모양 — 상태는 매번 지금 것을 준다(디스패치 뒤에도 최신). */
function editorFor(v: EditorView) {
  return {
    chain: () => ({ focus: () => ({ run: () => true }) }),
    commands: {},
    get state() {
      return v.state;
    },
    view: v,
  } as never;
}

function itemsAt(pos: number) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
  return buildSlashItems(editorFor(view));
}

/**
 * 태스크 한 줄(+ 이어지는 문단) 그리고 그 아래 평범한 문단.
 * 두 번째 문단이 있는 이유: **태스크 줄은 첫 문단뿐**이라는 규칙을 볼 수 있어야 한다.
 */
function mount(line: string, second?: string): EditorView {
  const item = [schema.node("paragraph", null, [schema.text(line)])];
  if (second) item.push(schema.node("paragraph", null, [schema.text(second)]));
  const doc = schema.node("doc", null, [
    schema.node("taskList", null, [schema.node("taskItem", null, item)]),
    schema.node("paragraph", null, [schema.text("바깥 문단")]),
  ]);
  const place = document.createElement("div");
  document.body.appendChild(place);
  return new EditorView(place, { state: EditorState.create({ doc, schema }) });
}

/** `text` 뒤에 커서가 있다고 보고 `/` 매치를 묻는다 — 라이브러리의 매처 그대로. */
function match(text: string) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text(text)]),
  ]);
  return findSuggestionMatch({
    ...SLASH_TRIGGER,
    $position: doc.resolve(text.length + 1),
  });
}

const text = () => view.state.doc.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ locale: "en" });
});

afterEach(() => {
  view?.destroy();
  document.body.innerHTML = "";
});

describe("`/`는 언제 열리는가", () => {
  it("‼️ 줄 중간, 공백 뒤에서 열린다 — `/due`가 사는 자리", () => {
    // 이것이 거짓이면 기능이 통째로 닿지 않는다. `startOfLine`이 참이던 시절에는
    // `/`가 텍스트 노드의 첫 글자일 때만 열려 태스크 줄 끝에서는 메뉴가 없었다.
    expect(match("보고서 쓰기 /du")?.query).toBe("du");
  });

  it("줄 처음에서도 그대로 열린다", () => {
    expect(match("/h1")?.query).toBe("h1");
  });

  it.each([
    ["URL", "https://exa"],
    ["날짜 표기", "9/15"],
    ["상대 경로", "./pa"],
    ["단어 사이", "and/or"],
  ])("공백 뒤가 아니면 열리지 않는다 — %s", (_, sample) => {
    expect(match(sample)).toBeNull();
  });
});

describe("항목은 태스크 줄에서만 보인다", () => {
  it("태스크 줄에 커서가 있으면 둘 다 있다", () => {
    view = mount("보고서 쓰기");
    const ids = itemsAt(3).map((i) => i.id);
    expect(ids).toContain("due");
    expect(ids).toContain("priority");
  });

  it("‼️ 날짜 셋이 함께 있다", () => {
    // `/due`만 두면 `⏳`·`🛫`는 `sched:`·`start:` 입력 규칙을 아는 사람만 쓸 수 있는데,
    // 그 규칙을 몰라서 메뉴를 여는 사람이 바로 이 메뉴의 사용자다.
    view = mount("보고서 쓰기");
    const ids = itemsAt(3).map((i) => i.id);
    expect(ids).toContain("due");
    expect(ids).toContain("sched");
    expect(ids).toContain("start");
  });

  it("바깥 문단에서는 둘 다 없다", () => {
    view = mount("보고서 쓰기");
    const outside = view.state.doc.content.size - 2;
    const ids = itemsAt(outside).map((i) => i.id);
    expect(ids).not.toContain("due");
    expect(ids).not.toContain("priority");
  });

  it("‼️ 태스크 항목의 **두 번째** 문단은 태스크 줄이 아니다", () => {
    // Rust 인덱서는 `- [ ]`로 시작하는 그 한 줄만 파싱한다. 여기 날짜를 쓰면 아젠다는
    // 그것을 이 태스크의 마감으로 읽지 않고 칩도 그리지 않는다 — 에디터만 없는 사실을
    // 말하게 된다. (§316 — 자리가 의미를 결정한다.)
    view = mount("보고서 쓰기", "덧붙이는 메모");
    const ids = itemsAt(view.state.doc.textContent.indexOf("덧붙") + 4).map(
      (i) => i.id,
    );
    expect(ids).not.toContain("due");
  });

  it("다른 항목들은 자리와 무관하게 그대로 있다", () => {
    view = mount("보고서 쓰기");
    expect(itemsAt(view.state.doc.content.size - 2).map((i) => i.id)).toContain(
      "h1",
    );
  });
});

describe("taskLineTarget", () => {
  it("문단 내용의 시작과 그때의 원문을 준다", () => {
    view = mount("보고서 📅2026-08-30");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
    );
    expect(taskLineTarget(view.state)).toEqual({
      paragraphFrom: 3,
      paragraphText: "보고서 📅2026-08-30",
    });
  });
});

describe("/due", () => {
  async function pick(values: null | Record<string, string>, pos = 3) {
    vi.mocked(showFieldDialog).mockResolvedValueOnce(values);
    const item = itemsAt(pos).find((i) => i.id === "due");
    if (!item) throw new Error("/due 항목이 없다");
    item.action();
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());
  }

  it("없던 필드를 §303 자리에 넣는다", async () => {
    view = mount("보고서 ⏫");
    await pick({ date: "2026-09-15" });
    await vi.waitFor(() => expect(text()).toContain("보고서 📅2026-09-15 ⏫"));
  });

  it("이미 있으면 현재 값으로 열리고 갈아끼운다", async () => {
    view = mount("보고서 📅2026-08-30");
    await pick({ date: "2026-09-15" });
    await vi.waitFor(() => expect(text()).toContain("보고서 📅2026-09-15"));
    expect(vi.mocked(showFieldDialog).mock.calls[0][0].fields[0].value).toBe(
      "2026-08-30",
    );
  });

  it("상대 날짜를 받는다 — 칩 편집·입력 규칙과 같은 어휘", async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    view = mount("보고서");
    await pick({ date: "today" });
    await vi.waitFor(() => expect(text()).toContain(`보고서 📅${iso}`));
  });

  it("비우면 필드가 사라진다", async () => {
    view = mount("보고서 📅2026-08-30 ⏫");
    await pick({ date: "" });
    await vi.waitFor(() => expect(text()).toContain("보고서 ⏫"));
  });

  it("취소하면 문서가 그대로다", async () => {
    view = mount("보고서 📅2026-08-30");
    await pick(null);
    expect(text()).toContain("보고서 📅2026-08-30");
  });
});

describe("/sched · /start", () => {
  it.each([
    ["sched", "⏳"],
    ["start", "🛫"],
  ])("`/%s` → %s 필드", async (id, emoji) => {
    view = mount("보고서 📅2026-08-30");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === id)
      ?.action();
    await vi.waitFor(() => expect(text()).toContain(emoji));
  });

  it("‼️ §303 자리를 지킨다 — 예정일은 마감 앞이다", async () => {
    view = mount("보고서 📅2026-08-30");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-08-20" });
    itemsAt(3)
      .find((i) => i.id === "sched")
      ?.action();
    await vi.waitFor(() =>
      expect(text()).toContain("보고서 ⏳2026-08-20 📅2026-08-30"),
    );
  });
});

describe("‼️ 고친 뒤 커서가 그 줄로 돌아온다", () => {
  it("모달이 닫히면 포커스와 커서가 태스크 줄 끝에 선다", async () => {
    // 모달이 포커스를 가져갔다가 닫히면 포커스는 `body`로 떨어진다. 슬래시 커맨드는
    // **타이핑 중에** 부르는 것이라, 이어 쓰려고 다시 눌러야 하는 순간이 곧 이 명령을
    // 쓰지 않을 이유가 된다.
    view = mount("보고서");
    view.dom.blur();
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(text()).toContain("📅2026-09-15"));

    const line = view.state.doc.firstChild!.firstChild!.firstChild!;
    // 문단 내용은 3에서 시작하므로 끝은 3 + 길이다.
    expect(view.state.selection.from).toBe(3 + line.content.size);
    expect(view.hasFocus()).toBe(true);
  });

  it("취소하면 커서를 빼앗지 않는다", async () => {
    view = mount("보고서 내용");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)),
    );
    vi.mocked(showFieldDialog).mockResolvedValueOnce(null);
    itemsAt(5)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());
    expect(view.state.selection.from).toBe(5);
  });

  it("‼️ 낙관적 잠금에 걸려 쓰지 못했으면 커서도 옮기지 않는다", async () => {
    // 취소 경로는 확정에 닿기도 전에 돌아서므로 이 분기를 지나지 않는다. 쓰기가
    // **거절된** 경우에만 갈린다 — 아무것도 안 바뀐 문서에서 커서만 튀면 사용자는
    // 무슨 일이 일어났는지 알 수 없다.
    view = mount("보고서");
    let release!: (v: null | Record<string, string>) => void;
    vi.mocked(showFieldDialog).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());

    // 모달이 열린 사이 그 줄이 바뀐다 → 확정이 거절된다.
    view.dispatch(view.state.tr.insertText("!", 3));
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
    );

    release({ date: "2026-09-15" });
    await vi.waitFor(() =>
      expect(useUIStore.getState().toast?.type).toBe("error"),
    );
    expect(view.state.selection.from).toBe(4);
    expect(text()).not.toContain("📅");
  });
});

describe("/priority", () => {
  it("없던 마커를 날짜들 **뒤**에 넣는다", async () => {
    view = mount("보고서 ⏳2026-08-20 📅2026-08-30");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ priority: "2" });
    itemsAt(3)
      .find((i) => i.id === "priority")
      ?.action();
    await vi.waitFor(() =>
      expect(text()).toContain("보고서 ⏳2026-08-20 📅2026-08-30 ⏫"),
    );
  });

  it("현재 단계로 열린다", async () => {
    view = mount("보고서 🔺");
    vi.mocked(showFieldDialog).mockResolvedValueOnce(null);
    itemsAt(3)
      .find((i) => i.id === "priority")
      ?.action();
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());
    expect(vi.mocked(showFieldDialog).mock.calls[0][0].fields[0].value).toBe(
      "1",
    );
  });
});

describe("‼️ 대상은 항목을 만들 때가 아니라 고를 때 잡는다", () => {
  it("`/due` 글자가 지워진 **뒤**의 줄에 쓴다", () => {
    // Suggestion은 항목의 action을 부르기 직전에 `/due` 글자를 지운다
    // (`slash-command.ts`의 `command`). 메뉴를 지을 때 줄을 캡처해 두면 그 원문이
    // 그 삭제만큼 낡고, 낙관적 잠금이 매번 걸려 **아무것도 쓰이지 않는다**.
    view = mount("보고서 /due");
    const item = itemsAt(3).find((i) => i.id === "due");
    // Suggestion이 하는 그 삭제.
    view.dispatch(view.state.tr.delete(7, 11));
    expect(view.state.doc.textContent).toContain("보고서 ");

    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    item?.action();
    return vi.waitFor(() => expect(text()).toContain("보고서 📅2026-09-15"));
  });
});

describe("문서에 닿는 방식", () => {
  it("‼️ vim에 UI 크롬이 만든 편집임을 알린다", async () => {
    // 표시가 없으면 vim이 이것을 사용자의 편집으로 읽어 visual 선택을 normal로 접는다.
    // 툴바·팔레트·NodeView 피커가 모두 다는 표시다(§12-6).
    view = mount("보고서");
    const dispatch = vi.spyOn(view, "dispatch");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(text()).toContain("📅"));

    const written = dispatch.mock.calls.at(-1)?.[0];
    expect(written && isVimExternalEdit(written)).toBe(true);
  });

  it("‼️ 새 필드는 앞 글자의 마크를 물려받지 않는다", async () => {
    // `tr.insertText`는 삽입 위치의 마크를 물려준다. 굵은 글씨로 끝나는 줄에 필드를
    // 붙이면 `**급함📅2026-09-15**`가 되어 그대로 파일에 쓰인다.
    const doc = schema.node("doc", null, [
      schema.node("taskList", null, [
        schema.node("taskItem", null, [
          schema.node("paragraph", null, [
            schema.text("보고서 "),
            schema.text("급함", [schema.marks.strong.create()]),
          ]),
        ]),
      ]),
    ]);
    const place = document.createElement("div");
    document.body.appendChild(place);
    view = new EditorView(place, {
      state: EditorState.create({ doc, schema }),
    });

    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(text()).toContain("📅2026-09-15"));

    const line = view.state.doc.firstChild!.firstChild!.firstChild!;
    const field = line.lastChild!;
    expect(field.text).toContain("📅2026-09-15");
    expect(field.marks).toHaveLength(0);
  });
});

describe("‼️ 인라인 노드가 섞인 줄 — 오프셋과 위치가 갈리는 자리", () => {
  /** `보고서 #deep-work 📅…` 모양. 태그는 노드라 `textContent`에서 사라진다. */
  function mountTagged(tail: string): EditorView {
    const line = [
      schema.text("보고서 "),
      schema.node("tagNode", { name: "deep-work" }),
    ];
    if (tail) line.push(schema.text(tail));
    const doc = schema.node("doc", null, [
      schema.node("taskList", null, [
        schema.node("taskItem", null, [schema.node("paragraph", null, line)]),
      ]),
    ]);
    const place = document.createElement("div");
    document.body.appendChild(place);
    return new EditorView(place, {
      state: EditorState.create({ doc, schema }),
    });
  }

  it("‼️ 자리를 여러 칸 차지하는 인라인 노드도 제 크기만큼 센다", () => {
    const line = schema.node("paragraph", null, [
      schema.text("보고서 "),
      schema.node("wrapper", null, [schema.text("강조")]),
      schema.text(" 📅2026-08-30"),
    ]);
    expect(taskLineText(line)).toHaveLength(line.content.size);
  });

  it("줄 텍스트의 길이가 문단의 위치 크기와 같다", () => {
    view = mountTagged(" 📅2026-08-30");
    const line = view.state.doc.firstChild!.firstChild!.firstChild!;
    // 이것이 이 모듈이 기대는 불변식이다 — 오프셋을 그대로 위치로 쓸 수 있는 근거.
    expect(taskLineText(line)).toHaveLength(line.content.size);
    expect(line.textContent).not.toHaveLength(line.content.size);
  });

  it("‼️ 태그 뒤의 필드를 제자리에 갈아끼운다", async () => {
    // `textContent`로 재면 태그가 먹은 한 칸만큼 쓰기가 앞으로 밀려, 필드가 아니라
    // 그 앞 공백부터 덮어써진다.
    view = mountTagged(" 📅2026-08-30");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(text()).toContain("📅2026-09-15"));

    const line = view.state.doc.firstChild!.firstChild!.firstChild!;
    expect(taskLineText(line)).toBe("보고서 \uFFFC 📅2026-09-15");
  });

  it("태그로 끝나는 줄에도 필드를 붙인다", async () => {
    view = mountTagged("");
    vi.mocked(showFieldDialog).mockResolvedValueOnce({ date: "2026-09-15" });
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(text()).toContain("📅2026-09-15"));

    const line = view.state.doc.firstChild!.firstChild!.firstChild!;
    expect(taskLineText(line)).toBe("보고서 \uFFFC 📅2026-09-15");
    // 태그 노드가 살아 있어야 한다 — 편집이 그 자리를 덮지 않았다는 뜻이다.
    expect(line.child(1).type.name).toBe("tagNode");
  });
});

describe("낙관적 잠금", () => {
  it("‼️ 다이얼로그가 열린 사이 그 줄이 바뀌면 아무것도 쓰지 않는다", async () => {
    view = mount("보고서");
    let release!: (v: null | Record<string, string>) => void;
    vi.mocked(showFieldDialog).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    itemsAt(3)
      .find((i) => i.id === "due")
      ?.action();
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalled());

    view.dispatch(view.state.tr.insertText("!", 3));
    const changed = text();

    release({ date: "2026-09-15" });
    await vi.waitFor(() => expect(showFieldDialog).toHaveBeenCalledTimes(1));
    expect(text()).toBe(changed);
  });
});
