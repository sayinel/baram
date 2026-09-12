# Vim WebKit selection churn

vim 작업 전체에서 가장 큰 수사였고, 이 wiki 가 존재하는 이유다. 증상이 엉뚱한 곳을 가리켰기
때문에 **아닌 것으로 판명된 시도들이 정답보다 길다** — 아래 반증 절이 이 페이지의 본문이다.
같은 계열의 증상을 다시 만나면 거기부터 읽을 것.

## 증상

normal 모드에서 `k` 로 수식 블록 위에 올라간다.

- **착지는 매번 성공한다.** vim 이 만든 NodeSelection 이 수식 블록을 정확히 가리킨다.
- 그런데 **다음 키를 누르기 전에 selection 이 원래 자리로 돌아가 있다.** 그 사이 아무 입력도
  없었다.

"때때로 실패한다" 가 아니라 "성공한 직후 되돌려진다" 라는 점이 중요하다. 착지 코드를 의심하는
동안에는 아무것도 찾지 못한다 — 착지는 옳았다.

## 원인

기기에서 dispatch 를 래핑하고 스택을 캡처해 확정한 사슬:

```
vim dispatch: NodeSelection@수식        ← 성공
DOMObserver.flush
  newSel = !suppressingSelectionUpdates && !currentSelection.eq(sel) && …
  → readDOMChange → 낡은 DOM selection 으로 되돌림
```

vim 의 modal 상태는 non-editable 이다 — normal/visual 에서 editing host 자체를 없애 IME 를
막는 정공법의 대가다. 그래서 `selectionToDOM` 이 editable 게이트에 걸려 **PM 이 새 selection 을
DOM 에 쓰지 못한다.** 상태와 DOM 이 어긋난 채 남고, `DOMObserver.flush` 는 그 불일치를
"브라우저가 커서를 옮겼다" 로 읽어 DOM 쪽을 정답으로 채택한다.

불일치를 실제로 만드는 쪽은 WebKit 이다. non-editable 블록 사이의 노드 선택을 유지하지 못하고
(PM 이 `brokenSelectBetweenUneditable` 로 알고 있는 그 동작), PM 의 임시-editable 우회도 루트
전체가 non-editable 이면 듣지 않아 **늦은 `selectionchange` 가 뒤늦게 도착한다.**

이 리포의 버그가 아니다 — upstream ProseMirror #820 과 같은 계열이다. 그래서 해법도 PM 코어가
자기 churn 에 쓰는 도구를 그대로 쓴다.

## 반증된 시도들

재발 방지의 핵심은 이 절이다. 세 시도 모두 그럴듯했고, 앞의 둘은 **계측으로 확인하기 전까지
고쳐진 것처럼 보였다.**

### atom NodeView 에 `ignoreMutation` 을 준다

DOM 변경이 flush 를 부르니, atom NodeView 가 그 변경을 무시하게 하면 사슬이 끊긴다는 가설.

**죽은 코드였다.** atom 은 contentDOM 이 없고, Tiptap 의 `ignoreMutation` 은 그 경우 첫 줄에서
이미 true 를 반환한다 — 우리가 넣은 옵션에는 **도달 자체를 하지 않는다.** 근거로 읽은 코드
지점마저 atom NodeView 경로가 아니라 MarkView 경로였다. 실측으로 반증됐다.

교훈 둘. 훅에 코드를 넣었다는 것이 그 코드가 실행된다는 뜻은 아니다. 그리고 **원인을 확정하기
전에 고치지 말 것** — 이 시도가 정확히 그 순서를 어긴 결과다.

### `setCurSelection()` 으로 PM 의 기준을 다시 잡는다

flush 가 비교하는 기준(`currentSelection`)이 낡았으니, dispatch 직후 그것을 새 selection 으로
갱신하면 불일치가 사라진다는 가설.

**기기에서 반증됐다.** 한 번 갱신한 기준은 **그 뒤에 오는 이벤트를 이기지 못한다.** WebKit 의
늦은 `selectionchange` 가 도착할 때 DOM 은 여전히 낡았고, flush 는 다시 같은 결론에 이른다.
이 버그의 성질은 "기준이 틀렸다" 가 아니라 **억제할 구간이 필요하다** 였다.

