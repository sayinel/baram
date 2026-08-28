// §312 아카이브 자격 판정 — 프런트 절반.
//
// ‼️ 이 표는 Rust `src-tauri/src/task/archive.rs`의 `archive_verdict`·`is_archive_source`와
// **같은 표**다. 아래 단정에 쓰는 날짜(2026-08-27 기준, 문턱 30, 경계 2026-07-28/29)와
// 서브트리 이름(`tasks/`·`tasks/archive/`)은 그쪽 테스트에도 같은 값으로 있다. 한쪽만
// 고치면 다른 쪽이 빨간불이 되도록 마주 적는다.
import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { archiveScope, selectArchivable } from "../task-archive";
import { ARCHIVE_DIR, TASKS_DIR } from "../tasks-home";

/** 패널이 보고 있는 날 — Rust 쪽 `TODAY`와 같은 값. */
const NOW = new Date(2026, 7, 27);
const AFTER_DAYS = 30;
/** §312.1 기본 배치 — 태스크 홈 `/home`, 수집함 `{home}/tasks/inbox.md`. */
const SCOPE = archiveScope("/home", "/home/tasks/inbox.md");

describe("§312 아카이브 자격", () => {
  it("서브트리 이름은 Rust와 같은 글자다", () => {
    // 갈리면 프런트가 세는 대상과 Rust가 쓰는 대상이 다른 폴더가 된다.
    expect(TASKS_DIR).toBe("tasks");
    expect(ARCHIVE_DIR).toBe("archive");
    expect(SCOPE.tasksRoot).toBe("/home/tasks");
    expect(SCOPE.archiveRoot).toBe("/home/tasks/archive");
  });

  it("홈의 트레일링 슬래시가 `//`를 만들지 않는다", () => {
    const scope = archiveScope("/home/", "/home/tasks/inbox.md");
    expect(scope.tasksRoot).toBe("/home/tasks");
    expect(scope.archiveRoot).toBe("/home/tasks/archive");
  });

  it("수집함의 오래된 완료 태스크를 고른다", () => {
    const t = done("/home/tasks/inbox.md", "2026-07-04");
    expect(pick([t])).toEqual([t]);
  });

  it("문턱은 포함이다 — 딱 30일이면 고르고 29일이면 고르지 않는다", () => {
    expect(pick([done("/home/tasks/inbox.md", "2026-07-28")])).toHaveLength(1);
    expect(pick([done("/home/tasks/inbox.md", "2026-07-29")])).toHaveLength(0);
  });

  it("미래의 완료일은 결코 고르지 않는다", () => {
    expect(pick([done("/home/tasks/inbox.md", "2026-12-01")])).toHaveLength(0);
  });

  it("일반 문서의 완료 태스크는 §312 불가침 규칙으로 제외된다", () => {
    // 가장 파괴적인 실패 모드(§18.18 리스크 6). 프런트가 세지 않으므로 목록에
    // 들어가지 않고, 들어가더라도 Rust가 파일을 건드리기 전에 거절한다.
    expect(pick([done("/home/notes/설계.md", "2026-07-04")])).toHaveLength(0);
  });

  it("태스크 홈 바로 아래라도 `tasks/` 밖이면 일반 문서다", () => {
    // 홈의 기본값은 Zettel 디렉터리이므로 홈 바로 아래에는 사용자의 노트가 산다.
    // 여기서 경계가 새면 불가침 규칙이 통째로 무너진다.
    expect(pick([done("/home/생각.md", "2026-07-04")])).toHaveLength(0);
  });

  it("`tasks/` 아래는 수집함도 아카이브도 아니어도 원본이다", () => {
    // §312.1이 화이트리스트를 서브트리 전체로 넓혔다 — 손으로 나눠 둔 목록에서도 돈다.
    expect(pick([done("/home/tasks/프로젝트.md", "2026-07-04")])).toHaveLength(
      1,
    );
  });

  it("이름이 겹치는 이웃 폴더는 서브트리가 아니다", () => {
    expect(
      pick([done("/home/tasks-old/2026-07.md", "2026-07-04")]),
    ).toHaveLength(0);
    expect(pick([done("/home/tasksfoo.md", "2026-07-04")])).toHaveLength(0);
  });

  it("서브트리 밖에 둔 수집함은 그 파일만 예외로 허용된다", () => {
    // 사용자가 `tasksCaptureFile`을 옮겨 두어도 자기 수집함은 비울 수 있어야 한다.
    const scope = archiveScope("/home", "/home/기타/모아둠.md");
    const inbox = done("/home/기타/모아둠.md", "2026-07-04");
    const sibling = done("/home/기타/다른것.md", "2026-07-04");
    expect(selectArchivable([inbox], scope, NOW, AFTER_DAYS)).toHaveLength(1);
    expect(selectArchivable([sibling], scope, NOW, AFTER_DAYS)).toHaveLength(0);
  });

  it("archive/ 안의 잘못 든 줄은 고르고, 제 달에 있는 줄은 고르지 않는다", () => {
    // 대상 파일 이름은 **완료일**의 달에서 온다 — 오늘이 아니다. 자기 자신으로의
    // 이동을 막지 않으면 누를 때마다 줄이 파일 끝으로 이사한다.
    expect(
      pick([done("/home/tasks/archive/2026-08.md", "2026-07-04")]),
    ).toHaveLength(1);
    expect(
      pick([done("/home/tasks/archive/2026-07.md", "2026-07-04")]),
    ).toHaveLength(0);
  });

  it("들여쓴 항목은 고르지 않는다", () => {
    // 부모를 뽑으면 자식이 고아가 되고, 자식을 뽑으면 부모의 목록이 끊긴다.
    const nested = done("/home/tasks/inbox.md", "2026-07-04", { indent: 2 });
    expect(pick([nested])).toHaveLength(0);
  });

  it("자식을 거느린 부모는 개수에서 뺀다 — Rust가 어차피 막는다", () => {
    // 이 줄이 없으면 확인 문구가 "4개"를 약속하고 3개만 옮긴다. 부모-자식은 수집함에서
    // 드문 모양이 아니라 그 어긋남이 자주 보인다.
    const parent = done("/home/tasks/inbox.md", "2026-07-10", { line: 0 });
    const child: TaskEntry = {
      ...done("/home/tasks/inbox.md", "2026-07-04", { line: 1 }),
      indent: 2,
      state: "todo",
    };
    expect(pick([parent, child])).toHaveLength(0);
  });

  it("바로 아래 줄이 들여쓴 게 아니면 부모가 아니다", () => {
    const first = done("/home/tasks/inbox.md", "2026-07-10", { line: 0 });
    const second = done("/home/tasks/inbox.md", "2026-07-04", { line: 1 });
    expect(pick([first, second])).toHaveLength(2);
  });

  it("한 줄 건너뛴 들여쓴 항목은 부모로 보지 않는다 — 그 판정은 Rust만 한다", () => {
    // 인덱스는 줄 번호만 알고 그 사이가 빈 줄인지 다른 문단인지 모른다. 여기서 세고
    // Rust가 막으므로 `skipped`로 돌아온다 — 안전한 방향의 어긋남이다.
    const parent = done("/home/tasks/inbox.md", "2026-07-10", { line: 0 });
    const far: TaskEntry = {
      ...done("/home/tasks/inbox.md", "2026-07-04", { line: 2 }),
      indent: 2,
      state: "todo",
    };
    expect(pick([parent, far])).toHaveLength(1);
  });

  it("완료일이 없는 완료 태스크는 고르지 않는다", () => {
    // `tasksRecordDoneDate`가 꺼져 있으면 생기는 줄. 나이를 모르므로 오래됐다고
    // 가정하지 않는다.
    const t = done("/home/tasks/inbox.md", "2026-07-04", { done: null });
    expect(pick([t])).toHaveLength(0);
  });

  it("달력에 없는 완료일은 고르지 않는다", () => {
    const t = done("/home/tasks/inbox.md", "2026-07-04", {
      done: "2026-02-31",
    });
    expect(pick([t])).toHaveLength(0);
  });

  it("미완료는 아무리 오래돼도 고르지 않는다", () => {
    const t = done("/home/tasks/inbox.md", "2020-01-01", { state: "todo" });
    expect(pick([t])).toHaveLength(0);
  });

  it("Windows 구분자도 같은 경로로 본다", () => {
    // Rust `windows_separators_compare_equal_to_forward_slashes`와 같은 계약.
    // 인덱스의 `TaskEntry.path`는 플랫폼 구분자로 오고 `capturePath`는 `/`로 이어 붙여
    // 만들어진다 — 여기서 맞추지 않으면 Windows에서 대상이 영영 0이라 버튼이 뜨지 않는다.
    const scope = archiveScope("C:\\h", "C:\\h/tasks/inbox.md");
    expect(
      selectArchivable(
        [done("C:\\h\\tasks\\inbox.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(1);
    expect(
      selectArchivable(
        [done("C:\\h\\tasks\\archive\\2026-08.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(1);
    expect(
      selectArchivable(
        [done("C:\\h\\notes\\설계.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(0);
  });

  it("문턱을 0으로 두면 오늘 끝낸 것도 고른다", () => {
    const t = done("/home/tasks/inbox.md", "2026-08-27");
    expect(selectArchivable([t], SCOPE, NOW, 0)).toEqual([t]);
  });
});

function done(
  path: string,
  doneDate: string,
  over: Partial<TaskEntry> = {},
): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: doneDate,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path,
    priority: 0,
    raw: `- [x] 끝난 일 ✅${doneDate}`,
    recurrence: null,
    scheduled: null,
    start: null,
    state: "done",
    tags: [],
    text: "끝난 일",
    ...over,
  };
}

function pick(tasks: TaskEntry[]): TaskEntry[] {
  return selectArchivable(tasks, SCOPE, NOW, AFTER_DAYS);
}
