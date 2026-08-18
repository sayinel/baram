# §69 회수 목록 서명 — 무장(arming) 런북

> **이 문서가 존재하는 이유**: 무장은 상수 한 줄 붙여넣기처럼 보이지만, PR #365의 리뷰 4라운드에서
> 선결 조건과 함께 고쳐야 할 항목이 계속 쌓였다. 순서를 틀리면 **모든 클라이언트가 진짜 회수 목록을
> 거부**하고, 그 상태가 사용자 눈에는 "오프라인"으로 보인다. 실행 시점에 이 문서만 따라가면 된다.
>
> 전제: PR #365 (`feat/revocation-list-signing`)가 머지되어 있어야 한다. 머지 자체가 발행을 트리거한다.

## 왜 순서가 강제되는가

서명된 목록이 **발행되기 전에** 무장하면, 클라이언트는 `.sig`를 요구하고 404를 받고 목록을 거부한다.
거부는 "저장된 목록 유지"이므로 기존 사용자는 낡은 목록에 멈추고, **신규 설치는 회수를 하나도 받지
못한다** — 현재 live인 `baram-ai-summary` 항목 포함. 되돌리려면 릴리스를 한 번 더 내야 한다.

## 절차

### 1. #365 머지 → 발행 확인

머지가 `revocation-publish.yml`을 돌린다. 다음이 전부 통과해야 한다:

- `A changed list must carry a higher counter than the live one`
- `Sync to the registry` (서명 수행 — `revoked.json.sig` 커밋)
- `Verify the live list is served and readable` — ‼️이 스텝은 이제 **이번 실행이 발행한 서명과
  바이트 비교**한다. 통과했다면 live가 우리 바이트라는 뜻이다

확인:

```sh
curl -sI https://sayinel.github.io/baram-plugins/revoked.json.sig   # 404 → 200 이어야 함
curl -s  https://sayinel.github.io/baram-plugins/revoked.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["sequence"])'
```

### 2. 라이브 서명을 **앱 자신의 검증기**로 확인

CI의 검사는 존재·바인딩만 본다(암호학적 검증은 Rust 빌드가 필요해 워크플로에 없음 — backlog 참조).
그래서 여기서 한 번은 사람이 앱의 `verify_revocation_signature`로 확인한다. 공개키 ID는
**`16E6BEB0A78A3BB4`**.

```sh
# revoked.json / revoked.json.sig 를 내려받아 임시 Rust 테스트나 cargo 예제로 검증
# (실패하면 무장하지 말 것 — 클라이언트도 똑같이 실패한다)
```

### 3. 무장 커밋 — 아래 **전부** 한 커밋에

| # | 변경 | 파일 |
|---|---|---|
| 1 | `REVOCATION_PUBLIC_KEY`에 `.pub` 내용 붙여넣기 | `src-tauri/src/plugin/mod.rs` |
| 2 | `MINIMUM_REVOCATION_SEQUENCE`를 **그때 live인 sequence**로 올리기 | `src/plugins/revocation.ts` |
| 3 | floor bump 게이트 추가 (아래) | `.github/workflows/revocation-publish.yml` |
| 4 | disarm 상태 가시성 (아래) | `stores/system/plugin.ts` + 마켓플레이스 |

