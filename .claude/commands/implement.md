# /implement — 설계서 기반 기능 구현 (Superpowers 워크플로우)

설계 문서의 섹션 번호를 입력받아 Brainstorm → Plan(TDD) → Execute 3단계로 구현한다.

## 사용법

```
/implement §5.3 수식 편집
/implement §4.5 커맨드 팔레트
/implement §6.2 Level 2 인라인 편집
```

## 인자

- `$ARGUMENTS`: 설계 문서 섹션 번호와 기능명 (예: "§5.3 수식 편집")

---

## Step 1: Brainstorm

해당 설계 문서 섹션을 읽고 분석한다.

1. `dev/design/` 에서 해당 `§` 번호가 포함된 파일을 찾아 읽는다
2. 관련된 다른 섹션도 파악한다 (특히 Part 3 아키텍처, Part 7 데이터 모델)
3. 다음을 분석하여 `dev/impl-notes/` 에 저장한다:

```markdown
# §{번호} {기능명} — 구현 노트

## Requirements (설계서에서 추출)
- ...

## Dependencies (의존하는 모듈/Extension)
- ...

## Technical Challenges
- ...

## Edge Cases
- ...

## Files to Create/Modify
- ...

## Implementation Order
1. ...
```

**이 단계에서 코드를 작성하지 않는다.** 분석만 한다.

---

## Step 2: Plan (TDD — 테스트 먼저)

Brainstorm 결과를 기반으로 **실패하는 테스트를 먼저 작성한다.**

1. 공개 API(함수 시그니처, 타입)를 먼저 확정한다
2. 타입/인터페이스 파일을 생성한다
3. 테스트 파일을 작성한다:
   - 단위 테스트: 개별 함수/Extension 동작
   - 라운드트립 테스트: Extension인 경우 MD → PM → MD 보존
   - 통합 테스트: IPC가 관련된 경우
4. 테스트를 실행하여 **모두 실패하는 것을 확인한다** (Red)

```bash
# 테스트 커밋
git add -A
git commit -m "test(§{번호}): add tests for {기능명}"
```

---

## Step 3: Execute (구현)

Plan에서 정한 순서대로 구현한다.

1. 타입/인터페이스부터 시작
2. 핵심 로직 구현
3. 각 테스트 케이스를 하나씩 통과시킨다 (Red → Green)
4. 모든 테스트 통과 후 리팩터링 (Green → Refactor)
5. Extension인 경우 `registry.json` 업데이트
6. IPC 관련인 경우 `ipc-registry.json` 업데이트
7. 전체 테스트 스위트 실행

```bash
# 구현 커밋
git add -A
git commit -m "feat(§{번호}): implement {기능명}"
```

---

## 결과 보고

구현 완료 후 다음을 보고한다:
- 생성/수정된 파일 목록
- 테스트 통과율
- 라운드트립 결과 (해당 시)
- 남은 TODO 항목
- `dev/progress.json` 업데이트
