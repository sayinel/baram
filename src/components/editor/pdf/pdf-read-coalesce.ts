// §276.5 키별 in-flight 합류(coalescing). **캐시가 아니다** — 진행 중인 읽기
// 하나를 여럿이 나눠 쓸 뿐, settle되는 즉시 아무것도 남기지 않는다.
//
// 왜 공유 헬퍼인가: 참조 프리뷰 경로에는 같은 모양의 읽기가 둘 있다(동반 노트,
// 사이드카). 두 곳이 각자 맵을 들고 있으면 "settle 시 제거"처럼 조용히 캐시로
// 변질되는 한 줄을 두 곳에서 지켜야 한다.
//
// ‼️ 결과를 캐시하지 않는 이유는 두 읽기가 서로 다르다:
// • 동반 노트 — 사용자가 직접 편집하는 파일이고 읽기가 열린 버퍼를 먼저 본다.
//   캐시하면 사용자가 문단을 고쳐도 참조가 옛 텍스트에 고정된다.
// • 사이드카 — 하이라이트를 추가/삭제할 때 **우리 자신이** 덮어쓴다.
//   캐시하면 방금 만든 하이라이트가 참조에서 보이지 않는다.
// 어느 쪽도 TTL로 완화하지 않는다(같은 결함을 확률적으로 만들 뿐이다).

/** 합류된 읽기. 두 번째 인자는 실제 읽기 함수(테스트 주입 지점). */
export type CoalescedRead<T> = (
  key: string,
  read: (key: string) => Promise<null | T>,
) => Promise<null | T>;

/**
 * 키별로 진행 중인 읽기에 합류시키는 함수를 만든다. 호출자마다 자기 맵을
 * 갖는다.
 *
 * 돌려주는 Promise는 **절대 reject하지 않는다** — 합류자들이 각자 catch를
 * 달지 않아도 되도록 실패를 null로 접는다. 진단 로그는 여기서 남기지 않는다:
 * 실패를 아는 것은 읽기 함수이고(경로·원인·복구 가능성까지 알고 있다), 여기서
 * 한 번 더 찍으면 실패 하나가 로그 두 줄이 된다.
 */
export function createReadCoalescer<T>(): CoalescedRead<T> {
  const inFlight = new Map<string, Promise<null | T>>();

  return (key, read) => {
    const existing = inFlight.get(key);
    if (existing) return existing;

    // ‼️ `read(key)`를 그냥 부르지 않고 async 래퍼 안에서 부른다. 동기적으로
    // 던지는 읽기 함수는 Promise를 만들지도 못해 아래 `.catch`를 그냥
    // 지나가고, "던지지 않는다"는 계약이 깨진다. async 함수의 본문은 첫
    // await까지 동기로 실행되므로 읽기 시작이 미뤄지지는 않는다 —
    // 마이크로태스크 하나만큼도 늦지 않아야 같은 tick에 들어온 요청들이
    // 확실히 합류한다.
    const started = (async () => read(key))()
      .catch(() => null)
      .finally(() => {
        // settle 즉시 제거 — 이 한 줄이 빠지면 이 모듈은 캐시가 된다.
        inFlight.delete(key);
      });

    inFlight.set(key, started);
    return started;
  };
}
