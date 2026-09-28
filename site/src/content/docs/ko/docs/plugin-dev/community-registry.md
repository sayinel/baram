---
title: "커뮤니티 레지스트리에 배포하기"
sourceHash: "514da27aed0d"
---

누구나 Baram 마켓플레이스에 샌드박스 플러그인을 배포할 수 있습니다. 배포한 플러그인은 Baram 공식
플러그인 옆에 **커뮤니티** 표시와 함께 목록에 오르고, 게시자로 GitHub 계정이 표시됩니다.

소스와 릴리스는 자기 저장소에 그대로 둡니다. 레지스트리는 릴리스마다 자기 사본을 두고 자기 주소에서
내보내며, 배포된 버전의 바이트는 바뀌지 않습니다.

## 커뮤니티 레지스트리가 받는 것

- **샌드박스 플러그인만** — `baram-plugin.json`의 `"trust": "sandboxed"`. 샌드박스 플러그인은
  자기 웹뷰에서 돌고, 권한이 허락하는 것만 할 수 있습니다([신뢰 모델, 보안, 오류](/ko/docs/plugin-dev/trust-model-and-errors/)).
  `tiptapExtensions`를 선언하는 플러그인을 포함한 trusted 플러그인은 아직 제출할 수 없습니다.
- **개인 계정이 소유한 공개 저장소.** 조직이 소유한 저장소는 아직 받지 않습니다.
- **`baram-`으로 시작하지 않는 id.** 그 접두사는 Baram 공식 플러그인 전용입니다. id는 영문 소문자,
  숫자, 하이픈으로 쓰고, 영문 소문자나 숫자로 시작합니다.

Baram은 코드를 검토하지 않습니다. 검사는 ZIP을 데이터로 읽을 뿐 실행하거나 스캔하지 않습니다.
사용자는 설치하기 전에 플러그인이 요청하는 권한을 보고, 그 목록이 플러그인이 할 수 있는 전부입니다.

## 1. 템플릿에서 시작하기

