---
title: "파일 트리 장식"
sourceHash: "6ea22eed9654"
---

## `context.ui` 와 파일 트리 (`filetree` 필요)

```typescript
setFileDecorations(updates: FileDecorationUpdate[]): Promise<void>;        // trusted
setFileDecorations(updates: SandboxFileDecorationUpdate[]): Promise<void>; // sandboxed
clearFileDecorations(): Promise<void>;
defineFileIcon(name: string, svg: string): Promise<void>;

// FileDecoration = { badge?: string; color?: FileDecorationPaletteColor | `#${string}`;
//   icon?: { glyph: string } | { svg: string }; tooltip?: string }
// FileDecorationUpdate        = { path: string; decoration: FileDecoration | null }
// SandboxFileDecorationUpdate = { path: string; context?: string; decoration: FileDecoration | null }
```

`filetree` 를 가진 플러그인은 두 티어 모두 파일 트리의 행에 아이콘 · 배지 · 색 · 설명을 달 수 있습니다. 장식은
플러그인이 보내고, Baram이 경로마다 가지고 있다가 그 행이 보일 때 그립니다. `decoration: null` 은 그 경로에서
내 장식을 지웁니다. 다듬고 나서 남는 필드가 없는 장식 — `{}`, 공백뿐인 tooltip — 도 `null` 과 같습니다. 같은
경로에 다시 보내면 그 경로의 내 장식 전체가 바뀝니다 — 필드끼리 합치지 않습니다.

```typescript
export async function activate(ctx: SandboxContext) {
  await ctx.ui.setFileDecorations([
    { path: "notes/todo.md", decoration: { badge: "3", color: "blue", tooltip: "열린 태스크 3개" } },
    { path: "archive", decoration: { icon: { glyph: "📦" } } },
  ]);
}
```

### 행에 보이는 것

- **아이콘** — 기본 파일 · 폴더 아이콘을 바꿉니다. 글자 하나(`{ glyph }`)이거나 직접 정의한 아이콘
  (`{ svg: 이름 }`)입니다. 여러 플러그인이 아이콘을 주면 플러그인 id 순으로 앞선 플러그인의 것이 보입니다.
- **배지** — 하나에 한두 글자이고, 행 오른쪽 끝 git 점 앞에 작은 칩으로 그려집니다. git 점은 늘 맨
  오른쪽입니다. 한 행에는 배지가 둘까지 보이고, 배지를 준 플러그인 가운데 id 순으로 앞선 것들의 배지입니다.
- **마우스를 올렸을 때의 설명** — 그 행에 장식을 단 플러그인마다 `{플러그인 이름}: {tooltip}` 한 줄이
  실립니다(tooltip 이 없으면 배지, 둘 다 없으면 이름만). 자리가 없어 보이지 않는 배지의 플러그인도 실리므로,
  누가 단 표시인지 알 수 있습니다.
- **파일 이름**은 바뀌지 않습니다. 색은 배지와 아이콘에만 닿습니다.

장식은 파일 트리의 행에만 보입니다 — 검색 결과 · 탭 · 빠른 전환에는 보이지 않습니다.

### 색

| 이름 | 그리는 토큰 |
| --- | --- |
| `red` | `--color-status-danger` |
| `orange` | `--color-git-modified` |
| `yellow` | `--color-status-warning` |
| `green` | `--color-status-success` |
| `blue` | `--color-status-info` |
| `purple` | `--color-callout-abstract` |
| `gray` | `--color-text-muted` |
| `accent` | `--color-accent-default` |

팔레트 이름은 테마를 따릅니다. `#rrggbb`(16진 여섯 자리)는 적힌 색 그대로 그려져 테마를 따르지 않으니 팔레트를
권합니다. 그 밖의 값 — `#rgb`, 색 이름, `rgb()`, `var()` — 은 받지 않습니다. 색이 없으면 배지는 흐린 글자색,
아이콘은 행의 글자색입니다.

### 아이콘

