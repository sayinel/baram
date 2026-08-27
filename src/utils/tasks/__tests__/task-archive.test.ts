// §312 아카이브 자격 판정 — 프런트 절반.
//
// ‼️ 이 표는 Rust `src-tauri/src/task/archive.rs`의 `archive_verdict`·`is_archive_source`와
// **같은 표**다. 아래 단정에 쓰는 날짜(2026-08-27 기준, 문턱 30, 경계 2026-07-28/29)와
// 폴더 이름("Archive")은 그쪽 테스트에도 같은 값으로 있다. 한쪽만 고치면 다른 쪽이
// 빨간불이 되도록 마주 적는다.
import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { ARCHIVE_DIR, archiveScope, selectArchivable } from "../task-archive";

/** 패널이 보고 있는 날 — Rust 쪽 `TODAY`와 같은 값. */
const NOW = new Date(2026, 7, 27);
const AFTER_DAYS = 30;
const SCOPE = archiveScope("/vault", "/vault/Inbox.md");

describe("§312 아카이브 자격", () => {
  it("폴더 이름은 Rust와 같은 글자다", () => {
    // 갈리면 프런트가 세는 대상과 Rust가 쓰는 대상이 다른 폴더가 된다.
    expect(ARCHIVE_DIR).toBe("Archive");
    expect(archiveScope("/vault", "/vault/Inbox.md").archiveRoot).toBe(
      "/vault/Archive",
    );
  });

  it("루트의 트레일링 슬래시가 `//`를 만들지 않는다", () => {
    expect(archiveScope("/vault/", "/vault/Inbox.md").archiveRoot).toBe(
      "/vault/Archive",
    );
  });

  it("수집함의 오래된 완료 태스크를 고른다", () => {
    const t = done("/vault/Inbox.md", "2026-07-04");
    expect(pick([t])).toEqual([t]);
  });

  it("문턱은 포함이다 — 딱 30일이면 고르고 29일이면 고르지 않는다", () => {
    expect(pick([done("/vault/Inbox.md", "2026-07-28")])).toHaveLength(1);
    expect(pick([done("/vault/Inbox.md", "2026-07-29")])).toHaveLength(0);
  });

  it("미래의 완료일은 결코 고르지 않는다", () => {
    expect(pick([done("/vault/Inbox.md", "2026-12-01")])).toHaveLength(0);
  });

  it("일반 문서의 완료 태스크는 §312 불가침 규칙으로 제외된다", () => {
    // 가장 파괴적인 실패 모드(§18.18 리스크 6). 프런트가 세지 않으므로 목록에
    // 들어가지 않고, 들어가더라도 Rust가 파일을 건드리기 전에 거절한다.
    expect(pick([done("/vault/notes/설계.md", "2026-07-04")])).toHaveLength(0);
  });

  it("이름이 겹치는 이웃 폴더는 아카이브가 아니다", () => {
    expect(
      pick([done("/vault/Archived/2026-07.md", "2026-07-04")]),
    ).toHaveLength(0);
    expect(pick([done("/vault/Inbox.md.bak", "2026-07-04")])).toHaveLength(0);
  });

  it("Archive/ 안의 잘못 든 줄은 고르고, 제 달에 있는 줄은 고르지 않는다", () => {
    // 대상 파일 이름은 **완료일**의 달에서 온다 — 오늘이 아니다. 자기 자신으로의
    // 이동을 막지 않으면 누를 때마다 줄이 파일 끝으로 이사한다.
    expect(
      pick([done("/vault/Archive/2026-08.md", "2026-07-04")]),
    ).toHaveLength(1);
    expect(
      pick([done("/vault/Archive/2026-07.md", "2026-07-04")]),
    ).toHaveLength(0);
  });

  it("들여쓴 항목은 고르지 않는다", () => {
    // 부모를 뽑으면 자식이 고아가 되고, 자식을 뽑으면 부모의 목록이 끊긴다.
    const nested = done("/vault/Inbox.md", "2026-07-04", { indent: 2 });
    expect(pick([nested])).toHaveLength(0);
  });

  it("완료일이 없는 완료 태스크는 고르지 않는다", () => {
    // `tasksRecordDoneDate`가 꺼져 있으면 생기는 줄. 나이를 모르므로 오래됐다고
    // 가정하지 않는다.
    const t = done("/vault/Inbox.md", "2026-07-04", { done: null });
    expect(pick([t])).toHaveLength(0);
  });

  it("달력에 없는 완료일은 고르지 않는다", () => {
    const t = done("/vault/Inbox.md", "2026-07-04", { done: "2026-02-31" });
    expect(pick([t])).toHaveLength(0);
  });

  it("미완료는 아무리 오래돼도 고르지 않는다", () => {
    const t = done("/vault/Inbox.md", "2020-01-01", { state: "todo" });
    expect(pick([t])).toHaveLength(0);
  });

  it("Windows 구분자도 같은 경로로 본다", () => {
    // Rust `windows_separators_compare_equal_to_forward_slashes`와 같은 계약.
    // 인덱스의 `TaskEntry.path`는 플랫폼 구분자로 오고 `capturePath`는 `/`로 이어 붙여
    // 만들어진다 — 여기서 맞추지 않으면 Windows에서 대상이 영영 0이라 버튼이 뜨지 않는다.
    const scope = archiveScope("C:\\v", "C:\\v/Inbox.md");
    expect(
      selectArchivable(
        [done("C:\\v\\Inbox.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(1);
    expect(
      selectArchivable(
        [done("C:\\v\\Archive\\2026-08.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(1);
    expect(
      selectArchivable(
        [done("C:\\v\\notes\\설계.md", "2026-07-04")],
        scope,
        NOW,
        AFTER_DAYS,
      ),
    ).toHaveLength(0);
  });

  it("문턱을 0으로 두면 오늘 끝낸 것도 고른다", () => {
    const t = done("/vault/Inbox.md", "2026-08-27");
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