[`examples/plugins/community-template`](https://github.com/sayinel/baram/tree/main/examples/plugins/community-template)을
새 저장소로 복사하고 그 README를 따릅니다. `baram-plugin.json`에서 `id`·`name`·`description`·`author`를
자기 것으로 바꾸고, `"trust": "sandboxed"`는 그대로 두고, 코드가 쓰는 권한만 선언하고,
`engines.baram`에는 플러그인이 돌아가는 가장 오래된 Baram 버전을 적습니다([버전 하한](/ko/docs/plugin-dev/manifest/#버전-하한)).

## 2. GitHub 릴리스 만들기

템플릿에는 `.github/workflows/release.yml`이 들어 있습니다. `baram-plugin.json`의 버전을 이름으로
하는 태그(예: `v1.0.0`)를 밀면, 워크플로가 둘이 맞는지 확인하고, 플러그인을 빌드하고,
`baram-plugin.json`·`dist/`·`README.md`를 매니페스트가 루트에 오게 ZIP으로 묶고, 릴리스를 만든 뒤,
다음 단계에 쓸 서술 파일을 SHA-256까지 넣어 실행 요약에 적습니다.

손으로 하려면 `zip -r hello-counter-1.0.0.zip baram-plugin.json dist README.md`, 그다음
`shasum -a 256 hello-counter-1.0.0.zip`. 아카이브는 일반 `zip -r`로 만드십시오. 검사가 아카이브에서
거부하는 것은 아래 6단계에 있습니다.

**제출한 뒤에는 릴리스 자산을 바꾸지 마십시오.** 배포할 때 자산을 다시 내려받아 SHA-256을 확인하고,
바이트가 바뀌었으면 아무것도 배포하지 않습니다. 대신 새 버전을 릴리스하십시오.

## 3. 풀 리퀘스트 열기

[`sayinel/baram-plugins`](https://github.com/sayinel/baram-plugins)를 포크하고 `community/<id>.json`
파일 **하나만** 더합니다.

```json
{
  "id": "hello-counter",
  "publisher": "octocat",
  "repo": "octocat/baram-hello-counter",
  "release": {
    "tag": "v1.0.0",
    "asset": "hello-counter-1.0.0.zip",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

- `publisher`는 GitHub 로그인, `repo`는 `<로그인>/<저장소>`이고, 둘 다 GitHub이 쓰는 철자 그대로
  씁니다.
- `release.tag`는 태그(`v1.0.0` 또는 `1.0.0`), `release.asset`은 ZIP 파일 이름,
  `release.sha256`은 그 SHA-256(소문자 16진수)입니다.
- 다른 필드는 받지 않습니다. 버전·이름·권한은 ZIP 안의 매니페스트에서 옵니다.

## 4. 검사가 확인하는 것

풀 리퀘스트의 `validate` 검사는 커뮤니티 게이트를 돌립니다. 아래 단계를 차례로 확인하고, 처음
실패한 단계에서 멈춥니다. 로그에는 `✗ community gate step 5: …`처럼 그 단계와 이유가 찍힙니다.

0. 풀 리퀘스트가 정확히 파일 하나, `community/<id>.json`만 바꾸고, 그 파일을 더하거나 고치기만 합니다.
1. 서술 파일이 4 KiB 이하입니다.
2. 서술 파일이 UTF-8 JSON이고, 백슬래시·반복된 키·위에 없는 필드가 없습니다. id가 id 규칙을
   따르고, 예약되지 않았고, 파일 이름과 같습니다. `repo`의 소유자가 `publisher`입니다. 태그,
   자산 이름(영문자, 숫자, `.`, `_`, `-`로 쓰고 `.zip`으로 끝남), SHA-256이 위의 형식을 따릅니다.
3. 저장소가 제출자의 것입니다. `repo`가 GitHub이 쓰는 철자와 같고, 공개이며, 개인 계정 소유이고,
   그 계정이 풀 리퀘스트를 열었습니다. 이름이 아니라 GitHub의 숫자 id로 비교합니다. 업데이트는
   배포된 플러그인에 기록된 계정에서 와야 하고, 기록된 저장소를 가리켜야 합니다. 머지됐지만 아직
   배포되지 않은 id는 그 서술 파일을 처음 더한 풀 리퀘스트의 계정만 바꿀 수 있습니다. 관리자는 그
   서술 파일을 지워 그런 id를 풀 수 있습니다.
4. Baram 공식 `index.json`의 플러그인이나 테마가 그 id를 쓰지 않습니다.
5. 자산이 `https://github.com/<repo>/releases/download/<tag>/<asset>`에서 내려받아지고(리다이렉트는
   GitHub의 릴리스 자산 호스트로만 따라갑니다), 앱의 다운로드 한도 32 MiB 안에 있으며, SHA-256이
   `release.sha256`과 같습니다.
6. ZIP이 앱이 설치하는 것이고, 앱보다 엄격하게 읽힙니다. 규칙 가운데 몇 가지:
   - `baram-plugin.json`이 루트에 있고, `main`이 ZIP 안의 파일을 가리킵니다.
   - 항목은 2,000개 이하, 경로 요소는 16개 이하입니다. 파일 하나는 풀어서 64 MiB 이하이고, 전체는
     256 MiB 이하이면서 ZIP 자체 크기의 100배(그것이 1 MiB보다 작으면 1 MiB) 이하입니다. 저장(stored)
     또는 deflate 항목만 되고, 심볼릭 링크와 암호화는 안 됩니다.
   - 이름의 경로 요소마다 ASCII 영문자, 숫자, `_`, `-`, `.`만 쓰고, `.`으로 시작하거나 끝나지
     않습니다. `con`·`nul` 같은 Windows 장치 이름은 확장자가 붙어도 거부하고, 대소문자만 다른 두
     이름도 거부합니다.
   - `zip -r`이 쓰는 타임스탬프와 Unix id 외의 extra field가 없습니다.
   - end-of-central-directory 레코드가 정확히 하나이고, 파일 끝에 있으며, 아카이브 주석이 없습니다.
     압축된 데이터에 그 레코드의 4바이트 서명이 우연히 들어 있어도 거부합니다. 드문 일이고, 그렇게
     되면 다른 압축 수준으로 다시 묶으십시오.
   - 루트의 `README.md`는 256 KiB 이하입니다. 앱이 보여 주려고 읽는 최대 크기입니다.
7. 매니페스트가 Baram 자체 검증기를 통과하고, 샌드박스이며, 서술 파일의 id를 갖고, 버전을
   `X.Y.Z`로 쓰며 그 버전이 태그와 같고, `engines.baram`을 `>=X.Y.Z`로 씁니다.
8. 이 버전이 배포할 `community.json` 항목이 레지스트리 검증기를 통과합니다. 규칙 가운데 몇 가지:
   이름은 1~100자이고, 이름·설명·작성자에 제어 문자나 양방향 재정렬 문자가 없습니다.
9. 버전이 이미 배포된 버전보다 높습니다.

통과한 풀 리퀘스트의 로그에는 `✓ community gate: <id> <version> → auto-merge`가 찍히거나,
`→ needs-review`와 함께 관리자가 봐야 하는 이유가 찍힙니다.

## 5. 검토, 머지, 배포

- 새 id의 **첫 버전**은 관리자가 한 번 검토합니다. Baram이나 다른 프로젝트를 사칭하는 이름·id가
  없는지, 설명이 권한과 맞는지, LICENSE와 README가 있는 공개 저장소인지를 봅니다.
- **이후 버전은 스스로 머지됩니다.** 배포된 버전에 없던 권한을 요청하거나, `name`·`author`·
  `description`·`icon`·`homepage`·`publisher`·`repo`를 바꾸면 관리자를 기다립니다. `files`는
  `files:readonly`를, `editor`는 `editor:readonly`를 포함합니다. `license`·`keywords`·
  `engines.baram`이나 README만 바꾼 것은 스스로 머지됩니다.
- 머지 뒤 레지스트리의 배포 작업이 다음 실행 때 자산을 다시 내려받아 `release.sha256`과 대조합니다.
  그다음 ZIP을 `plugins/<id>-<version>.zip`에, README를 `readme/<id>-<version>.md`에 복사하고
  `community.json`에 항목을 더합니다([파일 모양](/ko/docs/plugin-dev/registry-json-shape/#communityjson)).
  이 변경은 배포 작업이 스스로 열고 검증하고 머지하는 풀 리퀘스트로 들어갑니다. 레지스트리 저장소의
  `community-publish/…` 브랜치는 그 작업의 것입니다. 항목 예시는
  [영어 페이지](/en/docs/plugin-dev/community-registry/)에 있습니다.

Baram은 `community.json`을 공식 `index.json`과 같은 레지스트리에서 읽고, 제출자의 저장소에서는
내려받지 않습니다.

## 업데이트, 이름 바꾸기, 거둬들이기

- **새 버전:** `version`을 올려 릴리스하고, 서술 파일의 `release` 필드를 바꾸는 풀 리퀘스트를
  엽니다.
- **계정이나 저장소 이름을 바꿨을 때:** 신원은 계정과 저장소의 숫자 id이고, 둘 다 이름을 바꿔도
  그대로입니다. 다음 버전을 낼 때 `publisher`와 `repo`에 새 이름을 쓰십시오. 마켓플레이스가 둘 다
  보여 주므로 그 버전은 관리자를 기다립니다.
- **플러그인을 다른 저장소나 다른 계정으로 옮기려면** 관리자가 필요합니다.
  `sayinel/baram-plugins`에 이슈를 여십시오.
- **플러그인 거둬들이기:** 그곳에 이슈를 여십시오. 거둬들이기는 서명된 폐기 목록으로 하며, 그러면
  Baram이 그 플러그인의 설치를 거부하고, 해로운 플러그인이면 이미 설치된 사본도 불러오지 않습니다.
  서술 파일을 지우는 것은 아무것도 거둬들이지 않습니다. 서술 파일을 지우기만 하는 풀 리퀘스트는
  스스로 머지되지 않고, 관리자는 머지됐지만 배포된 적 없는 id를 풀 때만 그런 풀 리퀘스트를
  머지합니다. 배포된 플러그인의 항목은 남습니다.
