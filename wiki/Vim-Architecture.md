# Vim Architecture

WYSIWYG 표면의 vim 은 **자체 엔진이다** ([Overview](Vim-Overview) 가 왜인지 설명한다). 그
엔진은 네 층이고, 이 페이지는 각 층이 무엇을 하는지보다 **경계가 왜 거기 그어졌는지** 를 다룬다.
경계가 흔들리면 되돌아올 곳이 여기다.

## 층 흐름

```
KeyboardEvent
   │
   ▼
toKeyToken            물리키 / raw 분리 — 한글 입력 소스 대응
   │  KeyToken
   ▼
core 상태기계          순수. ProseMirror import 0 (purity 핀이 고정)
   │  StepResult { state, command, handled }
   ▼
plugin                PM Plugin — 진입점 · selection 경로 · 상태 reduce
   │  CoreCommand
   ▼
adapters              intent 를 실제 문서 위에서 실행
   │                  모션 · d/c/y · 검색 · grapheme 경계 · 스크롤 · 입력 섬 판정
   ▼
EditorState
```

각 층의 파일은 [Code map](Vim-Code-map) 에 있다.

## 층별 책임

| 층           | 하는 일                                   | 하지 않는 일              |
| ------------ | ----------------------------------------- | ------------------------- |
| `toKeyToken` | KeyboardEvent 를 `KeyToken` 으로 정규화   | 의미 판단                 |
| core         | 모드 · pending · count · 라인 입력의 상태 | 위치 해석, 트랜잭션 생성  |
| plugin       | 키 진입, selection 쓰기, 상태 reduce      | 모션이 어디로 가는지 계산 |
| adapters     | 문서를 걷고 읽고 바꾸기                   | 모드나 pending 을 기억    |

## 경계 1: 키 정규화 — 물리키와 raw

한글 입력 소스가 켜진 채 `j` 를 누르면 `event.key` 는 `ㅓ` 다. 명령 판단이 `event.key` 를 보면
모달 편집은 한국어 사용자에게 통째로 죽는다.

`toKeyToken` 이 vim 의 langmap 아이디어를 **안전하게 판정할 수 있는 한 경우로 좁혀** 적용한다:
생성된 문자가 한글이고 물리키가 평범한 글자키일 때만, 물리키의 글자를 명령으로 읽는다. 그 밖의
모든 경우(어떤 레이아웃의 라틴 글자, 기호, 숫자, 제어키)는 `event.key` 를 그대로 둔다 —
dvorak 류 리매핑과 shift 기호가 다치지 않는다.

원래 문자를 잃지 않는다. 다르면 `raw` 에 함께 실어 보내고, **문자를 리터럴로 받아야 하는
소비자만 `raw` 를 읽는다** — `f`/`F`/`t`/`T` 의 find 타겟(한글 타겟은 한글을 찾아야 한다)과 라인
입력의 문자 누적이 그렇다.

이 분리가 가장 아래 층에 있는 이유: 위의 세 층 전부가 "명령은 물리키, 문자는 raw" 라는 한 규칙을
공유하게 된다. 각 소비자가 알아서 판단하면 한국어 지원이 경로마다 갈리고, 새 명령을 추가할 때마다
같은 실수를 다시 할 자리가 생긴다.

## 경계 2: core 순수성 계약

core 는 ProseMirror 를 모른다. **import 가 0 이고, purity 핀이 그것을 고정한다** — 게이트 없는
경계는 첫 번째 편리한 import 에서 무너지기 때문이다.

구체적으로 core 는 **위치를 해석하지 않고 트랜잭션을 만들지 않는다.** 대가는 core 가 "커서를
아래로" 라고만 말할 수 있다는 것이고, 얻는 것은 **모달 층을 DOM 없이 단위 테스트할 수 있다는
것이다.** 모드 전이·pending 시퀀스·count 접두·라인 입력은 평범한 객체 리터럴로 상태기계를
구동해 검증된다.