‼️ 1과 2를 **같은 커밋**에 두는 이유: mark가 세션 범위이므로(PR #365, 사용자 결정) floor는 이제
**유일한 재시작 간 방어**다. 키만 넣고 floor를 0으로 두면 origin을 serve할 수 있는 공격자가 재시작
한 번마다 과거의 서명된 목록을 replay할 수 있다.

기존 가드가 잡아주는 것:
- `the_shipped_key_is_never_another_key_this_repo_already_holds` — 테스트 키·updater 키 붙여넣기
- `an_armed_key_must_actually_be_a_minisign_public_key` — 잘린 키, private 반쪽, 개행 훼손
- `is at or above the floor this build refuses to go below` — floor를 seed보다 **높게** 잡은 경우
- `defaults to the floor this build compiled in` — 지금은 vacuous, floor를 올리는 순간 실효

### 4. 함께 고칠 것 A — floor bump 게이트 (코드 리뷰 HIGH-1 후반)

**문제**: floor가 live counter에 **뒤처지는** 방향은 아무것도 실패시키지 않는다. 기존 테스트는 너무
높게 잡은 경우(클라이언트 브릭)만 잡는다. "릴리스마다 올린다"는 현재 의도일 뿐 속성이 아니다.

**형태**: 발행 워크플로에서 publish된 sequence와 저장소의 `MINIMUM_REVOCATION_SEQUENCE`를 비교해
격차가 N을 넘으면 실패. `verify-tag` 잡과 동형(태그와 package.json 버전 일치 검사).
상수는 `src/plugins/revocation.ts`에서 파싱 — ‼️매치 **개수**를 단정할 것
(`FIRST_PARTY_REVOCATION_PREFIX` 드리프트 가드가 쓰는 패턴).

### 5. 함께 고칠 것 B — disarm 상태 가시성 (보안 리뷰 MEDIUM-4)

**문제**: `setRevocations`가 **unverified 목록에도** `revocationsFetchedAt: Date.now()`를 찍어 UI상
완벽히 신선해 보인다. `verified` 여부나 실효 registry URL을 보여주는 화면이 **어디에도 없고**,
`revocationsAreStale`의 유일한 소비자는 사용자가 직접 열어야 하는 마켓플레이스 패널이다. 무장 이후
"서명 검증 실패"와 "정상"이 사용자에게 같아 보이면 안 된다.

**형태**: `revocationsVerified`를 영속(‼️`partialize`가 아니라 **`merge`** 를 봐야 한다 — PR #365의
CRITICAL 참조: `partialize`는 쓰기 측이고 복원은 `merge`가 한다) + first-party가 아니면 배너 +
armed 이후 unverified에는 타임스탬프 미기록.

잘 되어 있는 부분(깨뜨리지 말 것): rollback 거부 분기는 `revocationsFetchedAt`을 갱신하지 않으므로,
지속적 rollback 공격 하의 클라이언트는 30일 뒤 stale 표시를 받는다.

### 6. 무장 후 검증

- 실제 앱으로 정상 목록 fetch → `verified: true` 로그
- `.sig`를 일부러 손상시켜 서빙 → **거부**되고 저장된 목록이 유지되며, 로그가 `warn`이 아니라
  **`error`**(구조적 실패)로 뜨는지 (PR #365에서 이 분류를 고쳤다)
- 신규 설치 시나리오(저장 상태 없음)에서 회수가 적용되는지

## floor 게이트가 빨간불일 때 (MAX_LAG=1, 2026-08-04 결정)

두 번째 회수를 릴리스 없이 발행하면 `The app's floor must track the list just verified live`가
**실패한다.** 이건 알람이 작동하는 것이고, 목록은 이미 사용자에게 나갔다(스텝이 마지막). 다만
이 워크플로의 빨간불이 예외가 아니라 일상 신호가 되므로, 처음 보는 사람이 **작동하는 알람을 깨진
게이트로 오해하지 않도록** 대응을 미리 적어둔다.

‼️ **상수를 올려서 초록불을 만드는 것은 해결이 아니다.** `MINIMUM_REVOCATION_SEQUENCE`를 main에서
올리면 게이트는 조용해지지만 **사용자의 floor는 그대로다** — 그 상수는 빌드에 컴파일되므로 릴리스가
나가야 효력이 생긴다. 즉 상수만 고치는 것은 "테스트를 고치는 대신 assertion을 고치는" 반사행동의
한 단계 위 버전이고, 유일한 재시작 간 방어가 뒤처진 사실을 감추기만 한다.

대응은 둘 중 하나이고, 둘 다 명시적이어야 한다:

1. **릴리스를 낸다** — 상수를 그때 live인 counter로 올려서 함께 내보낸다. 정상 경로
2. **노출을 의식적으로 수용한다** — 릴리스가 임박하지 않다면, 그 사이 origin을 serve할 수 있는
   공격자가 재시작 뒤에 최대 `LIVE - FLOOR`개의 회수를 지운 목록을 replay할 수 있다는 것을 인지하고
   기록한다. ‼️그 회수 중 `malicious`가 있으면 수용하지 말 것 — 그게 긴급 케이스다

## 무장과 무관하게 남은 backlog

`dev/backlog.md`의 2026-08-04 절 참조 — CI의 암호학적 `.sig` 검증, 무장 시 startup TLS 2회
(`tokio::try_join!`), 발행 게이트가 Pages 대신 레지스트리 저장소와 비교, rehydrate된 `revocations`가
validator 우회, 서명 키의 blast radius(`environment:` 보호 없음), `plugin/mod.rs` 분리.
