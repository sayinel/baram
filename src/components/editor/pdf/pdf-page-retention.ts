// §282.3 페이지 렌더 캐시의 수명 관리 — `PDFPageProxy.cleanup()`을 부르는 유일한 곳.
//
// ## 무엇이 새는가
//
// `page.render()`는 `page._intentStates`에 operator list를, `page.objs`에 디코드된
// 이미지·폰트를 채운다. 그 둘을 비우는 것은 `cleanup()`뿐인데 앱 어디에서도 부르지
// 않았다. 페이지를 한 번 지나가면 그 캐시는 **탭이 닫힐 때까지** 남는다.
//
// 실측 (pdfjs 6.2.108, 텍스트만 있는 60페이지 문서, node --expose-gc):
//   getPage × 60 (프록시만)      +0.2 MB   ← 프록시 자체는 사실상 공짜다
//   getOperatorList × 60         +41.2 MB  ← 페이지당 ~687 KB
//   cleanup() × 60 후            -22.5 MB  회수
// 150페이지를 훑으면(한 번에 4페이지 표시) 안정 상태가 103.4MB였고, 이 레지스트리를
// 끼우면 46.2MB에서 멎는다 — 보유 페이지가 150/150에서 상한 그대로 10/150이 된다.
//
// ‼️ 위 숫자는 **operator list만**이다. `objs`(디코드된 이미지)는 측정하지 않았다 —
// 그 경로는 실제 `render()`로만 채워지는데(oplist intent로는 비트맵이 메인 스레드로
// 오지 않는 것을 확인했다: 4MB 이미지 12장이 0.6MB로 잡혔다) node/jsdom에는 canvas
// 2D가 없어 render()를 돌릴 수 없다. 스캔본이 더 나쁘리라는 것은 합리적 추측일 뿐
// **확인된 사실이 아니다**. 상한 10의 근거는 이 operator list 실측과 pdfjs 자체
// 뷰어의 기본값이지 비트맵 실측이 아니다 — 스캔본 프로파일은 backlog §282.3에 남겼다.
//
// ## 왜 refcount가 필요한가 — cleanup()이 이미 안전한데도
//
// `#tryCleanup`(pdf.mjs:22205)은 **렌더가 진행 중이면 스스로 거부한다**
// (`renderTasks.size > 0 || !operatorList.lastChunk` → false). 그래서 아무 때나
// 불러도 그림이 깨지지는 않는다. 하지만 그것이 지키는 것은 "지금 이 순간 그리는
// 중"뿐이고, 우리가 지켜야 하는 것은 **"아직 화면에 붙어 있다"**이다. 같은 프록시를
// 세 곳이 그린다:
//   PdfPage(본문) · PdfThumbnail(레일 페이지 목록) · PdfHighlightListItem(영역 크롭)
// 썸네일이 스크롤로 사라졌다고 cleanup()을 부르면, 본문이 그대로 띄워 둔 페이지의
// operator list가 날아가 다음 줌에서 워커 왕복을 다시 한다. 셋이 **모두** 놓았을
// 때만 비우는 것이 이 클래스의 존재 이유다.
//
// ‼️ 그리고 cleanup()에는 래치가 있다. `cleanup()`은 먼저 `#pendingCleanup = true`를
// 세운 뒤(pdf.mjs:22198) `#tryCleanup()`을 부르는데, 거절당해 false를 돌려주더라도
// **그 플래그는 남는다**. 렌더가 끝날 때 `complete`가 `#tryCleanup()`을 다시 부르므로
// (pdf.mjs:22039) 그 순간 대신 비워진다. 우리가 부르지 않은 cleanup이 뒤늦게 발화하는
// 셈이다 — 이 동작은 pdf-page-retention-pdfjs.test.ts가 진짜 문서로 고정해 뒀다.
//
// 그래서 호출부는 **cancel() 다음에** 놓아야 한다 — `InternalRenderTask.cancel()`은
// `this.callback(error)`를 동기로 부르고(pdf.mjs:23288) 그 콜백(`complete`)이
// `renderTasks.delete`를 동기로 실행하므로, cancel 직후의 cleanup()은 즉시 성공하고
// 래치를 남기지 않는다. 세 컴포넌트의 effect cleanup이 전부
// `task.cancel(); release();` 순서인 이유다.
//
// (래치가 무한정 해로운 것은 아니다 — 새 `render()`가 진입하면서 스스로
//  `#pendingCleanup = false`로 되돌린다(pdf.mjs:22000). 그래도 그 사이에 끝난
//  렌더 하나가 캐시를 날리는 낭비는 남으므로 순서를 지킨다.)
import type { PDFPageProxy } from "pdfjs-dist";

