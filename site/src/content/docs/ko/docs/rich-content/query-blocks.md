---
title: "쿼리 블록"
sourceHash: "3a147bdbbae0"
---

## 쿼리 블록

쿼리 블록은 **노트 안에** 사는 저장된 검색이고, 결과를 그 자리에 렌더합니다. 노트나 태스크를 가리키게 두면 실행할 때마다 살아 있는 목록을 보여 줍니다 — 프로젝트 노트가 자기 미완료 태스크를 품을 수 있고, 콘텐츠 지도(MOC)가 `#reference` 태그가 붙은 모든 노트를 손으로 관리하지 않고도 나열할 수 있습니다.

### 넣는 방법

- 슬래시 메뉴에서 `/query`를 입력하거나 **삽입 > 쿼리 블록**을 씁니다
- 또는 소스 모드에서 펜스 블록을 직접 씁니다:

  ````markdown
  ```query
  source: tasks
  filter: state = "todo" AND due before "+7d"
  sort: due asc
  limit: 10
  ```
  ````

디스크에 저장된 쿼리 블록은 info 문자열이 `query`인 펜스 코드 블록일 뿐이므로, 다른 마크다운 도구는 그것을 잃지 않고 코드 블록으로 보여 줍니다.

### 시각적 빌더

쿼리 블록을 클릭하면 빌더가 열립니다. 저장 단계는 없습니다 — 바꾸는 즉시 블록에 기록되고, 밖을 클릭하면(vim 모드에서는 `Esc`) 쿼리가 다시 실행됩니다.

| 컨트롤        | 정하는 것                                                                |
| ------------- | ------------------------------------------------------------------------ |
| **Source**    | `Notes` 또는 `Tasks` — 무엇을 검색하는가                                 |
| **Filters**   | `필드 · 연산자 · 값` 행 하나 이상, `AND` / `OR`로 이음                   |
| **Sort**      | 필드와 방향(오름차순 / 내림차순)                                         |
| **Display**   | `list`, `table`, `card`                                                  |
| **Limit**     | 결과 최대 개수(기본 `20`)                                                |
| **Run query** | 빌더를 벗어나지 않고 즉시 실행                                           |

헤더에 `{n} results`가 표시됩니다. 결과를 클릭하면 그 문서가 열립니다.

> **Source를 바꾸면 더 이상 맞지 않는 필터는 버려집니다.** `tags`는 노트에서는 뜻이 있지만 태스크에서는 없습니다. 그래서 Notes에서 Tasks로 바꾸면 새 source에 없는 필드를 쓰는 필터·정렬이 사라집니다. 의도한 동작입니다 — 실행기가 절대 맞출 수 없는 필터는 블록을 영구히 비워 두면서 왜 그런지 화면에 아무것도 남기지 않습니다.

### 쿼리가 실행되는 시점

쿼리 블록은 볼트를 **감시하지 않습니다**. 다음 때 실행됩니다.

- 빌더를 닫을 때(밖을 클릭하거나 `Esc`),
- 빌더가 닫힌 상태에서 쿼리 텍스트가 바뀔 때,
- **Run query**를 누를 때,
- 그 결과 안에서 태스크를 체크할 때.

따라서 노트를 열면 위 중 하나가 일어나기 전까지는 **마지막 실행 결과**가 보입니다. 의도한 절충입니다 — `source: notes`는 볼트의 모든 마크다운 파일을 읽으므로, 키를 누를 때마다 또는 커서를 옮길 때마다 다시 실행하면 볼트를 끊임없이 훑게 됩니다.

---

### 쿼리 언어

각 줄은 `key: value`입니다. 모든 줄이 선택이고, 모르는 키는 무시되며, 기본값 그대로인 줄은 파일에 아예 쓰이지 않습니다.

| 키        | 값                                  | 기본값  |
| --------- | ----------------------------------- | ------- |
| `source`  | `files`(노트) 또는 `tasks`          | `files` |
| `filter`  | 필터 식(아래 참조)                  | 없음    |
| `sort`    | `<필드> asc` 또는 `<필드> desc`     | 없음    |
| `display` | `list`, `table`, `card`             | `list`  |
| `limit`   | 숫자                                | `20`    |