이 이득이 특히 큰 이유는 이 엔진이 다루는 DOM 이 정직하지 않기 때문이다 —
[WebKit selection churn](Vim-WebKit-selection-churn) 이 그 기록이다. 모달 의미론의 회귀를
그 위에서 잡으려 하면 무엇이 깨졌는지 구별할 수 없다.

## 경계 3: `CoreCommand` 는 intent 어휘다

core 가 plugin 에게 넘기는 것은 "무엇을 하라" 이고, "어떻게" 는 adapters 가 정한다. 이 어휘가
지키는 규칙:

- **한 키 입력이 만드는 명령은 최대 하나다.** `dd`·`gg`·`df{c}` 처럼 여러 키로 완성되는 시퀀스는
  pending 상태로 누적되고, **완성될 때만 방출된다.** 중간 키는 상태만 바꾼다.
- **`handled: false` 는 "앱에 넘겨라" 다.** normal 모드에서 Cmd+S 나 메뉴 액셀러레이터를 삼키면
  안 된다. 소비 여부를 core 가 말해 주므로, plugin 은 handled 일 때만 이벤트를 소비한다 — 키
  하나에 소비자가 하나라는 원칙이 여기서 나온다.
- **라인 입력 두 개(`exLine`·`searchLine`)는 같은 틀이다.** 열림 → printable 누적(`raw` 우선 —
  한글 자모) → Enter 에서 방출 / Esc 에서 닫힘. 열려 있는 동안 모든 키를 삼킨다(앱으로 새면
  `:w` 를 타이핑하다 메뉴가 열린다). core 에서 상호 배타이므로 상태 피드의 슬롯도 하나다.

plugin 층이 키를 받는 자리도 경계가 만든 결과다. normal/visual 키는 PM 의 `handleKeyDown`
이 아니라 **custom DOM keydown 핸들러로 들어온다.** prosemirror-view 가 custom 핸들러를 자신의
editable 게이트보다 **먼저** 실행하기 때문이고, 그래서 그 경로가 non-editable 뷰에서도 살아
있는 유일한 키 경로다. insert 모드의 Esc 만 `handleKeyDown` 을 쓴다 — PM 의 composition 전처리를 물려받아야
하기 때문이다.

## 경계 4: 행 모델 — "줄" 을 정의하는 층

vim 의 세로 이동과 줄 오퍼레이션은 "줄" 을 전제한다. PM 문서는 트리이고 줄이 없다. 그 전제를
공급하는 것이 행 모델이고, 그래서 모션과 오퍼레이션이 트리를 직접 걷지 않는다.

`collectLines` 가 문서를 "커서 줄" 의 배열로 본다:

| 문서 구조                                | 줄로는 어떻게 보이나                           |
| ---------------------------------------- | ---------------------------------------------- |
| 텍스트블록                               | hardBreak 로 쪼갠 세그먼트들 (`splitSegments`) |
| atom 블록 (수식 · mermaid · 이미지 · hr) | 한 줄                                          |
| 테이블 행                                | 한 줄 (첫 셀의 첫 텍스트블록이 대표)           |
| 코드블록                                 | 한 줄 — 단 아래의 특례                         |

**코드블록 특례가** 이 층에서 가장 미끄러운 곳이다. 코드블록은 `content: "text*"` 라 textblock
으로 읽히는데 내부 개행이 리터럴 문자다. 세로 이동의 칼럼 보존이 그 개행을 모르면 칼럼을 소스
오프셋으로 흘려보내므로, 착지를 항상 콘텐츠 시작으로 스냅한다(`isCodeBlockLanding`). 그 판정은
**노드 이름 매칭이다** — `spec.code` 로 판정하면 frontmatter 도 true 라서 회귀를 만들었다.
블록 **안에서의** 이동은 행 모델이 아니라 CM island 소관이다.

`h`/`l` 이 셀 경계를 넘는 것(`cellHop`)도 이 모델의 귀결이다. 테이블 한 행이 한 줄이므로, 한 줄
안에서 좌우로 움직이면 셀을 건너게 된다.
