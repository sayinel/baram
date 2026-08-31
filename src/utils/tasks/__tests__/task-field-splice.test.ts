// §303 필드를 넣고·고치고·지우는 한 자.
//
// 앞의 블록은 Rust `src-tauri/src/task/fields.rs`의 테스트를 **같은 문자열로** 든다.
// 저쪽이 디스크 경로(정리 메뉴·체크박스)를, 이쪽이 에디터 경로(칩·슬래시 커맨드)를
// 담당하므로 둘이 갈리면 같은 조작이 어느 표면에서 했느냐에 따라 다른 줄을 만든다.
// 한쪽 표를 고치면 다른 쪽이 빨간불이 되도록 문자열을 그대로 옮겨 적었다.
import { describe, expect, it } from "vitest";

import { applyTaskField, minimalEdit } from "../task-field-splice";

/** Rust는 `- [ ] ` 접두가 붙은 줄을, 여기는 그것을 뗀 문단 텍스트를 받는다. */
const LINE = "- [ ] ";
function rust(line: string): string {
  return LINE + line;
}

describe("새 필드의 자리 — fields.rs `insert_field`와 같은 답", () => {
  it("날짜는 이미 있는 우선순위 마커 **앞**에 선다", () => {
    expect(
      rust(
        applyTaskField(
          "초안 #deep-work ➕2026-08-01 🛫2026-08-02 ⏳2026-08-03 ⏫",
          "due",
          "2026-09-15",
        ),
      ),
    ).toBe(
      "- [ ] 초안 #deep-work ➕2026-08-01 🛫2026-08-02 ⏳2026-08-03 📅2026-09-15 ⏫",
    );
  });

  it("날짜끼리는 표 순서대로 자리를 찾는다", () => {
    expect(
      rust(
        applyTaskField("x ➕2026-08-01 📅2026-08-30", "start", "2026-08-02"),
      ),
    ).toBe("- [ ] x ➕2026-08-01 🛫2026-08-02 📅2026-08-30");
  });

  it("완료일은 우선순위 앞이다 — 가장 자주 쓰이는 조작이 만드는 줄", () => {
    expect(rust(applyTaskField("x ⏫", "done", "2026-08-27"))).toBe(
      "- [ ] x ✅2026-08-27 ⏫",
    );
  });

  it("‼️ 값이 줄 끝까지인 반복(🔁) 앞에 선다", () => {
    // 뒤에 붙이면 날짜가 반복 텍스트로 먹힌다.
    expect(rust(applyTaskField("x 🔁every week", "due", "2026-09-01"))).toBe(
      "- [ ] x 📅2026-09-01 🔁every week",
    );
  });

  it("필드가 없는 줄은 끝에 받는다", () => {
    expect(rust(applyTaskField("회의 준비", "due", "2026-09-01"))).toBe(
      "- [ ] 회의 준비 📅2026-09-01",
    );
  });

  it("‼️ 본문의 장식 이모지는 경계가 아니다", () => {
    // 뒤에 날짜가 없는 📅는 필드가 아니다 — 새 필드가 그 앞으로 가면 문장이 갈린다.
    expect(rust(applyTaskField("📅 일정 잡기 ⏫", "due", "2026-09-01"))).toBe(
      "- [ ] 📅 일정 잡기 📅2026-09-01 ⏫",
    );
  });

  it("‼️ 기존 필드를 재배열하지 않는다", () => {
    // 손으로 적은 비정규 순서(⏫가 앞)는 그대로 둔다. 새로 넣는 것만 제자리에 넣는다 —
    // 조용히 뒤집으면 날짜 하나를 준 것뿐인데 줄 전체의 바이트가 바뀐다.
    expect(rust(applyTaskField("x ⏫ 🛫2026-08-02", "due", "2026-09-01"))).toBe(
      "- [ ] x 📅2026-09-01 ⏫ 🛫2026-08-02",
    );
  });

  it("‼️ 이모지와 값 사이가 벌어진 필드도 뭉치의 일부다", () => {
    // 파서와 Obsidian Tasks 둘 다 `📅 2026-08-30`을 읽는다. 여기서만 못 읽으면 그것이
    // 본문으로 보여 뭉치가 통째로 사라지고, 새 필드는 §303 순서를 어기며 줄 끝에 붙는다.
    expect(
      rust(applyTaskField("x 📅 2026-08-30", "scheduled", "2026-08-20")),
    ).toBe("- [ ] x ⏳2026-08-20 📅 2026-08-30");
  });

  it("줄 끝의 공백은 필드를 주면서 함께 걷힌다 — Rust `trim_end`와 같다", () => {
    expect(rust(applyTaskField("보고서 ⏫  ", "due", "2026-09-01"))).toBe(
      "- [ ] 보고서 📅2026-09-01 ⏫",
    );
  });

  it("탭으로 구분된 필드 뭉치도 찾는다", () => {
    expect(rust(applyTaskField("x\t⏫", "due", "2026-09-01"))).toBe(
      "- [ ] x 📅2026-09-01 ⏫",
    );
  });
});

