// §306/§315 태스크 행 사이의 포커스 이동 — `j`/`k`가 실제로 하는 일.
//
// 아젠다와 주간 리뷰가 **같은 키 표**(`task-row-keys.ts`)를 쓰지만 이동 범위는 다르다.
// 아젠다에서 `j`는 버킷 안에서 멈춘다(버킷은 접힐 수 있고, 접힌 버킷을 건너뛰어 다음
// 버킷으로 넘어가면 사용자가 보지 못한 항목에 포커스가 간다). 리뷰는 반대로 세 묶음을
// 한 흐름으로 훑는 화면이라 경계에서 멈추면 그 화면의 목적이 사라진다 — 훑는 속도가
// 전부인 화면이다(§315).
//
// 그래서 범위는 **호출자가 준다**. 규칙을 두 벌로 쓰는 대신 인자 하나로 가른다.

/** 아젠다의 이동 범위 — 한 버킷의 목록. */
export const AGENDA_ROW_SCOPE = ".task-bucket-list";

/**
 * `from`에서 `delta`칸 떨어진 행으로 포커스를 옮긴다. 끝에서는 멈춘다(순환하지 않는다).
 *
 * 순환하지 않는 이유: 이 화면들의 목록은 "처리하면 사라지는" 큐라, 마지막에서 첫 항목으로
 * 돌아가면 이미 지나온 것을 다시 보는 것인지 새로 생긴 것인지 구별할 수 없다.
 *
 * DOM을 직접 읽는다 — React state로 "선택된 행"을 들고 있으면 그 값과 실제 포커스가
 * 갈라질 수 있고(마우스 클릭·Tab·메뉴 닫기가 전부 포커스를 옮긴다), 갈라지는 순간
 * 키 조작이 화면에 보이지 않는 행에 나간다.
 */
export function moveRowFocus(
  from: HTMLElement,
  delta: number,
  scopeSelector: string = AGENDA_ROW_SCOPE,
): void {
  const scope = from.closest(scopeSelector);
  if (!scope) return;
  const rows = [...scope.querySelectorAll<HTMLElement>("li.task-row")];
  rows[rows.indexOf(from) + delta]?.focus();
}

/**
 * `index`번째 행에 포커스를 준다. 그 자리가 비었으면 **마지막 행**으로 물러난다.
 *
 * §315 자동 전진이 쓰는 함수다. 항목을 처리하면 그 행이 목록에서 빠지므로, 같은 인덱스가
 * 곧 "다음 항목"이 된다 — 그래서 전진은 `index + 1`이 아니라 `index` 그대로다. 목록의
 * 마지막을 처리했을 때만 그 자리가 비고, 그때는 한 칸 위가 사용자가 다음에 볼 곳이다.
 *
 * 아무 행도 남지 않으면 아무것도 하지 않는다 — 호출자가 빈 상태를 그리고, 포커스는
 * 그 화면의 다른 곳(닫기 버튼 등)이 받는다.
 */
export function focusRowAt(
  scope: Element | null,
  index: number,
): HTMLElement | null {
  if (!scope) return null;
  const rows = [...scope.querySelectorAll<HTMLElement>("li.task-row")];
  if (rows.length === 0) return null;
  const target = rows[Math.min(index, rows.length - 1)];
  target?.focus();
  return target ?? null;
}

/** `scope` 안에서 이 행이 몇 번째인가. 없으면 `-1`. */
export function rowIndexOf(scope: Element | null, row: HTMLElement): number {
  if (!scope) return -1;
  return [...scope.querySelectorAll<HTMLElement>("li.task-row")].indexOf(row);
}
