# /spec-check — 설계서 ↔ 코드 일치 검증

현재 코드가 설계 문서와 일치하는지 검증하고, 차이점을 보고한다.

## 사용법

```
/spec-check              # 전체 검증
/spec-check §5.3         # 특정 섹션만
/spec-check extensions   # Extension registry 검증
/spec-check ipc          # IPC registry 검증
```

## 인자

- `$ARGUMENTS`: (선택) 섹션 번호, "extensions", 또는 "ipc"

---

## 검증 항목

### 1. Extension Registry 검증

`src/extensions/registry.json`과 실제 파일을 비교:
- registry에 등록되었는데 파일이 없는 항목 → ❌ Missing Implementation
- 파일이 있는데 registry에 없는 항목 → ⚠️ Unregistered Extension
- 테스트 파일이 없는 Extension → ❌ Missing Test
- 변환기 파일이 없는 Extension → ❌ Missing Transformer

### 2. IPC Registry 검증

`src-tauri/ipc-registry.json`과 실제 코드를 비교:
- registry에 있는데 Rust 함수가 없는 항목 → ❌ Missing Rust Handler
- registry에 있는데 TS 타입이 없는 항목 → ❌ Missing TS Type
- main.rs invoke_handler에 등록되지 않은 커맨드 → ❌ Not Registered

### 3. 설계 섹션 검증 (§ 지정 시)

해당 섹션의 설계 스펙을 읽고 코드에서 구현 여부를 확인:
- 설계에 명시된 기능/인터페이스가 코드에 존재하는지
- 설계의 타입 정의와 코드의 타입이 일치하는지
- 설계의 IPC 커맨드가 모두 구현되었는지
- 설계의 단축키가 코드에 바인딩되었는지

### 4. Phase/Milestone 진행 검증

`docs/progress.json`과 실제 상태를 비교:
- 구현 완료로 표시된 기능의 테스트가 모두 통과하는지
- 성능 기준이 달성되었는지 (측정 가능한 경우)

---

## 결과 보고

```
=== Baram Spec Check Report ===

Extension Registry:
  ✅ 12 registered, 12 files found
  ✅ 12/12 have tests
  ✅ 12/12 have transformers
  ⚠️  1 unregistered file: src/extensions/nodes/draft-callout.ts

IPC Registry:
  ✅ 8 registered, 8 Rust handlers
  ✅ 8/8 have TS types
  ❌ 1 not in invoke_handler: export_document

§5.3 수식 편집:
  ✅ MathBlock Node Extension
  ✅ InlineMath Mark Extension
  ✅ KaTeX 렌더링 통합
  ❌ LaTeX 자동완성 미구현
  ❌ 수식 에러 표시 미구현

Overall: 3 issues found
```

발견된 이슈를 `docs/progress.json`에 반영한다.
