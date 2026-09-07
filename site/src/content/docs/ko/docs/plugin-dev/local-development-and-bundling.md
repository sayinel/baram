---
title: "로컬 개발과 번들링"
sourceHash: "984b7f1e8b6f"
---

## 로컬 개발 루프

**설정 → 플러그인 → 개발자**에서 패키징하거나 설치하지 않고 플러그인을 고쳐 나갈 수 있습니다.

- **개발 플러그인 폴더 불러오기** — 네이티브 폴더 선택기(`@tauri-apps/plugin-dialog`)를 엽니다.
  `baram-plugin.json`과 빌드된 `main` 번들이 있는 디렉터리를 고르면, 그 플러그인이 개발 플러그인으로
  등록되고 즉시 불려옵니다.
- **다시 불러오기** — 디스크에서 매니페스트를 다시 읽고 플러그인 모듈을 다시 불러옵니다(옛 인스턴스를
  내리고 번들을 다시 `import()`하고 `activate`를 다시 돌립니다). 번들을 다시 빌드한 뒤
  (`npm run build`) 앱을 재시작하지 않고 코드 변경을 반영할 때 쓰십시오. 다시 읽은 매니페스트가
  `tiptapExtensions`를 선언하면, 스키마 변경에는 여전히 완전한 재시작이 필요하다는 토스트가
  나옵니다(위 참조) — 다시 불러오기만으로는 스키마를 결코 다시 만들지 않습니다.
- **목록에서 제거** — 플러그인을 내리고 그 개발 폴더를 잊습니다(디스크의 어떤 것도 지우지 않습니다).

개발 모드로 불러온 플러그인은 **체크섬 검증을 건너뜁니다**(로컬 폴더에는 내려받기 URL도 체크섬도
없습니다) — 실수로 빠뜨린 보안 검사가 아니라 의도한 로컬 신뢰 단축입니다.
[신뢰 모델과 보안](/baram/ko/docs/plugin-dev/trust-model-and-errors/#신뢰-모델과-보안)을 보십시오.

## 번들링

esbuild로 ESM 번들 하나를 만드십시오. **무엇을 external로 둘 수 있는지가 티어에 달려 있고**,
틀리면 빌드가 아니라 activate 시점에 실패합니다.

**샌드박스 — 전부 번들하고 `--external`을 아예 쓰지 않습니다:**

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs
```

샌드박스 플러그인은 `blob:` URL에서 import되고, blob 모듈에는 **base URL이 없으므로** 산출물에
남은 맨 `import`는 해석될 수 없습니다. 무언가를 external로 두면 플러그인 불러오기가 해석 오류로
실패합니다. (이 티어는 Tiptap을 아예 쓸 수 없습니다 — 확장은 메인 렐름의 ProseMirror 인스턴스에
주입되는데, 그것이 바로 이 티어가 닿을 수 없는 것입니다.)

**Trusted — `@tiptap/core`와 `@tiptap/pm`을 external로 둡니다.** 호스트가 런타임에 제공하고,
번들에 넣으면 앱 자신의 ProseMirror 인스턴스를 중복시켜 — 아마도 어긋나게 — 만들기 때문입니다.

```bash
npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
  --external:@tiptap/core --external:@tiptap/pm
```

`package.json` 스크립트 — `word-count`(샌드박스)와 `ai-summary`(trusted)가 정확히 여기서
다릅니다. 조심해서 베낄 만한 차이입니다.

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs"
  }
}
```

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs --external:@tiptap/core --external:@tiptap/pm"
  }
}
```