### `suppressSelectionUpdates()` 로 짧은 창을 열어 억제한다

**이것이 정답이다.** dispatch 직후 짧은 창 동안, 도착하는 모든 `selectionchange` 에 대해 상태를
DOM 에 재주장한다. 한 시점의 기준이 아니라 **구간을 억제한다는 점이** 앞 시도와 다르다. PM
코어 자신이 같은 계열의 churn 에 쓰는 도구이므로, 새로 발명한 우회가 아니다.

## 현재 방어 체계

정답을 알아도 남는 문제가 있다: **selection 을 쓰는 경로가 하나가 아니다.** 억제되지 않은
경로가 하나라도 있으면 그 경로에서만 churn 이 되살아난다. 방어는 경로 열거의 문제다.

1. **`dispatchCursor` 단일 관문.** vim 의 selection 쓰기가 **전부 이 헬퍼를 통과한다.**
   dispatch 직후 억제를 걸고, normal 모드면 잔여 DOM range 까지 `removeAllRanges` 로 지운다.
   후자는 유령 하이라이트 수정이다 — WebKit 은 노드 범위를 루트 앵커 블록의 범위로
   재정규화하는데 `.ProseMirror-hideselection *::selection` 은 텍스트 선택만 숨기므로 블록
   하나가 파랗게 남는다. visual 모드는 예외다: 그 범위가 곧 사용자가 보아야 하는 네이티브
   선택이다.
2. **클릭 핸들러** (#408). 클릭으로 생기는 NodeSelection 은 PM 의 pointer dispatch 라
   `dispatchCursor` 를 타지 않는다 — 유일하게 보호되지 않은 selection 쓰기였다. microtask 에서
   억제를 걸되 **클릭 target 이 이미 선택된 atom 내부일 때만** 건다. 파킹된 선택 위에서 다른
   텍스트를 클릭하는 제스처를 먹지 않도록 리뷰에서 범위를 좁혔다.
3. **검색 착지.** `/` 검색이 결과로 점프하는 것도 selection 쓰기이므로 같은 억제를 수행한다.
4. **소스 모드 복귀 커서 복원** (양 브랜치). 억제를 **focus 보다 먼저 무장한다** — focus 경로가
   DOM selection 을 재주장하므로 그 여파가 억제 창 안에 들어와야 한다. 순서가 뒤바뀌면 억제는
   아무 일도 하지 않는다.

**새 selection 쓰기를 추가할 때 물을 것**: 이 경로가 `dispatchCursor` 를 통과하는가? 통과하지
않는다면 왜 통과하지 않아도 되는가? 위 2번은 그 질문을 빼먹어서 생긴 항목이다.

## jsdom 은 이것을 재현하지 못한다 — 그래서 호출을 핀한다

jsdom 에는 WebKit 의 DOM-selection 동기화가 없다. churn 은 브라우저가 selection 을 되돌리는
데서 오므로, jsdom 에서는 되돌림이 아예 일어나지 않는다 — 억제를 떼어내도 selection 은 그대로
유지된다. 즉 **jsdom 의 초록불은 이 버그에 대해 아무것도 증명하지 않는다.**

그래서 이 영역의 회귀 핀은 **결과가 아니라 호출을 고정한다.**

- 억제 헬퍼를 스파이로 감싸 **호출됐는지, 그리고 focus 보다 먼저 호출됐는지를 단언한다.**
- 핀 주석에 결과를 단언하지 않는 이유를 남긴다. 이유가 없으면 다음 사람이 "약한 테스트" 로 보고
  결과 단언으로 바꾸다가 거짓 초록불을 만든다.
- 핀이 실제로 무는지는 **수정을 되돌려** 확인한다. 스파이 핀은 통과하기 쉬워서, 컨트롤 없이는
  아무것도 검사하지 않는 핀과 구별되지 않는다.
- 실제 되돌림 여부는 **기기 검증이 게이트다.** 원인을 찾아낸 계측 루프(dispatch 래핑 + 스택
  캡처)가 수정을 확인하는 도구이기도 하다.

호출 핀은 결과 핀보다 약하다. 약한 줄 알고 쓰는 것과 강한 줄 알고 쓰는 것이 다르다.

파일 위치는 [Code map](Vim-Code-map) 에 있다.