/**
 * 아무도 보고 있지 않은 채로 렌더 캐시를 유지할 페이지 수의 상한.
 *
 * ‼️ 이 상한은 **놓인(released) 페이지만** 센다. 붙잡힌 페이지는 개수와 무관하게
 * 절대 비우지 않는다 — 화면에 있는 것을 비우는 것은 언제나 틀렸고, 세 표면이
 * 동시에 그리면 붙잡힌 페이지만 15~20개가 되므로 전체를 세는 방식(pdf-doc-cache의
 * `cache.size > MAX`)은 여기서 "놓자마자 즉시 축출"이 되어 완충이 사라진다.
 *
 * 완충이 필요한 이유: 본문의 지연 렌더 여유가 800px이라 한 화면만 스크롤해도
 * 페이지가 놓인다. 즉시 비우면 되돌아올 때마다 operator list를 워커에서 다시
 * 받아야 한다(위 실측의 페이지당 ~687 KB를 매번 다시 파싱).
 *
 * 값의 근거는 pdfjs 자체 뷰어다 — `DEFAULT_CACHE_SIZE = 10`
 * (legacy/web/pdf_viewer.mjs:12875). 그쪽은 보이는 페이지 수에 따라
 * `max(10, 2 × visible + 1)`로 늘린다(pdf_viewer.mjs:14094). 우리가 그 확장 없이
 * 고정 상한을 쓸 수 있는 이유는 붙잡힌 페이지를 **세지 않기** 때문인데, 그 전제가
 * 성립하려면 세는 시점이 옳아야 한다 — `#scheduleEviction`의 주석 참조.
 */
export const MAX_RELEASED_PDF_PAGES = 10;

interface Entry {
  lastUsed: number;
  refCount: number;
}

/**
 * 한 문서의 페이지 렌더 캐시 수명을 쥐는 레지스트리.
 *
 * 문서마다 **새 인스턴스**를 쓴다(PdfPreview가 `doc`이 바뀔 때마다 만든다).
 * 모듈 전역 싱글턴이 아닌 이유: 여기 담긴 키는 특정 문서의 프록시라, 문서가
 * 바뀐 뒤에도 같은 맵을 쓰면 이미 파기된 프록시를 붙들고 있게 된다.
 */
export class PdfPageRetention {
  /**
   * 현재 추적 중인 페이지 수(붙잡힌 것 + 놓였지만 아직 살아 있는 것).
   *
   * @internal 테스트가 축출 정책을 관찰하기 위한 창이다. 제품 코드에서 읽지 말 것 —
   * 이 값으로 분기하면 렌더가 캐시 정책에 의존하게 되고, 그 순간 "캐시는 성능
   * 최적화일 뿐"이라는 이 클래스의 전제가 깨진다.
   */
  get trackedCount(): number {
    return this.#entries.size;
  }

  /** 단조 증가 카운터 — LRU 기준. pdf-doc-cache.ts와 같은 이유로 Date.now()가 아니다. */
  #clock = 0;

  #disposed = false;

  readonly #entries = new Map<PDFPageProxy, Entry>();

  #evictionScheduled = false;

  readonly #maxReleased: number;

  constructor(maxReleased: number = MAX_RELEASED_PDF_PAGES) {
    this.#maxReleased = maxReleased;
  }

  /**
   * 이 레지스트리를 버린다. 문서 교체/언마운트에서 부른다.
   *
   * ‼️ 예전 주석은 "문서를 `loadingTask.destroy()`로 파기하면 페이지도 함께 정리되므로
   * 메모리 관점에서는 없어도 된다"고 적고 있었다. **그 전제가 사라졌다** — §291 재방문
   * 로딩을 줄이려고 PdfPreview가 문서를 pdf-doc-cache에서 **임대**하게 되었고, 그래서
   * 문서는 표면보다 오래 산다. 이제 이 레지스트리가 페이지 렌더 캐시를 비우는 **유일한**
   * 경로다.
   *
   * ‼️ **붙잡혀 있는 페이지는 이 시점에 건드리지 않는다.** 처음엔 전부 비웠는데, 그것이 이
   * 파일 맨 위의 순서 계약을 레지스트리 쪽에서 깬다: React의 passive destroy 순회
   * 방향이 경로마다 달라 **언마운트와 StrictMode 더블 인보크에서는 부모가 먼저**
   * 돈다(리뷰 실측). 그 두 경로에서 dispose는 아직 `renderTasks`가 살아 있는
   * 페이지에 cleanup()을 걸게 되고, 거절당하면서 남긴 래치가 곧이어 도착하는
   * 자식의 `cancel()`에서 발화한다 — §282.3이 막으려던 바로 그 시나리오다.
   *
   * 비우는 일은 **홀더가 놓는 순간**으로 미룬다 — 릴리스 클로저가 자기 엔트리를 직접
   * 붙들고 있으므로 맵을 비워도 그 계수는 살아 있다(그래서 여기서 맵을 비우는 것은
   * 안전하다). 그 시점의 cleanup()은 호출부가 `cancel(); release()` 순서를 지키는 덕에
   * 즉시 성공하고 래치를 남기지 않는다. 아래 릴리스의 `#disposed` 분기가 그 일을 한다.
   */
  dispose(): void {
    this.#disposed = true;
    for (const [page, entry] of this.#entries) {
      if (entry.refCount === 0) page.cleanup();
    }
    this.#entries.clear();
  }

