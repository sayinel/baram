# Vim Source mode and code block CM

세 편집 표면 중 둘은 CodeMirror 다 — source mode 전체와, WYSIWYG 안의 코드블록 하나하나.
이쪽은 자체 엔진이 아니라 `@replit/codemirror-vim` 어댑터를 쓴다.

## 왜 여기는 만들지 않았나

source mode 와 코드블록은 **실제로 줄과 칼럼으로 된 평문 버퍼다.** vim 의 모델이 전제하는
바로 그것이라, 검증된 어댑터를 쓰지 않을 이유가 없다. 직접 만들면 기능의 긴 꼬리를 처음부터
다시 만드는 일이고 얻는 것이 없다. 왜 WYSIWYG 만 다른지는 [Overview](Vim-Overview) 에 있다.

그래서 이 페이지의 내용은 vim 자체가 아니라 **어댑터를 이 앱에 붙이는 자리**다 — 로딩, 한글
IME, 블록 경계, 그리고 섬의 수명.

## 모듈 로딩

vim 모듈은 **동적 import** 다. 설정을 켜지 않는 사용자는 내려받지 않는다. 모듈 promise 는
캐시되어 source mode 를 드나들 때마다, 그리고 코드블록마다 **같은 모듈을 공유한다** — 세
표면에 세 벌을 두지 않는 방법이 이것이다.

확장은 `Prec.highest(vim())` 으로 세운다. vim 의 키 처리는 자기 ViewPlugin 핸들러에서
일어나므로 **어떤 keymap 도 그 위에 앉을 수 없다.** 이 사실이 아래 경계 처리의 모양을 정한다.

## 한글 IME — 이 표면의 가장 비싼 부분

### 측정된 메커니즘

실기기(Tauri / WKWebView)에서 잰 결과가 설계를 정했다. 이 WebKit 은 한글 2벌식에 대해
**composition 이벤트를 하나도 내지 않고**, 취소 가능한 `beforeinput`(`insertText` ·
`insertReplacementText`)으로 텍스트를 넣는데 **그것이 keydown 보다 먼저다.**

따라서 **keydown 단계의 방어는 원리적으로 동작할 수 없다.** 자모는 keydown 이 오기 전에 이미
들어가 있다. 그래서 방어가 `beforeinput` 취소인 것이고, 그러면서도 keydown 은 정상 경로로
vim 에 도달한다(어댑터의 non-ASCII 코드 폴백이 `ㅓ`/`KeyJ` 를 `j` 로 읽는다).

### 어디에만 거나

**normal 과 visual 에만** 건다. insert 와 replace(`R`)는 진짜 텍스트 입력이 필요하다.
소문자 `r` 은 모드를 바꾸지 않고 normal 에 머무르므로, 삽입은 취소되고 뒤따르는 keydown 이
vim 의 리터럴 치환을 구동한다 — 그게 맞는 동작이다.

### replace 모드의 두 글자 문제

실기기에서 드러난 것: 어댑터의 덮어쓰기 분기는 `key.length` 가 1이면 keydown 에서 `e.key` 를
직접 삽입하는데, macOS WKWebView 는 한글 keydown 에 **진짜 자모**를 실어 보낸다(`key="ㅇ"`).
그래서 vim 이 한 번 넣고, 취소할 수 없는 composition 이 또 한 번 확정한다 — 한 번 누를 때마다
두 글자.

처치의 모양이 중요하다. **keydown 을 막으면 안 된다** — CodeMirror 의 InputState 기록이
굶어서 composition 대기 상태가 풀리지 않고, 그러면 Safari 가 사용자의 다음 `Esc` 를 삼킨다.
키 기반 판정도 안 된다 — 직접 입력 레이아웃(`é`·`ñ`·`κ`)의 덮어쓰기가 깨진다.

그래서 **덮어쓰기 메서드 자체를 에디터마다 감싸고**, IME 가 그 텍스트를 소유할 때만 건너뛴다.
증거는 둘이다:

- **CodeMirror 자신의 composition 상태**를 읽는다. 로컬 `compositionend` 리스너가 아니다 —
  Safari 는 dead-key 조합에서 `compositionend` 를 아예 안 낼 때가 있고 CM 은 DOM 이벤트 없이
  내부 타이머로 회복한다. 로컬 플래그였다면 참으로 굳어 replace 입력이 영구히 죽는다.
- 방금 본 `insertText`/`insertCompositionText` `beforeinput`. 양쪽을 NFC 정규화해 맞춰 보고,
  **맞으면 소비한다** — IME 삽입 하나가 수동 덮어쓰기를 최대 하나만 억제하도록.

직접 레이아웃 문자는 두 증거 중 아무것도 못 만들므로 온전한 덮어쓰기 의미론을 유지한다.
메서드를 감싼 덕에 어댑터의 keypress 옆문도 같이 닫힌다.

### 알려진 범위 한계

**표준 순서** 스트림(keydown 이 `compositionstart` 보다 먼저 — 최신 WebKit 의 교정된 순서,
printable key 를 보고하는 Chromium IME)에서는 **첫 조합 문자에 IME 증거가 없어** 다시
두 번 들어간다. 이 구현은 측정된 WKWebView 표면을 겨냥한 것이다.

첫 덮어쓰기를 미뤄 분류하는 방식은 **의도적으로 기각했다** — 지연이 빠른 입력의 순서를
뒤집는다. 다른 표면을 지원하게 되면 여기부터 다시 재야 한다.

## 블록 경계 넘기

vim 의 키 처리가 CodeMirror 의 contentDOM 리스너에서 돌고 그 위에 keymap 을 얹을 수 없으므로,
경계 넘기는 **CM 루트에서 capture 단계로** 듣는다. 조상이어야 하는 이유가 있다 — 같은 타깃에서는
capture 리스너조차 등록 순서로 돌고, CodeMirror 가 먼저 등록했다.

`:` 와 `/` 패널은 contentDOM 밖에 마운트되므로 `composedPath` 로 걸러 낸다. 그래서 `:quit` 에
타이핑한 `u` 가 ProseMirror 의 undo 로 새지 않는다.

소비는 `preventDefault` + `stopPropagation` 이고 **`stopImmediatePropagation` 은 아니다** —
CodeMirror 의 같은 타깃 기록 리스너가 계속 돌아야 한다.

## 섬의 수명이 둘이다

코드블록의 vim 결합부는 NodeView 에서 분리된 collaborator 이고, **두 수명이 다르다는 것이
그 모듈의 계약**이다.

| 수명                                               | 무엇이 산다                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **NodeView** (생성 → 파괴)                         | 레지스트리 구독(vim on/off 브로드캐스트, 명시적 entry 채널), 컨테이너 mousedown 진입, 그리고 **설정 재생성을 살아남아야 하는 복원 메모** |
| **CM 인스턴스** (attach → detach, 재생성마다 반복) | vim controller, 섬 상태 리스너(focusin · focusout · keydown), 그리고 바로 그 인스턴스를 캡처한 클로저들                                  |

`detachCM` 은 복원 메모를 **보존한다** — 재생성 뒤의 복원이 그 메모로 산다. 레지스트리를
해제하는 것은 `destroy` 뿐이다.

의존 방향은 한쪽이다: NodeView → 결합부 → (controller · 상태 · 키 · 레지스트리). 결합부는
NodeView 클래스도 vim plugin 도 import 하지 않는다.

진입이 "됐다 안 됐다" 했던 비결정성과 그 핸드오프 채널은
[Input islands and block entry](Vim-Input-islands-and-block-entry) 에 있다.