describe("문단 텍스트라는 입력 모양 — Rust에 없는 경우", () => {
  it("‼️ 줄이 통째로 필드여도 자리를 찾는다", () => {
    // Rust 입력에는 `- [ ] ` 접두가 있어 뭉치 앞에 공백이 반드시 있지만, 문단 텍스트에는
    // 없다. 0을 후보로 세지 않으면 여기서 자리를 못 찾아 `⏫ 📅…`가 된다.
    expect(applyTaskField("⏫", "due", "2026-09-01")).toBe("📅2026-09-01 ⏫");
  });

  it("빈 문단에도 앞 공백을 흘리지 않는다", () => {
    expect(applyTaskField("", "due", "2026-09-01")).toBe("📅2026-09-01");
  });

  it("우선순위는 마커 자체가 값이다", () => {
    expect(applyTaskField("보고서 📅2026-09-01", "priority", "⏫")).toBe(
      "보고서 📅2026-09-01 ⏫",
    );
  });
});

describe("이미 있는 값 고치기", () => {
  it("값만 갈아끼운다 — 자리는 그대로", () => {
    expect(
      applyTaskField(
        "x ➕2026-08-01 ⏳2026-08-20 📅2026-08-30 ⏫",
        "scheduled",
        "2026-09-15",
      ),
    ).toBe("x ➕2026-08-01 ⏳2026-09-15 📅2026-08-30 ⏫");
  });

  it("‼️ 같은 필드가 둘이면 처음 것 — Rust 파서가 읽는 그것", () => {
    expect(
      applyTaskField("x 📅2026-08-30 y 📅2026-09-01", "due", "2026-12-25"),
    ).toBe("x 📅2026-12-25 y 📅2026-09-01");
  });

  it("구간을 지정하면 그것을 고친다 — 칩 클릭이 누른 그 칩", () => {
    const second = {
      emoji: "📅",
      from: 17,
      kind: "due" as const,
      to: 29,
      value: "2026-09-01",
    };
    expect(
      applyTaskField(
        "x 📅2026-08-30 y 📅2026-09-01",
        "due",
        "2026-12-25",
        second,
      ),
    ).toBe("x 📅2026-08-30 y 📅2026-12-25");
  });

  it("이모지와 값 사이의 공백은 canonical 형태로 정규화된다", () => {
    // 파서는 `📅 2026-08-30`을 읽지만(Obsidian Tasks가 그렇게 쓴다) 우리가 쓰는 형태는
    // 공백 없는 쪽이다 — Rust 쓰기 경로와 같다.
    expect(applyTaskField("x 📅 2026-08-30", "due", "2026-09-15")).toBe(
      "x 📅2026-09-15",
    );
  });
});

describe("빈 값은 제거", () => {
  it("앞의 구분 공백까지 함께 간다", () => {
    expect(applyTaskField("보고서 📅2026-08-30", "due", "")).toBe("보고서");
  });

  it("‼️ 줄 맨 앞의 필드는 뒤 공백을 가져간다", () => {
    // 앞엣것을 가져가려다 없으면 그냥 두는 구현이면 ` 보고서`가 되어 앞에 빈 칸이 남는다.
    expect(applyTaskField("📅2026-08-30 보고서", "due", "")).toBe("보고서");
  });

  it("가운데 필드를 빼도 양옆이 한 칸으로 붙는다", () => {
    expect(
      applyTaskField("x ⏳2026-08-20 📅2026-08-30 ⏫", "scheduled", ""),
    ).toBe("x 📅2026-08-30 ⏫");
  });

  it("없는 필드를 지우라면 아무것도 하지 않는다", () => {
    expect(applyTaskField("보고서 ⏫", "due", "")).toBe("보고서 ⏫");
  });

  it("우선순위 '보통'은 마커가 없으므로 제거와 같은 말이다", () => {
    expect(applyTaskField("보고서 ⏫", "priority", "")).toBe("보고서");
  });
});