`defineFileIcon(name, svg)` 는 `icon: { svg: name }` 에 쓸 아이콘을 정의합니다. 이름은 `A–Z` · `a–z` · `0–9` ·
`_` · `-` 로 된 1–64자이고, SVG 는 UTF-8 로 8 KiB 이하입니다. Baram이 SVG 를 거르며 — 스크립트, 이벤트
핸들러, `<style>` 과 `style` 속성, `<use>`, `<foreignObject>`, SVG 밖에서 자원을 불러올 수 있는 것 등이
빠집니다 — 남은 것은 `<svg>` 요소 하나여야 합니다. 아이콘은 장식의 색으로 칠하는 단색 마스크로 그려지므로
모양은 아무 불투명한 색으로 그리면 됩니다. 플러그인마다 64개까지 정의할 수 있고, 같은 이름을 다시 정의하면 그 아이콘을 쓰는
모든 자리에서 바뀝니다. 정의하지 않은 아이콘 이름을 쓴 장식이 있으면 그 호출 전체가 거부됩니다 — 먼저 부른
`defineFileIcon` 은 아직 차례를 기다리는 중이어도 이 호출보다 먼저 적용됩니다.

### 경로

경로는 UTF-16 4,096 단위 이하입니다. trusted 플러그인은 절대 경로를 씁니다. sandboxed 플러그인은 컨텍스트 루트
기준 상대 경로를 씁니다 — 이름을 `/` 로 이은 것이고, 앞에 `/` 가 없으며, 빈 이름 · `.` · `..` 과 `\` 가
없습니다. `"notes/a.md"` 처럼 쓰고, 루트 자신은 `""` 입니다(파일 하나짜리 컨텍스트는 `""` 만 받습니다).
sandboxed 갱신의 경로에 `\` 가 들어 있으면 호출 전체가 거부됩니다.

sandboxed 갱신의 `context` 는 등록된 컨텍스트를 가리킵니다. 빼면 호출이 도착할 때 앱이 보여 주는 컨텍스트
기준으로 읽습니다. 사용자가 볼트를 바꾸는 동안에는 이것이 `context` 없이 부른 `ctx.files` 의 기준과 다를 수
있으니, 정확히 하려면 `PluginFileEvent` 나 `VaultChange` 의 `context` 를 넘기십시오. 앱이 파일 하나짜리
컨텍스트를 보여 주는 동안 `context` 없는 호출은 `""` 만 받습니다.

Baram은 장식을 행에 맞출 때 두 티어 모두, 플러그인이 준 경로와 각 행의 경로 양쪽에서 `\` 를 모두 `/` 로 바꾸고
끝의 구분자를 떼어 낸 뒤 바이트 단위로 비교합니다. 유니코드 정규화도 대소문자 접기도 하지 않습니다. 그래서
이름에 `\` 가 든 파일은 그 자리를 `/` 로 바꾼 경로의 장식을 받고, 같은 이름이라도 분해형(NFD)과 완성형(NFC)
표기는 서로 다른 경로입니다. Baram이 적은 이름을 그대로 두고 정규화하지 마십시오.

### 상한과 속도

- 한 호출에 갱신 1,000개, 플러그인마다 장식된 경로 20,000개까지입니다.
- 배지는 한두 글자(grapheme 단위)에 UTF-16 16단위 이하, 글자 아이콘은 한 글자에 같은 상한입니다. 다듬은 뒤
  비어 있는 것은 거부됩니다. 다듬기는 양끝의 공백을 잘라 내고, 비어 있다는 것은 아무것도 없거나 기본 무시
  문자(폭 없는 결합자 · 변이 선택자 등)만 남았다는 뜻입니다. tooltip 은 한 줄로 바뀌고, UTF-16 120단위를
  넘으면 `…` 로 끝나게 잘립니다.
- 상한을 넘거나 모양이 틀린 갱신이 하나라도 있으면 그 호출 **전체**가 거부되고, 아무것도 적용되지 않습니다.
- 세 메서드는 부른 순서대로 하나씩 적용됩니다. 장식 호출(`setFileDecorations` · `clearFileDecorations`)은 한
  번에 8개, 그 뒤 250 ms 마다 하나, `defineFileIcon` 은 한 번에 64개, 그 뒤 250 ms 마다 하나를 받습니다. 그보다
  많은 호출은 거부되지 않고 **기다리므로** `Promise.all` 로 한꺼번에 불러도 됩니다.
- 갱신은 묶어서 보내십시오 — `setFileDecorations` 한 번에 갱신 1,000개까지 담기지만, 여덟째를 넘는 장식 호출은
  1초에 넷씩 적용됩니다. 작은 호출 여럿보다 큰 호출 몇 개가 낫습니다.
- 기다리는 시간은 그 호출을 부른 쪽의 시간 제한에 들어갑니다. `activate` 는 5초 안에(sandboxed 플러그인은 Baram
  개발 빌드에서 15초), sandboxed 명령은 30초 안에 끝나야 합니다. 그래서 `activate` 에서 장식 호출을 스무 개 남짓
  넘게, 명령에서 120개 남짓 넘게 기다리면 실패합니다. 호출을 묶거나, `activate` 에서는 기다리지 않고 시작만 하고
  거부는 따로 처리하십시오 — Baram 저장소의 `tree-badges` 예제 플러그인이 그렇게 합니다.
- sandboxed 에서 모양이 틀렸거나, 짝 없는 서로게이트(이모지의 반쪽)를 담았거나, Baram의 IPC 로 보낼 수 없을
  만큼 큰(JSON 으로 약 8 MiB) 호출은 보내기 전에 거부됩니다.

### 장식은 저장되지 않습니다

플러그인이 멈추거나 앱이 닫히면 Baram은 장식과 아이콘을 버립니다. `activate` 에서 그 시간 제한 안에(위 참조)
다시 정의하고 다시 보내십시오. 플러그인을 끄거나 다시 불러오면 그 플러그인의 장식과 아이콘이 지워지고, 아직 차례를 기다리던 호출은
거부됩니다. trusted 플러그인의 옛 `ctx.ui` 는 그 뒤로 세 메서드를 거부합니다. `clearFileDecorations()` 는 내
장식만 지우고 아이콘은 남깁니다.

## `file:rename` 과 `file:delete` (`files` 또는 `files:readonly` 필요)

**Baram이** 파일이나 폴더의 이름을 바꾸거나 옮기거나 지우면 — 파일 트리의 이름 바꾸기 · 이동 · 삭제(휴지통으로),
저널 마이그레이션, 제텔 영구 노트로 승격, 제텔 수집함에서 지우기 — 그 경로의 내 장식이, 폴더라면 그 안의 장식까지
함께 옮겨지거나 지워지고, `files` 나 `files:readonly` 를 가진 플러그인에 알림이 갑니다.

```typescript
ctx.events.on("file:rename", (oldPath, newPath, isDir) => {}); // trusted: 절대 경로
ctx.events.on("file:delete", (path, isDir) => {});