  /**
   * 이 페이지의 렌더 캐시를 살려 둘 것을 요청한다. 놓을 때 부를 함수를 돌려준다.
   *
   * 돌려받은 함수는 **반드시 `renderTask.cancel()` 뒤에** 부를 것 — 이유는 이
   * 파일 맨 위 래치 설명 참조.
   */
  retain(page: PDFPageProxy): () => void {
    // 버려진 레지스트리에는 아무것도 담지 않는다.
    //
    // 이 경로를 타는 호출부는 지금 없다. 다만 그 근거로 "React가 자식 cleanup을
    // 부모보다 먼저 돌린다"를 대면 안 된다 — **그 순회 방향은 경로마다 다르다**
    // (업데이트는 자식 먼저, 언마운트와 StrictMode 더블 인보크는 부모 먼저.
    // dispose()의 주석 참조). 실제 근거는 자식이 다시 잡을 때 이미 **새** 인스턴스를
    // prop으로 받은 뒤라는 것이고, 그것 역시 이 클래스 바깥의 사실이다. 그래서
    // 스스로 지킨다. 담지 않아도 잃을 것은 없다 — dispose는 문서가 사라질 때만
    // 불리고, 그 문서의 페이지는 loadingTask.destroy()가 회수한다.
    if (this.#disposed) return () => undefined;

    // ‼️ 여기서 lastUsed를 찍지 않는다. 그 값은 `refCount === 0`인 항목에서만
    // 읽히는데(축출 후보 고르기), refCount가 0이 되는 경로는 릴리스뿐이고
    // 릴리스가 매번 lastUsed를 덮어쓴다 — 즉 잡을 때 찍은 값은 **읽히기 전에
    // 반드시 덮인다**. 처음엔 여기서도 찍었고, 지워도 어떤 테스트도 빨개지지
    // 않아서 죽은 코드임이 드러났다. 한 성질을 두 곳에서 지키면 어느 쪽이
    // 진짜인지 아무도 알 수 없다(§282.1의 `!visible` 중복 가드와 같은 실수).
    const entry = this.#entries.get(page) ?? { lastUsed: 0, refCount: 0 };
    entry.refCount++;
    this.#entries.set(page, entry);

    let done = false;
    return () => {
      // 같은 릴리스를 두 번 불러도 refCount가 음수로 내려가지 않게 한다.
      // (React가 effect cleanup을 두 번 부르지는 않지만, 이 함수는 컴포넌트
      //  바깥으로 나가는 공개 계약이라 호출부를 믿지 않는다.)
      if (done) return;
      done = true;
      entry.refCount--;
      // ‼️ 버려진 레지스트리라면 **여기가 비울 유일한 기회다.** dispose는 이 페이지를
      // 건드리지 않고 지나갔고(위 주석의 래치 이유) 이 릴리스 뒤로는 아무 일도 일어나지
      // 않는다. 예전에는 `loadingTask.destroy()`가 대신 회수해 줬지만 문서가 임대로
      // 표면보다 오래 살게 되면서 그 안전망이 사라졌다. 마지막 홀더가 놓을 때만 비우는
      // 계약은 그대로다 — 세 표면이 같은 프록시를 그린다.
      if (this.#disposed) {
        if (entry.refCount === 0) {
          this.#entries.delete(page);
          page.cleanup();
        }
        return;
      }
      // 놓는 순간을 **최신**으로 찍는다 — LRU의 기준은 "언제 놓였는가"다.
      // (이것만으로는 줌 변경에서 자기 자신이 축출되는 것을 막지 못한다.
      //  그 문제는 아래 #scheduleEviction이 다룬다.)
      entry.lastUsed = ++this.#clock;
      this.#scheduleEviction();
    };
  }

  /**
   * 놓인 페이지가 상한을 넘으면 가장 오래 전에 놓인 것부터 비운다.
   *
   * 스캔이 O(n)인 것은 의도적이다. n은 "붙잡힌 수 + 상한"이고(축출된 항목은 맵에서
   * 사라진다), 릴리스는 반환 전에 항상 상한을 회복시키므로 호출당 전체 순회는
   * 두 번을 넘지 않는다 — 릴리스가 몰려도 선형이지 제곱이 아니다.
   *
   * ‼️ 다만 "n이 30 안팎"은 **이 파일이 강제하는 성질이 아니다.** 세 소비자가 각자
   * IntersectionObserver로 보이는 동안에만 retain하기 때문에 그렇게 되는 것이고
   * (PdfPage 800px · PdfThumbnail 200px · PdfHighlightListItem 200px), 그중 하나라도
   * 가시성 게이트를 없애면 n이 문서 길이만큼 커진다. 그래도 **동작은 옳다** —
   * 붙잡힌 페이지는 어차피 축출 대상이 아니므로 정확성이 아니라 스캔 비용만
   * 나빠진다. 1,000페이지를 전부 붙잡아도 릴리스당 1,000칸 순회라 실질적인
   * 문제는 아니지만, 그때는 이 주석이 틀린 근거를 대고 있게 되므로 여기 적어 둔다.
   */
  #evictReleasedOverflow(): void {
    for (;;) {
      let released = 0;
      let victim: null | PDFPageProxy = null;
      let victimTick = Infinity;
      for (const [page, entry] of this.#entries) {
        if (entry.refCount > 0) continue;
        released++;
        if (entry.lastUsed < victimTick) {
          victimTick = entry.lastUsed;
          victim = page;
        }
      }
      if (released <= this.#maxReleased || victim === null) return;
      // 맵에서 먼저 뺀다 — cleanup()이 false를 돌려주더라도(진행 중인 렌더가
      // 남아 있는 경우) 이 항목이 영구히 축출 후보로 맴돌지 않게 한다.
      this.#entries.delete(victim);
      victim.cleanup();
    }
  }

  /**
   * 축출 판정을 **현재 동기 작업이 끝난 뒤로** 미룬다. 릴리스가 몰려도 한 번만 돈다.
   *
   * ‼️ 이것이 없으면 화면에 떠 있는 페이지가 서로를 축출한다. React는 한 커밋에서
   * 트리 전체의 effect destroy를 **전부** 돌린 뒤에 create를 **전부** 돌린다. 줌이
   * 바뀌면(`renderScale`이 PdfPage 렌더 effect의 deps에 있다) 보이는 페이지가 한꺼번에
   * 재실행되므로, destroy 패스가 끝난 순간 **모든 페이지의 refCount가 동시에 0**이 된다.
   * 그 찰나에 세면 `released`는 "아무도 안 보는 페이지 수"가 아니라 **화면에 떠 있는
   * 페이지 수**이고, 상한을 넘는 만큼이 비워진다. 곧이어 create 패스가 같은 페이지들을
   * 다시 잡고 다시 그리므로 결과는 옳지만, 방금 버린 operator list를 워커에서 다시
   * 받아 온다 — 캐시가 가장 필요한 순간에 정확히 캐시를 버리는 셈이다.
   * 게다가 희생자는 트리 순서상 앞쪽, 즉 **뷰포트 최상단의 페이지**다.
   *
   * (측정: 홀더 14개 + deps 1회 변경 → 마운트된 채로 4개가 축출됐다. 리뷰의 실측이다.)
   *
   * `queueMicrotask`인 이유: React의 passive flush는 **동기**라 마이크로태스크는 반드시
   * destroy+create가 모두 끝난 뒤에 돈다. 그때는 다시 잡힌 페이지의 refCount가 1로
   * 돌아와 있어 애초에 축출 후보가 아니다. 지연 시간을 **추측하는** setTimeout/rAF
   * 해킹이 아니라 언어가 정의한 경계까지 미루는 것이다 — 값을 고를 여지가 없다는 점이
   * 그 차이다. (대안이던 "pdfjs처럼 상한을 2×visible+1로 늘리기"는 붙잡힌 수의
   * 최고치를 영구히 들고 있어야 해서, 한 번 커진 상한이 다시 줄지 않는다.)
   */
  #scheduleEviction(): void {
    if (this.#evictionScheduled) return;
    this.#evictionScheduled = true;
    queueMicrotask(() => {
      this.#evictionScheduled = false;
      if (this.#disposed) return;
      this.#evictReleasedOverflow();
    });
  }
}
