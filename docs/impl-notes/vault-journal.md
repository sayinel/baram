## 결론: A를 기본으로, vault별 daily는 선택적 애드온

### 핵심 아이디어: Journal과 Work Log를 개념적으로 분리

동훈 님의 패턴은 두 가지 다른 니즈가 섞여 있습니다.

```
니즈 1: 하루 전반의 기록          → "Journal" (삶의 허브)
니즈 2: 프로젝트별 작업 일지       → "Work Log" (프로젝트 CHANGELOG)
```

이걸 같은 이름("Journal")으로 부르니까 C처럼 느껴지는 것이고, 개념을 분리하면 A로 수렴됩니다.

---

## 설계안

### 글로벌 Journal vault (항상 존재, A의 핵심)

```
~/journal/                      ← vault_type: "journal"
  .baram/config.json
  entries/
    2026-03-21.md               ← 하루 전반 기록
    2026-03-20.md
  templates/
    daily.md
```

```markdown
<!-- entries/2026-03-21.md -->
---
date: 2026-03-21
tags: [journal]
---

# 2026-03-21

오늘 Baram의 multi-context 설계를 마무리했다.
→ [[work::baram-multi-context-design]]   ← 가끔 cross-vault 링크

저녁에 책을 읽었다. 인상적인 구절이 있었는데...
```

이것이 메인. 앱 시작 시 자동으로 오늘 파일이 열림.

---

### vault별 Work Log (선택적, 프로젝트에 필요할 때만)

Journal이 아니라 **Work Log**로 이름을 달리 포지셔닝합니다. vault의 `daily/` 폴더이지만 성격이 다릅니다.

```
work-vault/
  daily/                        ← "Work Log" (선택적 활성화)
    2026-03-21.md               ← 오늘 작업 이력, 커밋 메모, 버그 기록
```

```markdown
<!-- work-vault/daily/2026-03-21.md -->
---
date: 2026-03-21
type: work-log
---

# 2026-03-21 Work Log

- [[multi-context-design]] 설계 완료
- [[baram-cross-vault-links]] 문서 업데이트
- TODO: SQLite 스키마 변경 구현
```

**Journal과의 차이:**

|                | 글로벌 Journal         | vault별 Work Log     |
| -------------- | ------------------- | ------------------- |
| 성격             | 하루 전반, 개인적          | 프로젝트 작업 이력          |
| 자동 생성          | 항상 (앱 시작 시)         | vault 설정에서 활성화 시만   |
| 앱 시작 시 동작      | journal vault 파일 오픈 | 별도 동작 없음            |
| cross-vault 링크 | 가끔                  | 거의 없음 (vault 내부 링크) |
| Git 추적         | 개인 repo             | 프로젝트 repo에 포함 가능    |

---

### config로 Work Log 활성화

vault별 Work Log는 기본 비활성. 필요한 vault에서만 켭니다.

```jsonc
// work-vault/.baram/config.json
{
  "vault": {
    "type": "general",
    "alias": "work"
  },
  "workLog": {
    "enabled": true,              // 기본 false
    "folder": "daily/",
    "fileNameFormat": "YYYY-MM-DD",
    "template": "templates/work-log.md"
    // autoCreate는 없음 — 필요할 때 수동 생성
  }
}
```

Work Log는 앱 시작 시 자동 생성하지 않습니다. 커맨드 팔레트에서 "New Work Log for Today" 로 명시적으로 만들 때만 생성. 이 점이 Journal과 결정적으로 다릅니다.

---

## 세 옵션 재평가

동훈 님의 답변 기준으로 다시 보면:

```
A (글로벌 단일):
  ✅ 하루 전반 기록 니즈 완전 충족
  ✅ cross-vault 링크 "가끔"이라 백링크 복잡도 문제 낮음
  ⚠️  프로젝트별 작업 일지 니즈는 Work Log로 별도 충족

B (vault별):
  ❌ "하루 전반 기록" 니즈에 맞지 않음
     vault 경계를 넘는 "오늘 하루"를 담을 곳이 없음

C (둘 다):
  ✅ 두 니즈 모두 충족
  ⚠️  "어디에 써야 하나?" 결정 피로 발생
  ⚠️  같은 날짜 파일이 두 곳에 생기는 혼란
  → 개념을 Journal / Work Log로 명확히 분리하면 해소됨
```

**C처럼 느껴지지만 실은 "A + 선택적 Work Log"** 입니다. 이름을 달리 부름으로써 C의 혼란을 없앤 버전입니다.

---

## 구현 관점

```
M2에서 구현:
  - 글로벌 Journal vault (vault_type: "journal")
  - 앱 시작 시 오늘 Journal 자동 오픈
  - Quick Switcher: "today", "yesterday" 날짜 키워드

M3에서 추가 (선택적):
  - vault별 Work Log (workLog.enabled: true 시)
  - "New Work Log for Today" 커맨드
  - Work Log와 Journal을 사이드바에서 구분 표시
```

Work Log는 M3으로 미뤄도 전혀 문제없습니다. 먼저 글로벌 Journal 하나만 써보고, 프로젝트별 일지가 실제로 필요하다고 느껴질 때 Work Log를 켜는 방식이 점진적으로 도입하기에 좋습니다.