ctx.events.on("file:rename", ({ from, to, isDir }) => {}); // sandboxed: 각각 { context, path }
ctx.events.on("file:delete", ({ context, path, isDir }) => {});
```

- 폴더는 알림 하나이고, 그 안의 것은 함께 옮겨지거나 지워졌습니다.
- 파일 트리에서 PDF의 이름을 바꾸면 짝 노트와 도형 정보 파일이 따라옵니다
  ([하이라이트가 저장되는 곳](/ko/docs/pdf/managing-highlights/#하이라이트가-저장되는-곳)). 그중 옮겨진 파일마다
  PDF의 알림 뒤에 `file:rename` 이 하나씩 더 오고, `isDir` 는 false 입니다.
- `events` 는 필요 없습니다. `files` · `files:readonly` 가 없으면 구독은 받아들이지만 울리지 않습니다. 경로를
  저장하는 플러그인(고정한 노트, 고른 아이콘)은 이 알림을 위해 `files:readonly` 를 함께 선언하십시오.
- sandboxed 에서 중첩 볼트 사이의 이동은 `from` 과 `to` 의 컨텍스트가 다릅니다. 경로가 — 이름 바꾸기라면 두
  경로 중 하나라도 — 등록된 컨텍스트 어디에도 없으면 알림을 보내지 않습니다.
- `file:rename` · `file:delete` 는 같은 변경의 `vault:changed` 보다 **먼저** 옵니다. Baram의 조작이 진행되는
  동안 그 볼트의 `vault:changed` 는 조작이 끝나기를 기다리고, 조작이 끝나지 않으면 계속 기다립니다. symlink 나
  같은 폴더의 다른 표기로 등록한 볼트에서는 이 순서가 보장되지 않습니다. PDF의 이름을 바꿀 때, 그 PDF를 담은
  볼트나 폴더의 `highlights/` · `.baram/` 자리나 그 안에 등록한 볼트나 폴더가 그 PDF를 담지 않으면 그곳에서도
  보장되지 않습니다.
- 조작이 실패했을 때, 새 파일, Baram 자신의 git 조작(브랜치 전환, 풀, 변경 취소), Baram 밖의 변경(다른 앱 ·
  터미널)은 알리지 않습니다. 그런 변경은 `vault:changed` 로만 알 수 있습니다. 그렇게 지워지거나 이름이 바뀐
  경로의 장식은 지워지지 않습니다 — 경로 20,000개에 계속 세어지고, 나중에 그 경로에 파일이 생기면 그 파일에
  보입니다. 단 Baram 자신의 이름 바꾸기나 이동이 그 경로로 파일을 옮겼다면 장식이 먼저 지워집니다.
  `vault:changed` 와 `listDir` 로 정리하십시오.

## 파일 트리 우클릭 메뉴 (`filetree` 필요)

`contributions.fileMenu` 는 파일 트리에서 파일 · 폴더 행이 여는 메뉴에 항목을 다섯 개까지 더합니다. 항목은 메뉴
맨 아래, 앱 항목들과 선으로 나뉜 자리에 플러그인 이름순으로 놓이고, 항목마다 옆에 플러그인 이름이 보입니다. 항목은
`commands` 의 명령 하나를 가리키고, 자기 `title`(1–64자)이 없으면 그 명령의 `title` 을 보여 줍니다. 두 티어 모두
선언할 수 있고, trusted 플러그인은 `commands` 도 필요합니다. Baram 저장소의 `tree-badges` 예제 플러그인이 이
메뉴로 노트를 고정합니다.

```json
{
  "contributions": {
    "commands": [{ "id": "pin", "title": "Pin", "palette": false }],
    "fileMenu": [{ "id": "pin", "command": "pin", "when": "file" }]
  }
}
```

명령의 처리기는 대상 목록을 첫 인자로 받습니다.

```typescript
ctx.commands.register("pin", (targets) => {}); // trusted: FileMenuTarget[], 절대 경로의 { path, isDir }
ctx.commands.register("pin", (targets) => {}); // sandboxed: SandboxFileMenuTarget[], { context, path, isDir }
```

- **대상** — 둘 이상을 고른 선택 안에서 우클릭하면 고른 항목 전부가 선택의 순서대로(Cmd/Ctrl+클릭은 누른 순서, Shift
  범위는 트리 순서) 가고, 그 밖에서는 우클릭한
  행 하나가 갑니다. 접지 않습니다 — 폴더와 그 안의 파일을 함께 고르면 둘 다 갑니다.
- **`when`** — 생략하면 늘 보이고, `"file"` 은 대상이 모두 파일일 때만, `"folder"` 는 모두 폴더일 때만 보입니다.
- 대상이 1,000개를 넘으면 항목이 비활성으로 보입니다. sandboxed 플러그인의 항목은 등록된 컨텍스트 어디에도 없는
  대상이 하나라도 있을 때도 비활성입니다. 비활성 항목에 마우스를 올리면 이유가 보입니다.
- 트리의 빈 곳을 우클릭한 메뉴에는 플러그인 항목이 없습니다.
- **인자를 확인하십시오.** 그 밖의 길(명령 팔레트 · 에디터 우클릭 메뉴 · 슬래시 메뉴 · 단축키 · 상태바)로 부르면 대상이 없고, 다른 플러그인의
  `commands.execute` 는 무엇이든 넘길 수 있습니다. sandboxed 플러그인에는 함수, BigInt, 자기 자신을 가리키는 값을
  보내지 않습니다 — 그런 호출은 거부됩니다.
- 이 메뉴에서 시작한 명령은 [선택창 · 입력창](/ko/docs/plugin-dev/context-prompts/)을 열 수 있습니다.
