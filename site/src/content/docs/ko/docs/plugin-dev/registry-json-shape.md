---
title: "레지스트리 JSON 모양"
sourceHash: "078e0cb5a574"
---


## 레지스트리 JSON 모양

마켓플레이스는 JSON 문서 하나 — `RegistryIndex` — 를 가져와 Rust 쪽(`fetch_registry`)에서 항목마다
역직렬화합니다.

```typescript
interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  downloadUrl: string; // 호스팅된 플러그인 ZIP 의 URL
  checksum: string; // 그 ZIP 의 SHA-256, 16진수
  capabilities: PluginCapability[];
  trust: "sandboxed" | "trusted"; // 필수 — 아래 참조
  engines: { baram: string };
  icon?: string;
  keywords?: string[];
  downloads?: number;
  repository?: string;
  homepage?: string;
}
```

전송되는 모든 키는 camelCase입니다(`baram-plugin.json`과 `src/plugins/types.ts`의 TS 타입과
같습니다). `downloadUrl`은 플러그인을 담은 호스팅된 ZIP을 가리켜야 하고(아래 패키징 단계와 같은
내용), `checksum`은 그 ZIP의 SHA-256을 16진수로 적은 것입니다. 레지스트리 설치는 ZIP을 풀기 전에
`checksum`을 검증합니다 — 해시가 맞지 않는 패키지는 호스트가 설치를 거부합니다.

### 아카이브 한도

내려받기와 풀기를 따로 한정합니다. 작은 아카이브가 거대하게 부풀 수 있기 때문입니다.

| 한도 | 값 |
| --- | --- |
| 압축 방식 | `Stored` 또는 `Deflated` 만 |
| 전송되는 아카이브 크기 | 32 MiB |
| 아카이브 안 파일 수 | 2,000 |
| 한 항목의 경로 조각 수 | 16 (`dist/chunks/x.mjs` 는 3) |
| 파일 하나를 푼 크기 | 64 MiB |
| 전체를 푼 크기 | 256 MiB |
| 푼 크기 ÷ 압축 크기 비율 | 100:1, 또는 1 MiB 중 큰 쪽 |

실제 플러그인이 필요로 하는 것보다 훨씬 높게 잡혀 있고 — 배포된 참조 플러그인은 수십 KB로 풀리고
`dist/chunks/index.mjs`는 깊이 3입니다 — 적대적인 아카이브가 메모리나 디스크를 소진시키는 것을 막기
위해 있습니다. 한도를 넘어야 할 정당한 이유가 있다면(번들한 사전, 글꼴, WASM 모듈) 이슈를
열어 주십시오. 특히 비율 한도는 보통의 압축 가능한 자산에 넉넉하도록 일부러 느슨하게 두었고,
1 MiB 허용치는 작은 아카이브가 너무 적은 출력으로 계산한 비율로 판정되지 않게 합니다.

풀기는 나중이 아니라 **푸는 도중에** 첫 한도에 닿는 즉시 멈춥니다. 그래서 한도를 넘을 아카이브가
초과분을 쓸 기회조차 없습니다.

모든 바이트 한도는 아카이브가 자기 헤더에 선언한 크기가 아니라 **실제로 읽은 바이트**에 강제됩니다.
그래서 크기를 잘못 적어도 그것을 통과할 수 없습니다. 압축 방식 허용 목록은 별개이고 더 엄격한데,
이유가 있습니다 — LZMA와 PPMd는 한 바이트를 내놓기 **전에** 아카이브를 보고 내부 버퍼 크기를 잡으므로
어떤 읽기 한도로도 그것을 한정할 수 없습니다. 릴리스 파이프라인이 돌리는 `zip -r`은 `Deflated`를
만듭니다.

### 잘못된 항목은 자기만 잃습니다

