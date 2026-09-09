// §338 기능 토글의 키. **이 모듈은 아무것도 import하지 않는다.**
//
// `store.ts`가 `activity-bar-config.ts`를 import하고(`store.ts:14-15`) 그 파일이 항목의
// 기능 소속을 선언해야 하므로, 타입이 스토어를 아는 모듈에 살면 순환이 된다. 값 간선이
// 없으면 TDZ 위험도 없다 — 그래서 타입과 배열만 여기 둔다.
export type FeatureKey = "ai" | "journal" | "tasks" | "zettelkasten";

/** 소진 산술 테스트가 이 배열에서 파생한다 — 손으로 센 숫자를 쓰지 않기 위해. */
export const FEATURE_KEYS: readonly FeatureKey[] = [
  "ai",
  "journal",
  "tasks",
  "zettelkasten",
] as const;
