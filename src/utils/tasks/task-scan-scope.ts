// §312.1 아젠다 스캔 범위 — "무엇을 보고 있는가"를 사용자가 고른다.
//
// 종전에는 스캔 범위가 `useFileStore.rootPath` 하나였다. 컨텍스트를 바꾸면 목록이 통째로
// 갈렸고, 캡처 착지점도 같은 값에 매달려 있어서 태스크 시스템이 컨텍스트 수만큼 있었다.
// §312.1이 그 둘을 갈라 캡처는 태스크 홈에 고정하고, 보는 범위는 여기서 고르게 한다.

import { isUnderRoot, toPosixPath } from "../path-utils";

/**
 * | 범위 | 스캔 대상 |
 * |---|---|
 * | `tasksHome` | 태스크 홈 아래 — 배수구(🗄️)가 켜지는 유일한 범위다 |
 * | `currentVault` | 활성 컨텍스트 루트 (§312.1 이전의 동작) |
 * | `allVaults` | 볼트탭에 열려 있는 vault 전부 + 태스크 홈 (기본값) |
 */
export type TaskScanScope = "allVaults" | "currentVault" | "tasksHome";

/** 설정 UI와 검증이 함께 쓰는 목록 — 값이 늘면 여기 한 곳만 고친다. */
export const TASK_SCAN_SCOPES: readonly TaskScanScope[] = [
  "allVaults",
  "currentVault",
  "tasksHome",
];

export interface ScanRootSources {
  /** 활성 컨텍스트 루트 (`useFileStore.rootPath`) */
  rootPath: null | string;
  /** 해석된 태스크 홈 (`resolveTasksHome`) */
  tasksHome: null | string;
  /** 볼트탭에 열려 있는 vault 컨텍스트의 경로 — 탭 순서 그대로 */
  vaultPaths: string[];
}

/**
 * 겹치거나 비어 있는 루트를 걸러 **실제로 스캔할 목록**만 남긴다. 입력 순서를 지키고
 * 원본 문자열을 그대로 돌려준다 — 정규화는 비교에만 쓴다(IPC가 받는 것은 사용자의 경로다).
 *
 * ‼️ 다른 루트 **아래**에 있는 루트를 반드시 뺀다. Zettel 디렉터리를 vault 안에 두는 것은
 * 흔한 배치이고, 그대로 두 번 스캔하면 같은 태스크가 목록에 두 번 뜬다 — 체크하면 한 줄만
 * 사라지고 나머지 하나가 남아 유령이 된다. 판정은 Rust `is_under`(archive.rs)와 같은 규칙인
 * `isUnderRoot`로 한다.
 */
export function dedupeScanRoots(roots: (null | string)[]): string[] {
  const kept: { normalized: string; raw: string }[] = [];

  for (const raw of roots) {
    if (!raw) continue;
    const normalized = toPosixPath(raw);
    if (!normalized) continue;
    if (kept.some((k) => k.normalized === normalized)) continue;
    // 이미 담은 루트 아래면 그쪽 스캔이 이 루트를 덮는다.
    if (kept.some((k) => isUnderRoot(normalized, k.normalized))) continue;
    // 반대로 이 루트가 이미 담은 것들의 상위면 그것들을 흡수한다.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (isUnderRoot(kept[i].normalized, normalized)) kept.splice(i, 1);
    }
    kept.push({ normalized, raw });
  }

  return kept.map((k) => k.raw);
}

/**
 * 이 범위가 실제로 스캔할 루트 목록.
 *
 * ‼️ 호출자는 이 목록을 **동시에** 불러야 한다(`Promise.all`). 실측에서 루트 3개 × 1만
 * 파일이 순차 1.24초 / 동시 0.74초였다 — `for await` 루프로 부르면 그 1.68배가 그대로
 * 사라진다(§18.7.1 "스캔 비용 실측").
 */
export function resolveScanRoots(
  scope: TaskScanScope,
  src: ScanRootSources,
): string[] {
  switch (scope) {
    case "allVaults":
      // 태스크 홈을 **반드시 함께** 넣는다. 캡처가 거기 착지하는데 목록이 그 자리를 보지
      // 않으면 방금 잡은 태스크가 기본 화면에서 사라진다 — §312.1이 "가장 나쁜 조합"이라고
      // 부른 상태 그 자체다. 홈이 열린 vault 안이거나 그 자신이 볼트탭에 있으면 위
      // `dedupeScanRoots`가 흡수하므로 대개 아무것도 늘지 않는다.
      return dedupeScanRoots([...src.vaultPaths, src.tasksHome]);
    case "currentVault":
      return dedupeScanRoots([src.rootPath]);
    case "tasksHome":
      return dedupeScanRoots([src.tasksHome]);
  }
}