위에서 `?`가 없는 모든 필드는 **저자에게** 필수이지만, 하나가 없다고 Baram이 문서 전체를 실패시키지는
않습니다. 읽을 수 없는 항목은 버리고 나머지 색인은 서빙하므로, 한 기여자의 오타가 모두의
마켓플레이스를 비울 수 없습니다. `engines`는 더 느슨합니다 — 전송에서 아예 없어도 됩니다. 하한이
없다는 것은 버전 관문에 이미 "의견 없음"을 뜻하고, 그것 때문에 설치 가능한 플러그인을 지우는 것이 더
나쁜 답이기 때문입니다.

그 관용은 **읽는 쪽이 관대한 것**이고 요구가 느슨해진 것이 아닙니다 — 그리고 조용하다는 것이 그
대가입니다. 버려진 항목은 아무도 배포하지 않은 항목과 똑같이 보입니다. 신호는 대신 배포 시점에
있습니다 — `scripts/validate-index.ts`가 앱 자신의 파서로 색인을 읽고, 앱이 조용히 솎아 내거나
내리거나 보호를 멈출 것을 거부합니다. `npm run lint:frontend`에서, `plugin-release.yml`에서,
그리고 `sayinel/baram-plugins` 자체의 모든 풀 리퀘스트에서, 추가되는 항목만이 아니라 색인 전체에
대해 돕니다.

다만 그것은 **문서**를 판정합니다 — 아카이브를 열어 본 적이 없습니다. 이 저장소에는 아카이브가
없기 때문입니다. `scripts/validate-registry-assets.ts`가 나머지 절반입니다 — 레지스트리 체크아웃을
주면, 각 항목의 `downloadUrl`을 GitHub Pages가 할 방식으로 해석하고, 거기 보통 파일이 있어야 한다고
요구하고, 선언된 체크섬과 해시를 맞춰 봅니다. 없는 파일을 가리키거나 낡은 체크섬을 든 항목은
그러지 않으면 깔끔하게 배포된 뒤 모든 사용자에게 404를 내거나 무결성 검사를 실패시킵니다.

레지스트리 변경을 제안하기 전에 둘 다 돌리십시오.

```bash
npx tsx scripts/validate-index.ts path/to/index.json
npx tsx scripts/validate-registry-assets.ts path/to/registry-checkout
```

### `trust`와 `capabilities`는 설치가 검증하는 주장입니다

`trust`는 **필수**입니다. 그것이 없는 항목은 **레거시 — 재검증 필요** 배지와 함께 표시되고 설치 버튼이 비활성화됩니다 —
ZIP 안의 매니페스트가 티어를 선언해야 하므로, 설치를 제안하는 것은 먼저 내려받고 뒤에 실패하는 일밖에
되지 않습니다.

여기의 `trust`와 `capabilities`는 **내려받기 전에** 사용자가 승인하도록 요청받는 것입니다 — 동의
대화상자가 레지스트리 항목으로 만들어지는데, 그 시점에 앱이 아는 것이 그것뿐이기 때문입니다. ZIP을
가져온 뒤에는 그 안의 매니페스트를 승인된 것과 대조하고, 더 많은 것을 요구하면 설치를 되돌립니다.

- 항목은 `"sandboxed"`라고 했는데 매니페스트가 `trust: "trusted"`를 선언한 경우
- 항목이 나열하지 않은 권한을 매니페스트가 요구하는 경우
- 매니페스트의 `id`가 항목의 것과 다른 경우

셋을 모두 통과할 때까지 플러그인 저장소에 아무것도 쓰지 않으므로, 하나를 광고하고 다른 것을 내놓는
레지스트리는 권한을 올리는 대신 설치를 실패시킵니다. 매니페스트가 항목보다 권한을 **적게** 나열하는
것은 괜찮습니다 — 검사가 "정확히 일치"가 아니라 "넘지 않음"이기 때문입니다 — 그리고 `files`가
`files:readonly`를, `editor`가 `editor:readonly`를 덮습니다.

배포하는 매니페스트와 항목을 발맞춰 두십시오. 어긋남은 경고가 아닙니다.