**필터 문법.** 각 조각은 `필드 연산자 "값"`이고 `AND` 또는 `OR`로 잇습니다. 값은 인용부호로 감싸며, `empty` 연산자는 값을 받지 않습니다.

```query
filter: tags contains "project" AND state != "done"
```

`AND`가 `OR`보다 강하게 묶입니다. 식은 OR로 나뉜 묶음들로 읽히고, **어느 한 묶음의 모든 조건**이 참이면 결과가 걸립니다.

```query
filter: priority > "0" AND due before "t" OR tags contains "urgent"
```

는 `(priority > 0 AND due before today) OR (tags contains urgent)`로 읽힙니다.

---

### 노트 쿼리 (`source: files`)

| 필드         | 연산자                                 | 설명                                               |
| ------------ | -------------------------------------- | -------------------------------------------------- |
| `tags`       | `contains`, `not_contains`             | 파일 어디든 있는 `#태그`, `#`은 빼고 씁니다        |
| `path`       | `starts`, `contains`, `regex`          | 볼트 기준 상대 경로                                |
| `name`       | `contains`, `starts`, `=`              | 파일 이름                                          |
| `body`       | `contains`                             | 전문 검색, 대소문자 구분 없음                      |
| `status`     | `=`, `!=`, `contains`, `empty`         | YAML 전문의 키                                     |
| `updated_at` | `before`, `after`                      | 값은 날짜이고 빌더가 날짜 선택기로 보여 줍니다     |
| `created_at` | `before`, `after`                      | 위와 같음                                          |

**그 밖의** 필드 이름은 YAML 전문의 키로 읽혀 텍스트로 비교되고 `=`, `!=`, `contains`, `empty`를 지원합니다. 그래서 `filter: author = "Kim"`은 전문의 `author: Kim`에 걸립니다.

정렬 가능한 필드: `updated_at`, `created_at`, `name`, `path`. (`body`로는 정렬할 수 없습니다.)

**예 — 최근에 손댄 프로젝트 노트**

```query
source: files
filter: tags contains "project" AND updated_at after "2026-01-01"
sort: updated_at desc
display: table
limit: 15
```

`display: table`은 결과에서 발견된 YAML 전문 키마다 열을 하나씩 만들고, `name`과 `path`를 더합니다. `display: card`는 카드마다 이름, 경로, 태그 최대 5개를 보여 줍니다.

> `body contains`는 볼트의 모든 파일을 읽어야 합니다. 더 좁은 필터와 함께 쓰거나 `limit`을 작게 두십시오.

---

### 태스크 쿼리 (`source: tasks`)

태스크 쿼리는 **그 노트가 있는 볼트**에서 Baram이 색인한 모든 태스크를 검색합니다 — 태스크 사이드바에 설정된 범위가 아닙니다. 한 노트는 그것을 여는 모든 사람에게 같은 목록을 보여 줍니다. 각자의 사이드바가 무엇으로 걸러져 있든 관계없습니다.

태스크 기능이 켜져 있어야 합니다(**설정 > 일반 > 태스크**). 꺼져 있으면 블록이 빈 목록을 보이는 대신 그렇다고 말합니다.

| 필드         | 연산자                                 | 값                                                  |
| ------------ | -------------------------------------- | --------------------------------------------------- |
| `state`      | `=`, `!=`                              | `todo`, `doing`, `done`, `cancelled`                |
| `due`        | `before`, `after`, `=`, `empty`        | 날짜(아래 참조)                                     |
| `scheduled`  | `before`, `after`, `=`, `empty`        | 날짜                                                |
| `start`      | `before`, `after`, `=`, `empty`        | 날짜                                                |
| `created`    | `before`, `after`, `=`, `empty`        | 날짜                                                |
| `done`       | `before`, `after`, `=`, `empty`        | 날짜                                                |
| `priority`   | `=`, `!=`, `>`, `<`                    | 부호 있는 가중치 — 아래 경고 참조                   |
| `text`       | `contains`                             | 태스크의 텍스트, 대소문자 구분 없음                 |
| `tags`       | `contains`, `not_contains`             | 태스크 줄의 태그, `#`은 빼고 씁니다                 |
| `links`      | `contains`                             | 태스크 줄의 `[[위키링크]]` 대상                     |
| `path`       | `starts`, `contains`, `regex`          | 태스크가 있는 파일                                  |
| `recurrence` | `empty`, `contains`                    | `🔁` 반복 규칙                                       |

