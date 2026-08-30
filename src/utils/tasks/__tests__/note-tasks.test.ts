import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { noteIdentity, tasksForNote } from "../note-tasks";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "/v/other.md",
    priority: 0,
    raw: "- [ ] x",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "x",
    ...over,
  };
}

const ZETTEL = noteIdentity("/v/notes/202607051530 원자적 노트.md");
const PLAIN = noteIdentity("/v/프로젝트.md");

describe("noteIdentity", () => {
  it("Zettel 노트에서 ID와 stem을 함께 뽑는다", () => {
    expect(ZETTEL.id).toBe("202607051530");
    expect(ZETTEL.stem).toBe("202607051530 원자적 노트");
  });

  it("ID가 없는 일반 노트는 stem만 갖는다", () => {
    expect(PLAIN.id).toBeNull();
    expect(PLAIN.stem).toBe("프로젝트");
  });

  it("ID처럼 보여도 하이픈으로 붙은 것은 ID가 아니다", () => {
    // Rust `extract_id_from_stem`의 규칙과 같아야 한다 — 여기서 갈리면 같은 파일을
    // 두 층이 다른 노트로 본다.
    expect(noteIdentity("/v/202607051530-note.md").id).toBeNull();
  });

  it("Windows 경로에서도 파일명을 찾는다", () => {
    expect(noteIdentity("C:\\v\\notes\\프로젝트.md").stem).toBe("프로젝트");
  });
});

describe("tasksForNote — 무엇이 이 노트의 것인가", () => {
  it("ID로 걸린 링크를 잡는다", () => {
    const t = task({ links: ["202607051530"] });
    expect(tasksForNote([t], ZETTEL)).toEqual([t]);
  });

  it("파일명으로 걸린 링크를 잡는다 — 일반 vault", () => {
    // §18.18-5: 인덱스는 `[[…]]` 원문을 담는다. Zettel vault에서는 ID이지만 일반
    // vault에서는 파일명이다.
    const t = task({ links: ["프로젝트"] });
    expect(tasksForNote([t], PLAIN)).toEqual([t]);
  });

  it("노트 **안에** 적힌 태스크도 같은 목록에 넣는다", () => {
    // 설계 §18.6 A: 사용자에게 "이 노트와 관련된 할 일"은 하나의 목록이다.
    const t = task({ path: PLAIN.path });
    expect(tasksForNote([t], PLAIN)).toEqual([t]);
  });

  it("‼️ 노트 안에서 자기 자신을 링크한 줄도 한 번만 나온다", () => {
    // 두 목록(링크된 것 / 안에 적힌 것)을 이어 붙이는 구현으로 바뀌면 이 줄이 두 번 뜬다.
    const t = task({ links: ["프로젝트"], path: PLAIN.path });
    expect(tasksForNote([t], PLAIN)).toHaveLength(1);
  });

  it("별칭과 앵커를 벗기고 대상만 본다", () => {
    const alias = task({ links: ["202607051530|원자성"], line: 1 });
    const heading = task({ links: ["202607051530#정의"], line: 2 });
    const block = task({ links: ["202607051530^abc123"], line: 3 });
    expect(tasksForNote([alias, heading, block], ZETTEL)).toHaveLength(3);
  });

  it("폴더가 붙은 링크도 같은 노트로 본다", () => {
    const t = task({ links: ["notes/프로젝트.md"] });
    expect(tasksForNote([t], PLAIN)).toEqual([t]);
  });

  it("파일명 대조는 대소문자를 가리지 않는다", () => {
    const t = task({ links: ["PROJECT"] });
    expect(tasksForNote([t], noteIdentity("/v/project.md"))).toEqual([t]);
  });

  it("‼️ 대상이 빈 링크는 어떤 노트도 가리키지 않는다", () => {
    // `[[#정의]]`(같은 파일 안 앵커)가 벗겨지면 대상이 빈 문자열이 되는 유일한 형태다.
    // 빈 문자열을 그냥 통과시키면 **stem도 빈** 노트에서 그 둘이 같아진다 — 열린 파일이
    // 없을 때 호출부가 빈 경로를 넘기면 그 화면이 남의 태스크로 가득 찬다.
    const t = task({ links: ["#정의"] });
    expect(tasksForNote([t], ZETTEL)).toEqual([]);
    expect(tasksForNote([t], noteIdentity(""))).toEqual([]);
  });

  it("다른 노트의 태스크는 들어오지 않는다", () => {
    const t = task({ links: ["202607051531"] });
    expect(tasksForNote([t], ZETTEL)).toEqual([]);
  });

  it("ID의 부분 일치로는 걸리지 않는다", () => {
    // `202607051530`이 `2026070515301`의 접두라고 해서 같은 노트가 아니다.
    const t = task({ links: ["2026070515301"] });
    expect(tasksForNote([t], ZETTEL)).toEqual([]);
  });
});

describe("tasksForNote — 순서", () => {
  it("미완료가 완료보다 먼저다 — 기한이 어떻든", () => {
    // 버킷이 없는 납작한 목록이라 완료된 것이 위로 올라오면 남은 일이 안 보인다.
    const done = task({
      due: "2026-01-01",
      line: 1,
      path: PLAIN.path,
      state: "done",
    });
    const todo = task({ line: 2, path: PLAIN.path });
    expect(tasksForNote([done, todo], PLAIN).map((x) => x.line)).toEqual([
      2, 1,
    ]);
  });

  it("기한 오름차순, 기한 없는 것이 뒤", () => {
    const none = task({ line: 1, path: PLAIN.path });
    const late = task({ due: "2026-09-01", line: 2, path: PLAIN.path });
    const soon = task({ due: "2026-08-30", line: 3, path: PLAIN.path });
    expect(tasksForNote([none, late, soon], PLAIN).map((x) => x.line)).toEqual([
      3, 2, 1,
    ]);
  });

  it("같은 기한이면 우선순위 내림차순", () => {
    const low = task({ due: "2026-08-30", line: 1, path: PLAIN.path });
    const high = task({
      due: "2026-08-30",
      line: 2,
      path: PLAIN.path,
      priority: 2,
    });
    expect(tasksForNote([low, high], PLAIN).map((x) => x.line)).toEqual([2, 1]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const a = task({ due: "2026-09-01", line: 1, path: PLAIN.path });
    const b = task({ due: "2026-08-30", line: 2, path: PLAIN.path });
    const input = [a, b];
    tasksForNote(input, PLAIN);
    expect(input).toEqual([a, b]);
  });
});