describe("‼️ 인라인 노드가 차지한 자리는 편집이 넘지 않는다", () => {
  // 에디터 층은 `#tag`·`[[위키링크]]` 같은 인라인 노드를 U+FFFC 한 글자로 채워 오프셋과
  // 위치를 1:1로 맞춘다(`task-field-edit.ts`의 `taskLineText`). 그 채움 문자를 편집이
  // 덮으면 문서에서 그 노드가 사라진다 — 사용자의 태그나 링크가 조용히 없어진다는 뜻이다.
  //
  // 여기서 그 성질을 직접 단정하므로 쓰기 경로에 가드를 두지 않는다: 채움 문자는 공백이
  // 아니라 `cutSpan`도 `trimEnd`도 그것을 넘어가지 못한다.
  const O = "\uFFFC";
  const cases: [string, "due" | "priority" | "scheduled", string][] = [
    [`보고서 ${O}`, "due", "2026-09-01"],
    [`보고서 ${O} 📅2026-08-30`, "due", "2026-09-15"],
    [`보고서 ${O} 📅2026-08-30`, "due", ""],
    [`보고서 ${O}📅2026-08-30`, "due", ""],
    [`${O} 📅2026-08-30`, "due", ""],
    [`${O}`, "priority", "⏫"],
    [`보고서 ${O}   `, "due", "2026-09-01"],
    [`보고서 📅2026-08-30 ${O} ⏫`, "scheduled", "2026-08-20"],
    [`보고서 ${O} ⏫`, "due", "2026-09-01"],
  ];

  it.each(cases)("%s ← %s=%s", (body, kind, value) => {
    const edit = minimalEdit(body, applyTaskField(body, kind, value));
    if (!edit) return;
    expect(body.slice(edit.at, edit.at + edit.remove)).not.toContain(O);
    // 채움 문자의 개수도 그대로여야 한다 — 편집이 그것을 지우지도, 늘리지도 않는다.
    const after =
      body.slice(0, edit.at) + edit.insert + body.slice(edit.at + edit.remove);
    expect([...after].filter((c) => c === O)).toHaveLength(
      [...body].filter((c) => c === O).length,
    );
  });
});

describe("minimalEdit", () => {
  it("같으면 편집이 없다", () => {
    expect(minimalEdit("같다", "같다")).toBeNull();
  });

  it("‼️ 바뀐 자리만 짚는다 — 문단을 통째로 쓰면 링크·수식이 평문이 된다", () => {
    const edit = minimalEdit("보고서 📅2026-08-30", "보고서 📅2026-09-15");
    expect(edit).not.toBeNull();
    // `2026-0`까지가 공통, `8-30` ↔ `9-15`만 다르다.
    expect(edit?.at).toBe(12);
    expect(edit?.insert).toBe("9-15");
    expect(edit?.remove).toBe(4);
  });

  it("순수 삽입은 지우지 않는다", () => {
    const edit = minimalEdit("보고서", "보고서 📅2026-09-01");
    expect(edit?.remove).toBe(0);
    expect(edit?.insert).toBe(" 📅2026-09-01");
  });

  it("순수 제거는 넣지 않는다", () => {
    const edit = minimalEdit("보고서 📅2026-09-01", "보고서");
    expect(edit?.insert).toBe("");
    expect(edit?.remove).toBe(13);
  });

  it("‼️ 적용하면 언제나 목표 문자열이 된다 — 서러게이트 쌍을 갈라도", () => {
    // 편집은 정의상 `접두 + 새 가운데 + 접미`라, 공통 접두가 이모지의 코드 유닛 쌍
    // 가운데에 떨어져도(📅=D83D DCC5 / 📈=D83D DCC8은 앞 유닛이 같다) 갈라진 짝이
    // 양쪽에 같은 유닛으로 남아 다시 붙는다. 마지막 셋이 그 경우다.
    const pairs: [string, string][] = [
      ["", "📅2026-09-01"],
      ["보고서 ⏫", "보고서 📅2026-09-01 ⏫"],
      ["x 🔁every week", "x 📅2026-09-01 🔁every week"],
      ["📅2026-08-30 보고서", "보고서"],
      ["x\t⏫", "x 📅2026-09-01 ⏫"],
      ["x 📅y", "x 📈y"],
      ["x 📅", "x 📈2026-01-01"],
      ["x 📅📈y", "x 📈y"],
    ];
    for (const [before, after] of pairs) {
      const edit = minimalEdit(before, after);
      const patched = edit
        ? before.slice(0, edit.at) +
          edit.insert +
          before.slice(edit.at + edit.remove)
        : before;
      expect(patched, `${before} → ${after}`).toBe(after);
      // 반쪽짜리 서러게이트가 남지 않았는지 — 코드 포인트 수로 확인한다.
      expect([...patched].length, `${before} → ${after}`).toBe(
        [...after].length,
      );
    }
  });
});
