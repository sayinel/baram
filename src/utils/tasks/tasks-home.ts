// §312.1 태스크 홈 — 캡처와 배수구가 사는 **한 자리**.
//
// 왜 이것이 필요했나: 캡처 착지점(`resolveCapturePath(rootPath, …)`)과 아젠다 스캔 범위
// (`refreshAllTasks(rootPath, …)`)가 둘 다 `useFileStore.rootPath`에 매달려 있었다. 컨텍스트를
// 바꾸면 수집함도 목록도 통째로 갈렸으므로, **태스크 시스템이 하나가 아니라 컨텍스트 수만큼
// 있었다.** §18.0의 "태스크는 어디에 있든 인덱싱되므로 수집함에서 꺼낼 필요가 없다"는 문장은
// 하나의 큐를 전제한다 — 그 전제가 성립하지 않고 있었다.
//
// 기본값은 Zettel 디렉터리지만 **종속은 아니다**. `tasksEnabled`는 기본 참이고
// `zettelkastenEnabled`는 아니므로, 캡처가 Zettel 설정 상태의 인질이 되면 안 된다. 그래서
// 여기서 보는 것은 `zettelkastenDirectory`(경로)이지 `zettelkastenEnabled`(토글)가 아니다.

import { resolveAbsoluteDirSetting } from "../path-utils";

/**
 * 아카이브 폴더 — `{tasksHome}/tasks/` 기준. Rust `ARCHIVE_DIR`(task/archive.rs)과
 * **같은 글자**여야 한다. `inbox/`·`notes/`와 나란히 읽히도록 소문자다.
 */
export const ARCHIVE_DIR = "archive";

/**
 * 설정값이 비었을 때(입력창을 지우는 중일 수 있다) 쓸 기본 수집함 파일 이름.
 *
 * ‼️ 이것은 `{tasksHome}/tasks/` **안**의 이름이지 홈 기준 경로가 아니다. 폴더까지 설정에
 * 적게 두면 그 값이 서브트리 밖을 가리킬 수 있고, 그러면 §312 불가침 규칙의 화이트리스트에
 * "수집함 파일은 예외" 조항이 영영 남는다 — 결정 3이 없애려던 두 갈래가 이름만 바꿔
 * 되살아난다. 규칙이 `tasks/`라면 설정이 그 폴더를 되풀이할 이유가 없다.
 */
export const DEFAULT_CAPTURE_FILE = "inbox.md";

/**
 * 태스크 전용 서브트리 — 태스크 홈 기준. Rust `TASKS_DIR`(task/archive.rs)과 **같은 글자**여야
 * 한다. 수집함도 아카이브도 이 아래 살고, 그래서 §312 불가침 규칙의 화이트리스트가 한 줄이 된다.
 */
export const TASKS_DIR = "tasks";

/** `{home}/tasks/archive` — 아카이브 대상 파일이 사는 곳. */
export function archiveRootOf(home: string): string {
  return `${tasksRootOf(home)}/${ARCHIVE_DIR}`;
}

/**
 * 태스크 홈의 절대 경로. 어느 쪽도 절대 경로를 주지 못하면 `null`.
 *
 * `null`은 "설정되지 않음"이고, 캡처는 그때 조용히 아무 데나 쓰는 대신 코드를 달아 실패한다
 * (`CaptureError("noTasksHome")`). 캡처가 잃는 것은 다시 누르면 되는 체크 토글이 아니라 다른
 * 어디에도 없는 사용자의 문장이므로, 보이지 않는 곳에 쓰고 성공을 보고하지 않는다(§312).
 *
 * ‼️ `rootPath`로 폴백하지 않는다. 그것이 §312.1이 없애려던 결함 그 자체다 — 폴백을 두면
 * 설정하지 않은 사용자에게는 종전의 "컨텍스트 따라 떠다니는 수집함"이 그대로 남고, 그 사용자가
 * 바로 이 문제를 겪는 사람이다.
 */
export function resolveTasksHome(
  tasksHome: string,
  zettelkastenDirectory: string,
): null | string {
  // ‼️ 폴백은 설정이 **비어 있을 때만** 일어난다. 값이 있는데 쓸 수 없는 경우(상대 경로)
  // 까지 Zettel로 미끄러지면, 사용자가 지목한 자리가 아닌 곳에 캡처가 쌓이고 그 사실이
  // 어디에도 드러나지 않는다. 지목했으나 쓸 수 없다는 것은 조용히 덮을 사실이 아니다.
  if (tasksHome.trim() !== "") return resolveAbsoluteDirSetting(tasksHome);
  return resolveAbsoluteDirSetting(zettelkastenDirectory);
}

/** `{home}/tasks` — 이 아래 전부가 §312 불가침 규칙의 화이트리스트다. */
export function tasksRootOf(home: string): string {
  return `${resolveAbsoluteDirSetting(home) ?? home}/${TASKS_DIR}`;
}
