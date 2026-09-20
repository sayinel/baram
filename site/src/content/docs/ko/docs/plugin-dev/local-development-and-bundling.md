---
title: "로컬 개발과 번들링"
sourceHash: "7c460a95fe0d"
---

## 로컬 개발 루프

**설정 → 플러그인 → 개발자**에서 패키징하거나 설치하지 않고 플러그인을 고쳐 나갈 수 있습니다.

- **개발 플러그인 폴더 불러오기** — 네이티브 폴더 선택기(`@tauri-apps/plugin-dialog`)를 엽니다.
  `baram-plugin.json`과 빌드된 `main` 번들이 있는 디렉터리를 고르면, 그 플러그인이 개발 플러그인으로
  등록되고 즉시 불려옵니다.
- **다시 불러오기** — 디스크에서 매니페스트를 다시 읽고 플러그인 모듈을 다시 불러옵니다(옛 인스턴스를
  내리고 번들을 다시 `import()`하고 `activate`를 다시 돌립니다). 번들을 다시 빌드한 뒤
  (`npm run build`) 앱을 재시작하지 않고 코드 변경을 반영할 때 쓰십시오. 바뀐 `tiptapExtensions`
  기여도 같은 방식으로 반영됩니다 — 내리기가 옛 기여의 ProseMirror 플러그인을 에디터에서 제거하고,
  새로 도는 `activate`가 새 기여를 설치합니다(위 참조). 재시작이 필요 없고, 스키마 쪽에서 따로
  기다릴 것도 없습니다.
- **목록에서 제거** — 플러그인을 내리고 그 개발 폴더를 잊습니다(디스크의 어떤 것도 지우지 않습니다).

개발 모드로 불러온 플러그인은 **체크섬 검증을 건너뜁니다**(로컬 폴더에는 내려받기 URL도 체크섬도
없습니다) — 실수로 빠뜨린 보안 검사가 아니라 의도한 로컬 신뢰 단축입니다.
[신뢰 모델과 보안](/ko/docs/plugin-dev/trust-model-and-errors/#신뢰-모델과-보안)을 보십시오.

## 번들링

esbuild로 ESM 번들 하나를 만드십시오. **무엇을 external로 둘 수 있는지가 티어에 달려 있고**,
틀리면 빌드가 아니라 activate 시점에 실패합니다.

**전부 번들하십시오. 어느 티어에서도 external을 남기지 마십시오:**

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
```

`@tiptap/pm/state` 같은 맨 specifier는 import map이 있어야 해석되는데 앱은 그것을 선언하지
않습니다 — 그래서 external로 둔 것은 아무도 만족시킬 수 없는 import로 산출물에 남고, 플러그인은
아예 불러와지지 않습니다. 샌드박스 플러그인은 여기에 더해 `blob:` URL에서 import되는데 blob
모듈에는 **base URL이 없으므로** 상대 경로 import조차 해석되지 않습니다.

**ProseMirror는 어디서 얻나.** 에디터에 기여하는 플러그인은 그것을 import하지 않습니다 —
`ctx.pm`이 앱 자신의 `Decoration`·`DecorationSet`·`Plugin`·`PluginKey`를 담고 있습니다.
편의의 문제가 아닙니다. prosemirror-view의 두 번째 사본은 앱의 것과 상호운용되지 않고, 그
크래시는 다른 무언가가 함께 그리기 전까지 조용합니다.
[`ctx.pm`으로 만드십시오](/ko/docs/plugin-dev/commands-and-tiptap-extensions/#ctxpm으로-만드십시오--직접-import하지-마십시오)
를 보십시오. 샌드박스 티어는 애초에 에디터에 기여할 수 없으므로 이 질문이 생기지 않습니다.

이렇게 빌드한 플러그인에는 `@tiptap` 의존성이 필요하지 않습니다 —
`examples/plugins/bullet-threading`은 ProseMirror가 한 글자도 없는 번들을 내고, 테스트가
그것을 단언합니다.

`package.json` 스크립트 — 어느 티어든 같습니다.

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs"
  }
}
```