정렬 가능한 필드: `due`, `scheduled`, `start`, `created`, `priority`, `text`, `path`. 정렬 필드에 값이 없는 태스크는 방향과 무관하게 항상 **맨 뒤**로 갑니다 — 그래서 `sort: due asc`가 날짜 없는 행 뭉치로 시작하지 않습니다.

**날짜는 에디터와 같은 약식 표기를 받고**, 쿼리가 실행될 때 해석됩니다.

| 이렇게 쓰면          | 뜻                             |
| -------------------- | ------------------------------ |
| `2026-09-30`         | 그 날짜                        |
| `t` / `today`        | 오늘                           |
| `m` / `tomorrow`     | 내일                           |
| `y` / `yesterday`    | 어제                           |
| `+7d` 또는 `+7`      | 오늘부터 7일 뒤                |
| `-3d` 또는 `-3`      | 3일 전                         |
| `9/30`               | 올해 9월 30일, 이미 지났으면 내년 |

그래서 `due before "+7d"`는 "앞으로 한 주 안에 마감"을 뜻하고, 내일도 여전히 그 뜻입니다.

> **`priority`는 P-번호가 아니라 부호 있는 가중치입니다.** 값은 `🔺 = 2`, `⏫ = 1`, 없음 `= 0`, `🔽 = -1`, `⏬ = -2`입니다. "높음 또는 긴급"은 `priority > "3"`이 아니라 `priority > "0"`으로 씁니다. 에디터에서 입력하는 `prio:1`…`prio:5`는 *순위*(P1이 가장 급함)이고 들어올 때 이모지로 변환됩니다 — 쿼리 쪽은 가중치만 봅니다.

**예 — 내 미완료 작업, 급한 것부터**

```query
source: tasks
filter: state != "done" AND state != "cancelled" AND due before "+7d"
sort: priority desc
limit: 25
```

**예 — 이 노트가 책임지는 것 전부**

```query
source: tasks
filter: links contains "Project Apollo" AND state = "todo"
sort: due asc
```

**예 — 조용해진 반복 태스크**

```query
source: tasks
filter: recurrence empty AND tags contains "routine"
```

### 태스크 결과가 표시되는 방식

- **`display: list`**(기본) — 태스크 사이드바와 같은 행입니다. 체크박스가 동작합니다: 태스크를 체크하면 **그 파일에 기록**되고 쿼리가 다시 실행됩니다. 콘텐츠 지도를 굴러가는 프로젝트 보드로 만드는 것이 이것입니다. 행을 클릭하면 그 태스크가 있는 파일의 그 줄로 이동합니다.
- **`display: table`** — 상태, 태스크, 마감, 우선순위, 파일.
- **`display: card`** — 태스크의 텍스트, 파일, 태그 최대 5개.

### 문제 해결

| 이렇게 보이면                                   | 이유                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `No vault open`                                | 쿼리 블록은 볼트를 검색합니다. 먼저 하나를 여십시오                       |
| `Tasks are turned off. Settings → General → Tasks.` | 태스크 기능이 꺼진 상태에서 `source: tasks` 를 썼습니다              |
| 결과가 있을 것 같은데 `No results`             | 위 표에 없는 필드·연산자 조합은 오류를 내지 않고 아무것도 걸지 않습니다. 빌더에서 필드를 다시 고르십시오 — 빌더는 항상 유효한 연산자 집합만 제시합니다 |
| 결과가 낡아 보인다                             | 블록은 위에 적은 시점에만 다시 실행됩니다. **Run query**를 누르십시오     |
