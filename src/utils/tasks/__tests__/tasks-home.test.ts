// §312.1 태스크 홈 해석 — 캡처와 배수구가 같은 자리를 가리키는지.
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_DIR,
  archiveRootOf,
  DEFAULT_CAPTURE_FILE,
  resolveTasksHome,
  TASKS_DIR,
  tasksRootOf,
} from "../tasks-home";

describe("resolveTasksHome", () => {
  it("설정된 절대 경로를 그대로 쓴다", () => {
    expect(resolveTasksHome("/home/tasks-home", "/zettel")).toBe(
      "/home/tasks-home",
    );
  });

  it("비어 있으면 Zettel 디렉터리로 떨어진다 — 그것이 기본값이다", () => {
    expect(resolveTasksHome("", "/zettel")).toBe("/zettel");
  });

  it("상대 경로는 홈이 되지 못한다 — 컨텍스트마다 다른 폴더를 가리키게 된다", () => {
    expect(resolveTasksHome("zettel", "")).toBeNull();
    expect(resolveTasksHome("./tasks", "")).toBeNull();
  });

  it("둘 다 없으면 null — 호출자가 시끄럽게 실패한다", () => {
    expect(resolveTasksHome("", "")).toBeNull();
  });

  it("쓸 수 없는 홈은 Zettel로 미끄러지지 않는다", () => {
    // 사용자가 홈을 **지정했다**. 그 값이 쓸 수 없다는 사실을 다른 폴더로 조용히 덮으면,
    // 캡처가 사용자가 지목하지 않은 자리에 쌓이고 그 사실이 어디에도 드러나지 않는다.
    expect(resolveTasksHome("tasks", "/zettel")).toBeNull();
  });

  it("공백만 든 홈은 비어 있는 것으로 본다 — 입력창을 지우는 중일 수 있다", () => {
    expect(resolveTasksHome("   ", "/zettel")).toBe("/zettel");
  });

  it("Windows 드라이브 문자도 절대 경로다", () => {
    expect(resolveTasksHome("C:\\notes\\zettel", "")).toBe("C:\\notes\\zettel");
  });

  it("트레일링 구분자를 떼어 `//`를 만들지 않는다", () => {
    expect(resolveTasksHome("/home/", "")).toBe("/home");
    expect(tasksRootOf("/home/")).toBe("/home/tasks");
    expect(archiveRootOf("/home//")).toBe("/home/tasks/archive");
  });
});

describe("서브트리 배치", () => {
  it("Rust와 같은 글자를 쓴다", () => {
    // `task/archive.rs`의 `TASKS_DIR`·`ARCHIVE_DIR`과 마주 적는다 — 갈리면 프런트가
    // 세는 폴더와 Rust가 쓰는 폴더가 달라진다.
    expect(TASKS_DIR).toBe("tasks");
    expect(ARCHIVE_DIR).toBe("archive");
  });

  it("기본 수집함은 서브트리 안이다 — 그래야 화이트리스트가 한 줄이 된다", () => {
    expect(DEFAULT_CAPTURE_FILE).toBe(`${TASKS_DIR}/inbox.md`);
  });

  it("아카이브는 서브트리 아래다 — 홈 바로 아래가 아니다", () => {
    expect(tasksRootOf("/home")).toBe("/home/tasks");
    expect(archiveRootOf("/home")).toBe("/home/tasks/archive");
  });
});
