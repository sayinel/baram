---
title: "플러그인 매니페스트"
sourceHash: "8e6ef215b031"
---


```json
{
  "id": "my-word-count",
  "name": "Word Count",
  "description": "Displays word and character count in the status bar",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "dist/index.mjs",
  "engines": {
    "baram": ">=0.5.0"
  },
  "trust": "sandboxed",
  "capabilities": ["editor:readonly", "events", "statusbar"],
  "contributions": {
    "statusBar": [{ "id": "count", "text": "— words" }]
  },
  "keywords": ["word", "count", "statistics"],
  "repository": "https://github.com/user/my-word-count",
  "homepage": "https://example.com"
}
```

## 필수 필드

| 필드            | 타입      | 설명                                                                       |
| --------------- | --------- | -------------------------------------------------------------------------- |
| `id`            | string    | 고유 식별자. 소문자·숫자·하이픈만 씁니다.                                  |
| `name`          | string    | 사람이 읽는 표시 이름                                                      |
| `description`   | string    | 짧은 설명                                                                  |
| `version`       | string    | Semver 버전                                                                |
| `author`        | string    | 저자 이름                                                                  |
| `license`       | string    | SPDX 라이선스 식별자                                                       |
| `main`          | string    | 진입점 파일. 플러그인 디렉터리 기준 상대 경로(예: `dist/index.mjs`)        |
| `engines.baram` | string    | 최소 Baram 버전. `>=X.Y.Z` 로 씁니다 — [버전 하한](#버전-하한) 참조         |
| `capabilities`  | string\[] | 필요한 권한 — [권한](/ko/docs/plugin-dev/overview-and-capabilities/#권한) 참조 |

## 선택 필드

| 필드               | 타입      | 설명                                                                                                  |
| ------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| `contributions`    | object    | 앱이 플러그인 대신 그리는 것 — 명령, 상태바 항목, 설정, 우클릭 · 슬래시 항목 — [기여](#기여) 참조 |
| `dependencies`     | string\[] | 이 플러그인이 의존하는 다른 플러그인 ID                                                               |
| `tiptapExtensions` | object\[] | 이 플러그인이 내보내는 Tiptap 확장 — [Tiptap 확장 플러그인](/ko/docs/plugin-dev/commands-and-tiptap-extensions/#tiptap-확장-플러그인) 참조 |
| `repository`       | string    | 소스 코드 URL                                                                                         |
| `homepage`         | string    | 문서 URL                                                                                              |
| `icon`             | string    | 마켓플레이스·개발 목록용 이모지 아이콘                                                                |
| `keywords`         | string\[] | 검색 키워드                                                                                           |

## 기여

`contributions`는 데이터입니다. Baram이 매니페스트에서 읽어 직접 그리고, 항목을 화면에 올리려고
플러그인 코드를 실행하지 않습니다.

| 키          | 각 항목                                 | 최대 |
| ----------- | --------------------------------------- | ---- |
| `commands`  | `{ id, title, palette? }`               | 50   |
| `statusBar` | `{ id, text, tooltip?, command? }`      | 5    |
| `settings`  | 설정 필드 하나                          | 16   |
| `menu`      | `{ id, command, title?, when? }`        | 5    |
| `slash`     | `{ id, command, title?, description? }` | 10   |

`menu`는 에디터의 우클릭 메뉴에, `slash`는 슬래시 메뉴에 항목을 더합니다. 둘 다 `commands`의 명령
하나를 `id`로 가리키고, 자기 `title`(1–64자)이 없으면 그 명령의 `title`을 보여 줍니다. 슬래시 항목의
`description`은 1–120자입니다. `when`은 생략하거나 — 그러면 선택과 무관하게 보입니다 — `"selection"`이고, 그러면
텍스트를 선택한 동안에만 보입니다. 소스 모드에서는 둘 다 나오지 않습니다.

```json
{
  "contributions": {
    "commands": [{ "id": "cite", "title": "Insert citation" }],
    "menu": [{ "id": "cite", "command": "cite", "when": "selection" }],
    "slash": [
      { "id": "cite", "command": "cite", "description": "Insert a citation at the caret" }
    ]
  }
}
```

단축키를 적는 필드는 없습니다. 플러그인이 켜져 있는 동안 그 명령은 **설정 > 단축키**의 **플러그인**
분류에 키 없이 나오고, 사용자가 키를 지정합니다. trusted 플러그인은 `commands` capability 도 필요하고
선언한 명령마다 등록도 합니다 — [명령 팔레트와 Tiptap 확장](/ko/docs/plugin-dev/commands-and-tiptap-extensions/)
참조.

## 버전 하한

`engines.baram`은 플러그인이 도는 가장 오래된 Baram이고, **강제됩니다** — 실행 중인 Baram이
자기 버전으로 그 하한을 채우지 못하면 그 플러그인의 설치·업데이트를 거부하고, 어떤 버전이
필요한지 알려 줍니다. 이것을
틀리는 것은 겉치레 문제가 아닙니다. 필요보다 높은 하한을 선언하면, 돌 수 있었던 사용자에게
플러그인이 설치 불가가 됩니다.

세 숫자를 모두 적어 `>=X.Y.Z` 로 씁니다.

```json
{ "engines": { "baram": ">=0.5.0" } }
```

Baram과 배포 워크플로가 함께 읽는 형태는 그것뿐입니다. 그 밖의 것 — `^0.5.0`, `~0.5`, `0.5.0`,
양쪽이 있는 범위 — 은 앱이 *하한 없음*으로 취급하므로 사용자 보호가 조용히 멈춥니다. 배포
워크플로는 그것을 아예 거부하므로 1군 릴리스가 그렇게 나가지는 않습니다. 프리릴리스
빌드(`0.6.0-beta.1`)는 semver에 따라 `>=0.6.0`을 충족하지 않습니다.
