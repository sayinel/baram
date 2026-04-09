# Part 11. AI 고도화 설계

---

## 11.1 AI 고도화 개요

Part 6에서 정의한 5-Level AI 아키텍처 중 Level 1~3은 Phase 1~2에서 구현 완료되었다. 본 문서는 미구현 기능(Level 4 Agent Mode, Level 5 Knowledge Q\&A)의 상세 설계와 함께, 경쟁 에디터 분석에서 도출한 Baram 고유의 차별화 기능을 정의한다.

### 11.1.1 현황 요약

<!-- colwidths:170,228,137,104 -->

| Level             | 기능                      | 상태          | 참조          |
| ----------------- | ----------------------- | ----------- | ----------- |
| L1 Ghost Text     | 커서 위치 자동 제안             | ✅ 구현 (70%)  | §6.2        |
| L2 Inline Edit    | Cmd+J 선택 → AI 변환 + diff | ✅ 구현 (100%) | §6.2        |
| L3 Chat Panel     | @reference 기반 대화        | ✅ 구현 (100%) | §6.2        |
| L4 Agent Mode     | 멀티파일 자율 편집              | ❌ 미구현       | §6.2, §11.5 |
| L5 Knowledge Q\&A | Vault-wide 벡터 검색 + 인용   | ❌ 미구현       | §6.2, §11.4 |
| Per-task 모델 라우팅   | 작업별 자동 모델 선택            | ⏳ UI만 존재    | §6.3, §11.2 |
| Privacy Mode      | provider 차단 + no-store  | ⏳ 부분 구현     | §6.3, §11.2 |

### 11.1.2 경쟁 분석 요약

2025\~2026년 주요 에디터의 AI 기능 트렌드를 분석하여 Baram의 차별화 방향을 도출했다.

```
[경쟁 에디터 AI 포지셔닝 맵]

              자율성 높음
                  │
    Notion ───────┼──────── Cursor
    (Custom Agent │ 24/7)   (Agent + Background + Automations)
                  │
    Windsurf ─────┼──────── VS Code
    (Flow + Turbo)│         (Agent Mode + NES + Vision)
                  │
    ─────────────-┼───────────────── 통합 깊이
                  │
    Craft ────────┼──────── Obsidian
    (Hybrid On/Off│device)  (Smart Connections + Plugins)
                  │
    iA Writer ────┼──────── Logseq
    (Authorship   │Track)   (Graph + Datalog + AI)
                  │
              자율성 낮음
```

**도출된 차별화 축**:

<!-- colwidths:162,237,238 -->

| 축             | 경쟁자 부재 영역             | Baram 기회               |
| ------------- | --------------------- | ---------------------- |
| 마크다운 전용 Agent | 코드 에디터 Agent만 존재      | 문서 리팩토링 Agent          |
| 하이브리드 검색      | 벡터만(Obsidian) 또는 키워드만 | BM25 + 벡터 + 링크 그래프 3중  |
| 글쓰기 맥락 인지     | Windsurf Flow는 코딩 전용  | Writing Flow Awareness |
| AI 투명성        | iA Writer는 AI 생성 금지   | AI 사용 허용 + 추적          |
| 의미 기반 링크 제안   | 수동 위키링크만 존재           | Semantic Wikilink      |

### 11.1.3 설계 원칙 (Part 6 §6.1 확장)

기존 5원칙("보이지 않는 조수", "마크다운 우선", "diff로 신뢰", "로컬 우선", "점진적 통합")에 3원칙을 추가한다.

**원칙 6: "맥락을 기억한다"**

AI는 현재 편집 세션의 흐름을 이해한다. 사용자가 기술 문서를 작성 중인지, 일기를 쓰는지, Skills 파일을 편집 중인지에 따라 제안의 톤과 내용이 달라진다.

```
[좋은 예]
  기술 문서 작성 중 → "다음 섹션에서는 구현 세부사항을 다룹니다..."
  일기 작성 중     → "오늘 특히 인상적이었던 건..."
  Skills 파일 편집 → "<instructions> 태그 내에서..."

[나쁜 예]
  모든 문서에서 동일한 톤과 형식의 제안
  이전 5분간의 편집 맥락을 무시한 제안
```

**원칙 7: "출처를 밝힌다"**

AI가 Vault의 지식을 참조한 답변에는 반드시 출처 문서와 위치를 표시한다. 사용자가 원본을 확인하고 검증할 수 있어야 한다.

**원칙 8: "AI 기여를 추적한다"**

AI가 생성하거나 수정한 텍스트는 메타데이터 수준에서 추적된다. 사용자는 언제든 "이 문서에서 AI가 기여한 부분"을 확인할 수 있다. 단, 저장된 마크다운 파일에는 어떠한 추적 마커도 삽입하지 않는다 (원칙 2 "마크다운 우선" 유지).

---

## 11.2 Phase 3A: 기존 기능 완성 및 빠른 개선

기존 설계(Part 6)에서 미완성된 기능을 완성하고, 적은 노력으로 큰 효과를 얻는 개선을 수행한다.

### §11.2.1 Per-task 모델 라우팅 구현

**현황**: `ai-store`에 `modelForGhostText`, `modelForInlineEdit`, `providerForChat`, `providerForAgent` 등의 필드가 존재하지만, 실제 `llmComplete()` IPC 호출 시 항상 global `model`/`provider`를 사용한다.

**설계**: `getConfigForTask(task: AITask)` 유틸의 결과를 실제 IPC 호출에 반영한다.

```
[모델 라우팅 흐름]

  AI 작업 발생 (ghost-text | inline-edit | chat | agent)
       │
       ▼
  autoModelEnabled 확인
  ├── false → 전역 provider/model 사용
  └── true  → getConfigForTask(task) 호출
                    │
                    ├── providerForTask[task] 존재? → 해당 provider
                    ├── modelForTask[task] 존재?    → 해당 model
                    └── fallback                   → 전역 provider/model
                    │
                    ▼
              llmComplete(provider, model, ...) IPC 호출
```

**기본 매핑 (Auto Mode 활성 시)**:

<!-- colwidths:107,370,185 -->

| 작업          | 권장 Provider/Model                          | 선택 기준           |
| ----------- | ------------------------------------------ | --------------- |
| Ghost Text  | 가장 빠른 모델 (Haiku 4.5 / Flash / GPT-4o-mini) | 레이턴시 ≤ 300ms 목표 |
| Inline Edit | 중간 모델 (Sonnet 4.5 / GPT-4o)                | 품질/속도 균형        |
| Chat        | 사용자 기본 설정                                  | 선호도             |
| Agent       | 가장 강력한 모델 (Opus 4.5 / o1)                  | 복잡한 추론 + 멀티파일   |

**구현 범위**:

<!-- colwidths:320,426 -->

| 파일                                  | 변경 내용                                                   |
| ----------------------------------- | ------------------------------------------------------- |
| `src/utils/model-selection.ts`      | `getConfigForTask()` → `{ provider, model, apiKey }` 반환 |
| `src/hooks/use-llm-stream.ts`       | `send()` 호출 시 task 파라미터 기반 config 자동 주입                 |
| `src/hooks/use-ghost-text.ts`       | ghost-text task로 config 조회                              |
| `src/hooks/use-inline-ai.ts`        | inline-edit task로 config 조회                             |
| `src/components/ai/AIChatPanel.tsx` | chat task로 config 조회                                    |

### §11.2.2 Ghost Text 프리페치 및 캐싱

**현황**: 500ms 디바운스 후 매번 새 API 호출. Part 6에서 설계한 프리페치와 접두사 캐시가 미구현.

**프리페치 설계**:

```
[프리페치 트리거 조건]

  문단 끝 도달 (마침표/줄바꿈 입력)
       │
       ├── 조건 1: 현재 Ghost Text가 수락된 직후
       ├── 조건 2: 문단이 2문장 이상 (충분한 컨텍스트)
       └── 조건 3: 이전 프리페치 결과가 캐시에 없음
       │
       ▼
  백그라운드 LLM 요청 (UI 블로킹 없음)
       │
       ▼
  결과를 prefetchCache에 저장
  key = hash(현재 문단 텍스트 + 커서 위치 범위)
       │
       ▼
  사용자가 다음 줄에서 멈추면 → 캐시에서 즉시 표시
```

**접두사 캐시 설계**:

```typescript
// 캐시 구조
interface GhostTextCache {
  entries: Map<string, CacheEntry>;
  maxSize: 50;            // 최대 50개 엔트리
  ttl: 5 * 60 * 1000;    // 5분 TTL
}

interface CacheEntry {
  prefix: string;         // 커서 앞 텍스트의 해시 (마지막 200자)
  suggestion: string;     // Ghost Text 결과
  timestamp: number;
  hitCount: number;
}

// 캐시 히트 조건
// 1. 현재 prefix의 해시가 캐시에 존재
// 2. TTL 이내
// 3. 파일이 캐시 생성 이후 변경되지 않음 (dirty flag 체크)
```

**예상 효과**:

<!-- colwidths:247,124,121 -->

| 지표                       | 현재         | 개선 후       |
| ------------------------ | ---------- | ---------- |
| API 호출 횟수 (연속 작성 시)      | 매 정지마다 1회  | 30\~50% 절감 |
| Ghost Text 표시 지연 (캐시 히트) | 300\~800ms | < 50ms     |
| Ghost Text 표시 지연 (캐시 미스) | 300\~800ms | 동일         |

### §11.2.3 Contextual AI Toolbar

**현황**: 텍스트 선택 시 항상 동일한 AI 메뉴 표시 (Improve, Shorten, Expand, Translate, Tone, Explain).

**설계**: 선택 영역의 콘텐츠 타입을 감지하여 맥락에 맞는 AI 액션을 표시한다.

```
[콘텐츠 타입 감지 로직]

  사용자가 텍스트 선택
       │
       ▼
  선택 영역 내 노드 타입 분석
  ├── codeBlock 포함?     → CODE 모드
  ├── mathBlock 포함?     → MATH 모드
  ├── table 포함?         → TABLE 모드
  ├── heading + paragraph → STRUCTURE 모드
  └── paragraph only      → TEXT 모드 (기본)
       │
       ▼
  모드별 AI 메뉴 렌더링
```

**모드별 메뉴 정의**:

<!-- colwidths:123,274,349 -->

| 모드            | 메뉴 항목                                 | 시스템 프롬프트 핵심                                                   |
| ------------- | ------------------------------------- | ------------------------------------------------------------- |
| **TEXT** (기본) | 개선 / 줄이기 / 늘리기 / 번역 / 톤 변경 / 설명       | 기존 Part 6 §6.2 동일                                             |
| **CODE**      | 설명 추가 / 최적화 / 버그 찾기 / 다른 언어로 / 테스트 생성 | "You are a code expert. Analyze the following code block..."  |
| **MATH**      | 풀이 과정 / LaTeX 수정 / 자연어 설명 / 관련 공식     | "You are a mathematics expert. Given the LaTeX expression..." |
| **TABLE**     | 데이터 분석 / 빈 셀 채우기 / 행/열 추가 제안 / CSV 변환 | "Analyze the following markdown table data..."                |
| **STRUCTURE** | 목차 생성 / 구조 개선 / 섹션 분리 / 요약            | "Analyze the document structure and suggest improvements..."  |

**구현 — 플로팅 툴바 확장**:

```
[Contextual AI Toolbar UI]

  TEXT 모드:
  ┌───────────────────────────────────────────┐
  │ B  I  U  S  </>  🔗  ==  ✨AI  ⋯         │
  └───────────────────────────────────────────┘
                              │ 클릭
                   ┌──────────────────────────┐
                   │ ✏️ 개선        📏 줄이기   │
                   │ 📖 늘리기      🌐 번역 ▸   │
                   │ 🎭 톤 변경 ▸   💡 설명     │
                   │ ────────────────────────│
                   │ ⌨️ 커스텀 지시...          │
                   └──────────────────────────┘

  CODE 모드:
  ┌───────────────────────────────────────────┐
  │ B  I  U  S  </>  🔗  ==  ✨AI  ⋯         │
  └───────────────────────────────────────────┘
                              │ 클릭
                   ┌──────────────────────────┐
                   │ 💬 설명 추가    ⚡ 최적화   │
                   │ 🐛 버그 찾기   🔄 변환 ▸   │
                   │ 🧪 테스트 생성             │
                   │ ────────────────────────│
                   │ ⌨️ 커스텀 지시...          │
                   └──────────────────────────┘
```

**구현 범위**:

<!-- colwidths:397,248 -->

| 파일                                           | 변경 내용                |
| -------------------------------------------- | -------------------- |
| `src/utils/content-type-detector.ts`         | 신규 — 선택 영역 콘텐츠 타입 감지 |
| `src/utils/ai-commands.ts`                   | 모드별 시스템 프롬프트 매핑 추가   |
| `src/components/toolbar/FloatingToolbar.tsx` | AI 메뉴를 모드별로 분기       |

### §11.2.4 Privacy Mode 강화

**현황**: cloud provider 차단만 구현. no-store 헤더, per-file frontmatter 적용, 상태 표시 미구현.

**설계**:

```
[Privacy Mode 강화 — 3단계]

  1단계: no-store 헤더 (Rust 백엔드)
  ──────────────────────────────────
  Claude API:  "anthropic-no-store: true" 헤더 추가
  OpenAI API:  모델별 data retention opt-out 파라미터
  Gemini API:  safetySettings에 데이터 보존 비활성화
  Ollama:      (로컬이므로 해당 없음)

  2단계: per-file Privacy (프론트엔드)
  ──────────────────────────────────
  frontmatter에 privacy: true 설정 시:
  ├── Ghost Text 비활성화
  ├── AI 툴바 버튼 숨김 (✨ → 🔒 아이콘으로 대체)
  ├── Chat Panel에서 @current, @selection 참조 차단
  ├── 파일 내용이 LLM에 전송되지 않음
  └── StatusBar에 🔒 아이콘 표시

  3단계: StatusBar Privacy 표시
  ──────────────────────────────────
  전역 Privacy ON  → StatusBar 우측에 🔒 상시 표시
  파일 Privacy ON  → StatusBar 우측에 🔒 (파일) 표시
  Privacy OFF      → 표시 없음
```

**per-file Privacy 감지 흐름**:

```
[per-file Privacy 감지]

  에디터에서 파일 열기 / 탭 전환
       │
       ▼
  ProseMirror Doc에서 frontmatter 노드 검색
       │
       ▼
  frontmatter 텍스트에서 /^privacy:\s*true/m 매칭
  ├── 매칭 → filePrivacy = true
  └── 미매칭 → filePrivacy = false
       │
       ▼
  isLLMAllowed(globalPrivacy, provider, filePrivacy) 판정
  ├── filePrivacy=true → Ollama만 허용 (전역 설정 무관)
  └── filePrivacy=false → 전역 Privacy 설정 따름
```

**구현 범위**:

<!-- colwidths:397,349 -->

| 파일                                           | 변경 내용                                           |
| -------------------------------------------- | ----------------------------------------------- |
| `src-tauri/src/llm/mod.rs`                   | privacy\_mode=true 시 각 provider에 no-store 헤더 추가 |
| `src-tauri/src/llm/claude.rs`                | `anthropic-no-store: true` 헤더                   |
| `src-tauri/src/llm/openai.rs`                | 데이터 보존 opt-out 파라미터                             |
| `src/utils/privacy-check.ts`                 | `checkFilePrivacy(doc)` 함수 추가                   |
| `src/components/toolbar/StatusBar.tsx`       | Privacy 상태 아이콘                                  |
| `src/components/toolbar/FloatingToolbar.tsx` | filePrivacy 시 AI 버튼 비활성화                        |

---

## 11.3 Phase 3B: Writing Flow Awareness — "글쓰기 맥락 인지"

Windsurf의 Flow Awareness가 코딩 맥락(파일 편집, 터미널 명령, 대화 히스토리)을 추적하여 의도를 추론하듯, Baram은 **글쓰기 맥락**을 추적하여 AI 제안의 품질을 높인다. 이는 코딩 에디터에는 없는, 마크다운 에디터 고유의 차별화 기능이다.

### §11.3.1 Writing Mode 자동 감지

사용자의 현재 편집 컨텍스트를 분석하여 Writing Mode를 자동 결정한다.

```
[Writing Mode 감지 파이프라인]

  입력 소스 3가지:
  ┌─────────────────────────────────────────────────┐
  │ 1. 파일 메타데이터                                │
  │    · frontmatter tags/type 필드                   │
  │    · 파일 경로 패턴 (skills/, journal/, docs/)     │
  │    · 파일 확장자 (.skill.md 등)                    │
  ├─────────────────────────────────────────────────┤
  │ 2. 문서 구조 분석                                  │
  │    · 노드 타입 비율 (코드 블록 많으면 → technical)   │
  │    · 헤딩 깊이와 패턴 (구조적 → documentation)      │
  │    · 인라인 마크 비율 (수식 많으면 → academic)       │
  ├─────────────────────────────────────────────────┤
  │ 3. 최근 편집 패턴 (5분 윈도우)                      │
  │    · 입력 속도 (빠른 연속 입력 → freewriting)       │
  │    · 편집 타입 (삽입 위주 / 수정 위주 / 구조 변경)   │
  │    · 블록 타입 전환 빈도                            │
  └─────────────────────────────────────────────────┘
       │
       ▼
  WritingMode 결정 (confidence score 포함)
```

**Writing Mode 정의**:

<!-- colwidths:113,360,273 -->

| Mode        | 감지 조건                                        | AI 톤/스타일 조정              |
| ----------- | -------------------------------------------- | ------------------------ |
| `technical` | 코드 블록 ≥ 3개, 또는 경로 `docs/`                    | 정확하고 간결한 기술 용어, 코드 예시 포함 |
| `academic`  | 수식 블록 ≥ 2개, 또는 frontmatter `type: paper`     | 학술적 톤, 인용 형식, 논리적 전개     |
| `creative`  | 짧은 문단, 빈도 높은 인라인 마크, 일기/에세이 패턴               | 자연스럽고 표현적인 문체, 은유 허용     |
| `skills`    | 경로 `skills/` 또는 `<system>` 태그 존재             | 프롬프트 엔지니어링 관점, XML 태그 구조 |
| `journal`   | 경로 `journal/` 또는 frontmatter `type: journal` | 개인적이고 성찰적인 톤, 감정 표현      |
| `notes`     | 짧은 문단, 많은 리스트, 위키링크                          | 핵심만 간결하게, 구조화된 정보        |
| `general`   | 위 조건 모두 미충족 (기본값)                            | 기존 Ghost Text 프롬프트 사용    |

**Mode별 시스템 프롬프트 템플릿**:

```
[Ghost Text 시스템 프롬프트 — Mode별 분기]

  공통 프리앰블:
    "Continue the user's text naturally. Output ONLY the continuation,
     no explanations or meta-commentary."

  + Mode별 어펜드:
    technical: "Use precise technical terminology. Include code examples
               where relevant. Maintain a professional, concise tone."
    academic:  "Use formal academic tone. Follow logical argumentation.
               Reference existing concepts in the document."
    creative:  "Match the author's personal writing style observed in
               the document. Be expressive but not over-the-top."
    skills:    "Follow XML prompt structure conventions. Suggest
               appropriate tags and variable placeholders."
    journal:   "Write in first person. Be reflective and personal.
               Match the emotional tone of recent entries."
    notes:     "Be concise. Use bullet points and short phrases.
               Suggest relevant [[wikilinks]] when appropriate."
```

### §11.3.2 편집 세션 컨텍스트 추적

최근 편집 이력을 분석하여 "지금 사용자가 무엇을 하고 있는지"를 이해한다.

```
[Session Context Tracker]

  ProseMirror Transaction 수신 (매 편집)
       │
       ▼
  EditEvent 기록 (순환 버퍼, 최대 100개)
  ┌─────────────────────────────────────┐
  │ { timestamp, type, nodeType,        │
  │   position, textLength, action }    │
  │                                     │
  │ type: insert | delete | replace     │
  │       | structure-change            │
  │ action: typing | paste | ai-accept  │
  │         | undo | formatting         │
  └─────────────────────────────────────┘
       │
       ▼
  5분 슬라이딩 윈도우 분석
  ├── 주요 활동 패턴: "목록 작성 중" / "문단 연속 작성" / "구조 편집"
  ├── 편집 속도: words/minute (빠른 흐름 vs 신중한 수정)
  └── 최근 노드 타입 분포: { paragraph: 70%, listItem: 20%, heading: 10% }
       │
       ▼
  Ghost Text 프롬프트에 맥락 주입
  예: "The user is currently writing a bulleted list about API endpoints.
       They have been writing continuously for 3 minutes.
       Suggest the next list item."
```

**세션 컨텍스트가 Ghost Text에 미치는 영향**:

<!-- colwidths:271,278 -->

| 감지된 패턴                  | Ghost Text 조정              |
| ----------------------- | -------------------------- |
| 목록 작성 중 (리스트 아이템 연속 추가) | 다음 리스트 아이템 제안, 기존 패턴 유지    |
| 문단 연속 작성 (빠른 타이핑)       | 현재 문단의 논리적 다음 문장 제안        |
| 구조 편집 중 (헤딩 추가/이동)      | 새 섹션의 첫 문장 또는 소제목 제안       |
| 코드 블록 작성 중              | 코드 완성 (현재 언어 문법 기반)        |
| 수정/검토 모드 (삭제/교체 빈도 높음)  | Ghost Text 빈도 낮추기 (방해 최소화) |

### §11.3.3 세션 메모리

현재 편집 세션에서 사용자가 AI에게 준 피드백을 기억하여 같은 실수를 반복하지 않는다.

```
[세션 메모리 구조]

  interface SessionMemory {
    fileId: string;
    startedAt: number;

    // AI 피드백 기록
    rejections: {              // 사용자가 거절한 AI 제안들
      suggestion: string;
      reason?: string;         // 있으면 기록 (명시적 피드백)
      timestamp: number;
    }[];

    // 학습된 선호
    preferences: {
      avoidPatterns: string[];  // "너무 격식적", "코드 예시 불필요" 등
      preferPatterns: string[]; // "한국어 유지", "짧은 문장" 등
    };

    // 적용 방식
    // Ghost Text 프롬프트에 negative/positive 예시로 주입
    // "DO NOT suggest: [rejection examples]"
    // "User prefers: [preference patterns]"
  }
```

**메모리 수집 흐름**:

```
  AI 제안 생성 → 사용자 반응
  ├── Tab 수락          → 긍정 시그널 (선호 패턴 강화)
  ├── 수락 후 즉시 수정  → 부분 부정 (수정된 부분을 avoidPattern에 추가)
  ├── Esc 거절          → 약한 부정 (빈도 카운트만)
  ├── Inline Edit 거절   → 강한 부정 (거절된 텍스트를 avoidPattern에 추가)
  └── 명시적 피드백      → 직접 preferences에 기록
       (Chat에서 "AI가 너무 길게 써" 등)
```

**세션 메모리는 파일별로 유지되며, 앱 종료 시 삭제된다** (영구 저장하지 않음). 이는 원칙 6("맥락을 기억한다")의 범위를 현재 세션으로 제한하여 프라이버시를 보호한다.

### §11.3.4 구현 아키텍처

```
[Writing Flow Awareness 아키텍처]

  ┌──────────────────────────────────────────────┐
  │                  ProseMirror                  │
  │                                              │
  │  Transaction ──→ WritingFlowPlugin            │
  │                    │                          │
  │                    ├── EditEventTracker        │
  │                    │   (순환 버퍼 100개)        │
  │                    │                          │
  │                    ├── WritingModeDetector     │
  │                    │   (파일 메타 + 구조 + 패턴) │
  │                    │                          │
  │                    └── SessionMemory           │
  │                        (거절/선호 기록)         │
  └───────────────────────┬──────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────┐
  │              WritingFlowStore                 │
  │              (Zustand)                        │
  │                                              │
  │  · currentMode: WritingMode                   │
  │  · sessionContext: EditPattern                 │
  │  · sessionMemory: SessionMemory               │
  │  · modeConfidence: number                     │
  └───────────────────────┬──────────────────────┘
                          │
                          ▼
  ┌──────────────────────────────────────────────┐
  │         Ghost Text / Inline Edit / Chat       │
  │                                              │
  │  프롬프트 구성 시 WritingFlowStore 참조        │
  │  · 시스템 프롬프트에 mode 컨텍스트 주입          │
  │  · 세션 메모리의 avoid/prefer 패턴 주입         │
  │  · 편집 패턴에 따른 제안 빈도/길이 조정          │
  └──────────────────────────────────────────────┘
```

**파일 구조**:

<!-- colwidths:354,392 -->

| 파일                                       | 역할                                        |
| ---------------------------------------- | ----------------------------------------- |
| `src/extensions/plugins/writing-flow.ts` | ProseMirror Plugin — 트랜잭션 모니터링, 이벤트 수집    |
| `src/stores/writing-flow-store.ts`       | Zustand 스토어 — mode, context, memory 상태 관리 |
| `src/utils/writing-mode-detector.ts`     | Writing Mode 감지 로직                        |
| `src/utils/session-context.ts`           | 편집 패턴 분석 (5분 윈도우)                         |
| `src/utils/session-memory.ts`            | 세션 메모리 수집 및 프롬프트 변환                       |

---

## 11.4 Phase 3B: Knowledge Q\&A — 하이브리드 지식 검색

Part 6 §6.2의 Level 5 설계를 구체화한다. Baram의 기존 인프라(tantivy 전문 검색 + 백링크 인덱스 + 파일 워치)를 최대한 활용하여, 단순 벡터 검색을 넘어서는 3중 하이브리드 검색을 구현한다.

### §11.4.1 하이브리드 검색 아키텍처

```
[Baram Knowledge Architecture — 3중 하이브리드 검색]

  Markdown Files ──→ remark-parse ──→ Heading-based Chunks
                                            │
                    ┌───────────────────────┬┴──────────────────────┐
                    │                       │                       │
                    ▼                       ▼                       ▼
          ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
          │  tantivy         │    │  Vector Index     │    │  Link Graph     │
          │  (BM25 전문검색)  │    │  (임베딩 유사도)   │    │  (관계 탐색)     │
          │  [기존 구현]      │    │  [신규 구현]       │    │  [기존 구현]     │
          └────────┬────────┘    └────────┬─────────┘    └────────┬────────┘
                   │                      │                       │
                   ▼                      ▼                       ▼
          ┌──────────────────────────────────────────────────────────────┐
          │                    Hybrid Ranker                             │
          │                                                             │
          │  Score = α·BM25(q, chunk)                                   │
          │        + β·CosineSim(embed(q), embed(chunk))                │
          │        + γ·GraphProximity(chunk.file, query_context)        │
          │                                                             │
          │  α=0.3, β=0.5, γ=0.2 (기본값, 설정 가능)                     │
          └──────────────────────────┬──────────────────────────────────┘
                                     │
                                     ▼
                              Top-K Chunks (K=10)
                                     │
                                     ▼
                          ┌──────────────────────┐
                          │   LLM Answer          │
                          │   + Citation Links    │
                          └──────────────────────┘
```

**각 검색 엔진의 역할**:

<!-- colwidths:123,217,156,250 -->

| 엔진                 | 강점                   | 약점             | Baram 기존 자산                   |
| ------------------ | -------------------- | -------------- | ----------------------------- |
| **tantivy (BM25)** | 정확한 키워드 매칭, 희귀 용어 검색 | 의미적 유사성 무시     | ✅ §5.11 Global Search에서 구현 완료 |
| **Vector (임베딩)**   | 의미적 유사성, 동의어/패러프레이즈  | 키워드 정확도 낮음     | ❌ 신규 구현 필요                    |
| **Link Graph**     | 문서 간 관계, 주제 클러스터     | 링크 없는 문서 탐색 불가 | ✅ §29 백링크 인덱스 구현 완료           |

**경쟁 제품 대비 차별점**:

<!-- colwidths:223,194,329 -->

| 제품                         | 검색 방식              | 한계                              |
| -------------------------- | ------------------ | ------------------------------- |
| Obsidian Smart Connections | 벡터만                | 키워드 정확도 부족, "JWT"같은 용어 매칭 실패 가능 |
| Notion AI                  | 키워드 + 벡터           | 링크 관계 미활용, 데이터베이스 구조에 의존        |
| **Baram**                  | BM25 + 벡터 + 링크 그래프 | 가장 풍부한 검색 신호                    |

### §11.4.2 임베딩 파이프라인

**청크 분할 전략**:

```
[문서 → 청크 분할]

  Markdown 파일
       │
       ▼
  remark-parse → mdast
       │
       ▼
  Heading 기반 분할 (§7.1 MD 규격 활용)
  ├── H1 섹션 = 최상위 청크
  │   ├── H2 섹션 = 하위 청크
  │   │   ├── H3 섹션 = 말단 청크
  │   │   └── ...
  │   └── H2 섹션 = 하위 청크
  └── frontmatter = 별도 메타데이터 청크

  청크 제약:
  · 최소 크기: 50 토큰 (너무 짧으면 상위 헤딩과 병합)
  · 최대 크기: 500 토큰 (초과 시 문단 단위로 분할)
  · 오버랩: 인접 청크와 50 토큰 오버랩 (맥락 유지)
```

**청크 메타데이터**:

```typescript
interface Chunk {
  id: string;                    // hash(filePath + headingPath)
  filePath: string;              // "docs/auth/middleware.md"
  headingPath: string[];         // ["Authentication", "JWT 검증", "토큰 갱신"]
  content: string;               // 청크 텍스트 (마크다운 구문 포함)
  tokenCount: number;
  embedding?: number[];          // 벡터 (임베딩 완료 시)

  // 메타데이터 (검색 랭킹에 활용)
  frontmatter?: Record<string, unknown>;
  outgoingLinks: string[];       // 이 청크가 참조하는 [[wikilink]] 대상
  incomingLinks: string[];       // 이 청크를 참조하는 문서 (백링크 인덱스 활용)
  lastModified: number;
}
```

**임베딩 Provider 설계**:

```
[임베딩 Provider — Rust 백엔드]

  IPC Command: embed_text(texts: string[], provider: string)
       │
       ▼
  Provider 분기
  ├── "ollama"  → POST http://localhost:11434/api/embeddings
  │              body: { model: "nomic-embed-text", prompt: text }
  │              응답: { embedding: number[] }
  │
  ├── "openai"  → POST https://api.openai.com/v1/embeddings
  │              body: { model: "text-embedding-3-small", input: texts }
  │              응답: { data: [{ embedding: number[] }] }
  │
  └── "gemini"  → POST https://generativelanguage.googleapis.com/v1beta/models/
                        text-embedding-004:embedContent
                 body: { content: { parts: [{ text }] } }
                 응답: { embedding: { values: number[] } }
```

**배치 임베딩 최적화**:

<!-- colwidths:85,472 -->

| 전략    | 설계                                                   |
| ----- | ---------------------------------------------------- |
| 배치 크기 | OpenAI: 100개/요청, Ollama: 1개/요청 (직렬), Gemini: 1개/요청   |
| 병렬 처리 | Rust tokio 스레드풀 — Ollama 4 병렬, Cloud 10 병렬           |
| 증분 갱신 | 파일 저장 시 해당 파일의 청크만 재임베딩 (notify 파일 워치 연동)            |
| 저장 형식 | `.baram/embeddings/` 디렉토리에 바이너리 벡터 파일                |
| 차원    | 기본 768차원 (nomic-embed-text / text-embedding-3-small) |

### §11.4.3 하이브리드 랭킹 알고리즘

```
[Hybrid Ranker — 점수 결합]

  입력: 사용자 질문 Q

  1단계: 각 엔진에서 후보 추출
  ├── BM25 검색: tantivy에서 상위 20개 청크 + BM25 점수
  ├── 벡터 검색: 임베딩 유사도 상위 20개 청크 + cosine 점수
  └── 그래프 확장: 현재 파일의 1-hop 이웃 문서의 청크를 후보에 추가

  2단계: 점수 정규화
  ├── BM25 점수: min-max 정규화 → [0, 1]
  ├── cosine 유사도: 이미 [0, 1] 범위
  └── Graph Proximity: 1/(1 + hop_distance) → [0, 1]
       · 현재 파일의 청크: 1.0
       · 직접 링크된 문서: 0.5
       · 2-hop 문서: 0.33
       · 링크 없는 문서: 0.0

  3단계: 가중 합산
  FinalScore = α·BM25_norm + β·cosine_norm + γ·graph_norm
  기본값: α=0.3, β=0.5, γ=0.2

  4단계: 상위 K개 선택 (K=10)
  ├── 중복 제거 (같은 파일의 인접 청크 병합)
  └── 다양성 보장 (같은 파일에서 최대 3개 청크)
```

**가중치 자동 조정**:

<!-- colwidths:258,96,102,97,194 -->

| 질문 유형                   | α (BM25) | β (Vector) | γ (Graph) | 감지 기준              |
| ----------------------- | -------- | ---------- | --------- | ------------------ |
| 키워드 검색 ("JWT 토큰 갱신")    | 0.5      | 0.3        | 0.2       | 짧은 질문, 기술 용어 포함    |
| 의미 검색 ("인증 전략은?")       | 0.2      | 0.6        | 0.2       | 추상적 질문, 개념 용어      |
| 관계 검색 ("이 파일과 관련된 것은?") | 0.1      | 0.3        | 0.6       | @current 참조, 관계 질문 |

### §11.4.4 Citation 시스템

```
[Citation 포함 답변 생성]

  시스템 프롬프트:
  "Answer the user's question based ONLY on the provided context chunks.
   For every claim, cite the source using [N] notation.
   If the context doesn't contain enough information, say so explicitly."

  컨텍스트 주입 형식:
  "--- Source [1]: docs/auth/middleware.md > JWT 검증 ---
   JWT 토큰은 Authorization 헤더에서 추출하며...

   --- Source [2]: docs/auth/token-refresh.md > 갱신 흐름 ---
   토큰 만료 시 refresh_token으로 새 토큰을 발급..."

  LLM 응답:
  "이 프로젝트에서는 JWT 기반 토큰 인증을 사용합니다. [1]
   인증 미들웨어는 auth/middleware.md에 정의되어 있으며,
   토큰 갱신 로직은 [2]에서 확인할 수 있습니다."

  Citation 렌더링:
  ┌────────────────────────────────────────────────────┐
  │ 🤖 이 프로젝트에서는 JWT 기반 토큰 인증을 사용합니다. │
  │    ¹ 인증 미들웨어는 auth/middleware.md에 정의되어    │
  │    있으며, 토큰 갱신 로직은 ²에서 확인할 수 있습니다.  │
  │                                                    │
  │    ───────────────────                             │
  │    출처:                                            │
  │    ¹ docs/auth/middleware.md#JWT-검증       [열기]   │  ← 클릭 → 에디터 이동
  │    ² docs/auth/token-refresh.md#갱신-흐름   [열기]   │  ← 클릭 → 에디터 이동
  └────────────────────────────────────────────────────┘
```

**Citation 클릭 동작**:

```
  Citation [N] 클릭
       │
       ▼
  해당 파일이 이미 열려있음?
  ├── Yes → 탭 전환 + 해당 헤딩으로 스크롤
  └── No  → 새 탭에서 파일 열기 + 해당 헤딩으로 스크롤
       │
       ▼
  참조된 청크 영역을 3초간 하이라이트 (노란 배경 → 페이드아웃)
```

### §11.4.5 인덱싱 생명주기

```
[인덱싱 생명주기]

  1. 초기 빌드 (Vault 열기 시)
  ─────────────────────────────────
  모든 .md 파일 스캔 → 청크 분할 → 임베딩 생성 → 인덱스 저장
  · 백그라운드 실행 (사용자 편집 차단 없음)
  · StatusBar에 진행률 표시: "📊 인덱싱 중... 45/120 파일"
  · 예상 시간: 100개 파일 × 5 청크/파일 × 100ms/임베딩 = ~50초
  · Ollama: 로컬이므로 네트워크 지연 없음, ~2분 (100개 파일)

  2. 증분 갱신 (파일 저장 시)
  ─────────────────────────────────
  notify 파일 워치 이벤트 수신
       │
       ▼
  변경된 파일의 기존 청크 제거 → 재분할 → 재임베딩 → 인덱스 업데이트
  · 단일 파일 갱신: ~500ms (5 청크 재임베딩)

  3. 파일 삭제/이동 시
  ─────────────────────────────────
  해당 파일의 청크 + 임베딩 제거
  · 백링크 인덱스와 동기화 (§29 LinkIndex 연동)

  4. 정리 (주기적)
  ─────────────────────────────────
  · 존재하지 않는 파일의 고아 임베딩 제거 (앱 시작 시)
  · 임베딩 디렉토리 크기 모니터링 (기본 제한: 500MB)
```

### §11.4.6 Knowledge Q\&A 진입점

Knowledge Q\&A는 Chat Panel(Level 3) 안에서 동작한다. 별도의 UI를 추가하지 않고, 기존 Chat Panel에 자연스럽게 통합한다.

```
[Knowledge Q&A 자동 전환 조건]

  Chat Panel에서 사용자 메시지 수신
       │
       ▼
  질문 분류 (휴리스틱)
  ├── @file/@selection/@current 참조 있음 → 기존 Chat 모드 유지
  ├── "이 프로젝트에서", "vault 전체에서" 등 범위 지시어 → Knowledge Q&A
  ├── "어디에", "어떤 파일에", "찾아줘" 등 검색 의도 → Knowledge Q&A
  └── 그 외 일반 질문 → 기존 Chat 모드 유지
       │
       ▼
  Knowledge Q&A 모드 활성화 시:
  · Chat 입력 필드 위에 "🔍 Vault 검색 모드" 배지 표시
  · 검색 진행 시 "📊 23개 문서에서 검색 중..." 표시
  · 응답에 Citation 포함
```

`@vault`**&#x20;참조 추가**:

기존 @reference 시스템에 `@vault` 참조를 추가하여 명시적 Knowledge Q\&A를 트리거한다.

<!-- colwidths:139,295,284 -->

| 참조             | 설명                            | 예시                           |
| -------------- | ----------------------------- | ---------------------------- |
| `@vault`       | Vault 전체를 대상으로 Knowledge Q\&A | `@vault 인증 전략이 뭐야?`          |
| `@folder:path` | 특정 폴더로 범위 제한                  | `@folder:docs/ API 변경점 요약해줘` |

### §11.4.7 구현 범위

**Rust 백엔드 (신규)**:

<!-- colwidths:340,406 -->

| 파일                                         | 역할                                                      |
| ------------------------------------------ | ------------------------------------------------------- |
| `src-tauri/src/embedding/mod.rs`           | 임베딩 모듈 엔트리 (provider 분기)                                |
| `src-tauri/src/embedding/chunker.rs`       | 마크다운 → 청크 분할                                            |
| `src-tauri/src/embedding/ollama_embed.rs`  | Ollama 임베딩 API                                          |
| `src-tauri/src/embedding/openai_embed.rs`  | OpenAI 임베딩 API                                          |
| `src-tauri/src/embedding/gemini_embed.rs`  | Gemini 임베딩 API                                          |
| `src-tauri/src/embedding/vector_store.rs`  | 벡터 인덱스 저장/검색 (메모리 내 brute-force 또는 HNSW)                |
| `src-tauri/src/embedding/hybrid_ranker.rs` | BM25 + 벡터 + 그래프 점수 결합                                   |
| `src-tauri/src/commands/embedding_cmd.rs`  | IPC 커맨드 (embed\_text, search\_knowledge, index\_status) |

**프론트엔드 (확장)**:

<!-- colwidths:328,315 -->

| 파일                                   | 역할                               |
| ------------------------------------ | -------------------------------- |
| `src/ipc/embedding.ts`               | 임베딩 IPC 래퍼                       |
| `src/stores/knowledge-store.ts`      | 인덱싱 상태 (진행률, 통계)                 |
| `src/components/ai/CitationLink.tsx` | Citation 렌더링 + 클릭 네비게이션          |
| `src/components/ai/AIChatPanel.tsx`  | Knowledge Q\&A 모드 분기 + @vault 참조 |
| `src/utils/chat-context.ts`          | Knowledge Q\&A 파이프라인 추가          |

---

## 11.5 Phase 3B: Semantic Wikilink — AI가 제안하는 양방향 링크

사용자가 수동으로 `[[wikilink]]`를 입력하는 대신, AI가 현재 문서와 관련 있는 다른 문서를 자동으로 감지하여 링크를 제안한다.

### §11.5.1 동작 원리

```
[Semantic Wikilink 제안 흐름]

  사용자가 문단 작성 완료 (마침표 + 커서 이동 또는 500ms 정지)
       │
       ▼
  해당 문단의 키 엔티티 추출 (경량 NLP)
  ├── 고유명사, 기술 용어, 개념어 추출
  ├── 기존 [[wikilink]]는 제외 (이미 링크된 것은 스킵)
  └── frontmatter tags와 교차 참조
       │
       ▼
  후보 문서 검색 (Knowledge Q&A 인덱스 활용)
  ├── 추출된 엔티티로 BM25 검색 → 파일명/헤딩 매칭
  ├── 문단 임베딩으로 벡터 검색 → 의미적으로 관련된 문서
  └── 백링크 인덱스에서 현재 파일과 공통 참조 문서 탐색
       │
       ▼
  관련도 필터링 (threshold: 0.7)
  ├── 이미 링크된 문서 제외
  ├── 현재 파일 자체 제외
  └── 상위 3개 후보만 유지
       │
       ▼
  Ghost Link 표시 (Ghost Text와 유사한 UX)
```

### §11.5.2 Ghost Link UI

```
[Ghost Link — ProseMirror Decoration]

  일반 텍스트:
  "Baram은 ProseMirror 기반의 에디터 엔진을 사용한다."

  Ghost Link 제안 시:
  "Baram은 [[ProseMirror]] 기반의 에디터 엔진을 사용한다."
           ↑ 흐린 파란색, 점선 밑줄
           클릭 또는 Tab → 실제 [[wikilink]]로 변환
           Esc → 이 제안 영구 무시

  여러 제안이 있을 때:
  "Baram은 [[ProseMirror]] 기반의 [[에디터 엔진]]을 사용한다."
  StatusBar: "🔗 2개의 링크 제안 (Tab: 수락 / Esc: 무시)"
```

**Ghost Link Decoration 구현**:

```typescript
// Ghost Link Decoration
const ghostLinkDecoration = Decoration.inline(from, to, {
  class: 'ghost-link',          // 흐린 파란색 + 점선 밑줄
  'data-ghost-link': 'true',
  'data-target': targetFilePath,
  'data-display': displayText,
});

// CSS
// .ghost-link {
//   color: var(--accent-primary);
//   opacity: 0.4;
//   text-decoration: underline dotted;
//   cursor: pointer;
// }
// .ghost-link:hover {
//   opacity: 0.7;
// }
```

### §11.5.3 키 엔티티 추출

LLM 호출 없이 경량으로 동작하는 로컬 추출 로직을 우선 구현한다.

```
[엔티티 추출 — 규칙 기반 (LLM 불필요)]

  1단계: 기존 파일명/별칭 사전 구축
  ──────────────────────────────────
  Vault의 모든 .md 파일명 + frontmatter alias 수집
  → Set<string> 형태의 사전 생성 (앱 시작 시, notify로 갱신)

  2단계: 문단 텍스트에서 사전 매칭
  ──────────────────────────────────
  현재 문단의 텍스트를 사전과 대조
  ├── 정확 매칭: "ProseMirror" → prosemirror.md 존재 → 후보
  ├── 퍼지 매칭: "에디터 엔진" → editor-engine.md 존재 → 후보
  └── 대소문자/공백 정규화 후 매칭

  3단계: (선택적) 임베딩 기반 의미 매칭
  ──────────────────────────────────
  Knowledge Q&A 인덱스가 구축된 경우:
  문단 임베딩 → 벡터 검색 → 높은 유사도의 다른 문서 → 후보
```

### §11.5.4 제안 빈도 제어

Ghost Link가 너무 자주 나타나면 사용자를 방해한다. 다음 제약을 적용한다.

<!-- colwidths:216,289,241 -->

| 제약                    | 값                         | 사유                  |
| --------------------- | ------------------------- | ------------------- |
| 문단당 최대 제안             | 3개                        | 과도한 제안 방지           |
| 동일 대상 재제안 금지          | Esc 무시 후 동일 세션에서 재제안하지 않음 | 사용자 의도 존중           |
| 제안 간 최소 간격            | 30초                       | 연속 타이핑 방해 방지        |
| 최소 문단 길이              | 20자 이상                    | 짧은 문단에서 무의미한 제안 방지  |
| Knowledge Q\&A 인덱스 필요 | 벡터 검색은 인덱스 구축 완료 후 활성     | 불완전한 인덱스로 잘못된 제안 방지 |

### §11.5.5 설정

<!-- colwidths:203,125,403 -->

| 설정 항목                 | 기본값          | 설명                                            |
| --------------------- | ------------ | --------------------------------------------- |
| Semantic Wikilink 활성화 | OFF          | Knowledge Q\&A 인덱스 구축 시 자동 ON 제안              |
| 제안 감도                 | Medium (0.7) | 관련도 threshold (Low=0.5, Medium=0.7, High=0.9) |
| 문단당 최대 제안 수           | 3            | 1\~5 조절 가능                                    |
| 사전 매칭만 사용             | OFF          | ON 시 임베딩 검색 없이 파일명 사전만 사용 (가벼움)               |

---

## 11.6 Phase 3C: Agent Mode — 문서 리팩토링 에이전트

Part 6 §6.2의 Level 4 설계를 구체화한다. 코드 에디터의 Agent가 코드를 리팩토링하듯, Baram의 Agent는 **문서를 리팩토링**한다. 이는 마크다운 전용 Agent로서, 코딩 에디터에는 없는 차별화 기능이다.

### §11.6.1 Agent Mode 아키텍처

```
[Agent Mode 아키텍처]

  ┌──────────────────────────────────────────────────────────┐
  │                      Agent Orchestrator                   │
  │                      (프론트엔드)                          │
  │                                                          │
  │  ┌─────────┐    ┌──────────┐    ┌───────────┐           │
  │  │ Planner  │───→│ Executor  │───→│ Reviewer   │          │
  │  │ (계획)   │    │ (실행)    │    │ (검증)     │          │
  │  └─────────┘    └──────────┘    └───────────┘           │
  │       │              │               │                    │
  │       ▼              ▼               ▼                    │
  │  ┌────────────────────────────────────────────┐          │
  │  │            Agent State Machine              │          │
  │  │  idle → planning → reviewing → executing    │          │
  │  │       → paused → completed / failed         │          │
  │  └────────────────────────────────────────────┘          │
  └──────────────────────────┬───────────────────────────────┘
                             │ IPC
                             ▼
  ┌──────────────────────────────────────────────────────────┐
  │                    Rust Backend                           │
  │                                                          │
  │  · 파일 읽기/쓰기 (fs 모듈)                                │
  │  · LLM 호출 (llm 모듈)                                    │
  │  · 검색 (tantivy + embedding)                             │
  │  · 백링크 갱신 (index 모듈)                                │
  └──────────────────────────────────────────────────────────┘
```

### §11.6.2 Agent 실행 파이프라인

```
[Agent Mode 실행 — 상세 흐름]

  ┌─────────────────────────────────────────────────────┐
  │ 1. GOAL SETTING (목표 설정)                           │
  │                                                     │
  │  진입: 커맨드 팔레트 "AI: Agent Mode"                  │
  │  또는: Chat에서 멀티파일 의도 감지 → Agent 전환 제안     │
  │                                                     │
  │  사용자 입력:                                         │
  │  ┌─────────────────────────────────────────────┐    │
  │  │ 💬 모든 스킬 파일의 description을 검토하고,    │    │
  │  │    누락되거나 모호한 것을 개선해줘              │    │
  │  └─────────────────────────────────────────────┘    │
  └────────────────────────┬────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 2. PLANNING (계획 수립) — Opus/o1 모델 사용            │
  │                                                     │
  │  LLM에게 전달:                                       │
  │  · 사용자 목표                                        │
  │  · Vault 파일 트리 (전체 구조)                         │
  │  · 대상 파일들의 frontmatter + 첫 10줄 요약            │
  │                                                     │
  │  LLM이 생성하는 계획:                                  │
  │  {                                                   │
  │    "goal": "스킬 파일 description 개선",              │
  │    "steps": [                                        │
  │      { "file": "skills/summarizer.md",               │
  │        "action": "update_frontmatter",               │
  │        "description": "description 필드 구체화",      │
  │        "risk": "low" },                              │
  │      { "file": "skills/deployer.md",                 │
  │        "action": "update_frontmatter",               │
  │        "description": "description 추가 (누락)",      │
  │        "risk": "medium" },                           │
  │      ...                                             │
  │    ],                                                │
  │    "affectedFiles": 12,                              │
  │    "estimatedChanges": 8,                            │
  │    "risks": ["deployer.md의 requires 필드도 수정 필요"]│
  │  }                                                   │
  └────────────────────────┬────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 3. REVIEW (사용자 계획 검토)                           │
  │                                                     │
  │  ┌─────────────────────────────────────────────┐    │
  │  │ 📋 실행 계획                                  │    │
  │  │                                              │    │
  │  │  ☑ skills/summarizer.md — description 구체화  │    │
  │  │  ☑ skills/deployer.md   — description 추가    │    │
  │  │  ☑ skills/analyzer.md   — description 구체화  │    │
  │  │  ☐ skills/formatter.md  — 변경 불필요 (OK)    │    │
  │  │  ...                                         │    │
  │  │                                              │    │
  │  │  ⚠️ 주의: deployer.md의 requires 필드도       │    │
  │  │     변경이 필요할 수 있습니다                   │    │
  │  │                                              │    │
  │  │  대상: 12개 파일 / 예상 변경: 8개              │    │
  │  │                                              │    │
  │  │  [▶ 실행] [✏️ 계획 수정] [✗ 취소]              │    │
  │  └─────────────────────────────────────────────┘    │
  │                                                     │
  │  사용자가 체크박스로 개별 파일 포함/제외 가능            │
  │  "계획 수정" 클릭 시 텍스트로 수정 지시 가능            │
  └────────────────────────┬────────────────────────────┘
                           │ [▶ 실행]
                           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 4. EXECUTION (자율 실행)                               │
  │                                                     │
  │  각 step을 순차 실행:                                  │
  │  for (step of approvedSteps) {                       │
  │    1. 파일 읽기 (IPC)                                 │
  │    2. LLM에게 변경 요청 (파일 내용 + step 지시)         │
  │    3. diff 생성 (fast-diff)                           │
  │    4. 위험도 확인                                      │
  │       ├── low  → 자동 진행                             │
  │       └── medium/high → 사용자 확인 대기 (PAUSED)       │
  │    5. 변경 결과를 메모리에 저장 (아직 파일 미기록)        │
  │  }                                                   │
  │                                                     │
  │  진행 상황 UI:                                        │
  │  ┌─────────────────────────────────────────────┐    │
  │  │ ⏳ 실행 중... (3/8 파일 완료)                  │    │
  │  │                                              │    │
  │  │  ✅ skills/summarizer.md — 완료              │    │
  │  │  ✅ skills/translator.md — 완료              │    │
  │  │  🔄 skills/deployer.md  — 처리 중...         │    │
  │  │  ⬚ skills/analyzer.md   — 대기 중            │    │
  │  │  ...                                         │    │
  │  │                                              │    │
  │  │  [⏸ 일시정지] [⏹ 중지]                        │    │
  │  └─────────────────────────────────────────────┘    │
  └────────────────────────┬────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 5. RESULT REVIEW (결과 검토 — PR 리뷰 형태)           │
  │                                                     │
  │  ┌─────────────────────────────────────────────┐    │
  │  │ 📊 Agent 결과 — 7개 파일 변경                 │    │
  │  │                                              │    │
  │  │  📄 skills/summarizer.md      +3 -1  [diff]  │    │
  │  │  📄 skills/deployer.md        +5 -0  [diff]  │    │
  │  │  📄 skills/translator.md      +2 -1  [diff]  │    │
  │  │  📄 skills/analyzer.md        +4 -2  [diff]  │    │
  │  │  ...                                         │    │
  │  │                                              │    │
  │  │  [diff] 클릭 → 인라인 diff 미리보기 (Level 2) │    │
  │  │                                              │    │
  │  │  [✓ 전체 수락]  [✗ 전체 거절]  [📝 파일별]     │    │
  │  └─────────────────────────────────────────────┘    │
  │                                                     │
  │  "파일별" 클릭 시:                                    │
  │  각 파일에 개별 [✓ 수락] [✗ 거절] 버튼 표시            │
  │  수락된 파일만 실제 디스크에 기록                        │
  └────────────────────────┬────────────────────────────┘
                           │
                           ▼
  ┌─────────────────────────────────────────────────────┐
  │ 6. COMMIT (변경 확정)                                  │
  │                                                     │
  │  수락된 파일들을 디스크에 기록 (IPC: write_file)         │
  │  백링크 인덱스 갱신 (IPC: update_file_index)           │
  │  Knowledge Q&A 인덱스 갱신 (해당 파일 재임베딩)         │
  │                                                     │
  │  Undo 지원:                                          │
  │  · Agent 실행 전 스냅샷 저장 (§71 File Snapshot 연동)  │
  │  · "Undo Agent" 버튼 → 스냅샷에서 전체 복원            │
  └─────────────────────────────────────────────────────┘
```

### §11.6.3 위험 감지 시스템

Agent가 자율 실행 중 위험한 변경을 감지하면 자동으로 일시 정지하고 사용자 확인을 요청한다.

<!-- colwidths:189,261,85,145 -->

| 위험 유형              | 감지 조건                 | 위험 등급  | 동작         |
| ------------------ | --------------------- | ------ | ---------- |
| frontmatter 스키마 변경 | 기존에 없는 필드 추가/기존 필드 삭제 | medium | 사용자 확인     |
| 파일 구조 대폭 변경        | 헤딩 50% 이상 변경          | medium | 사용자 확인     |
| 파일 삭제 제안           | Agent가 파일 삭제를 요청      | high   | 반드시 사용자 확인 |
| 위키링크 대상 변경         | 기존 링크 URL/대상 수정       | medium | 사용자 확인     |
| 대량 변경              | 단일 파일 변경이 원본의 50% 초과  | medium | 사용자 확인     |
| 문서 분리/병합           | 하나의 파일을 여러 파일로 분리     | high   | 반드시 사용자 확인 |

### §11.6.4 Agent Mode 활용 시나리오

<!-- colwidths:105,290,351 -->

| 시나리오         | 사용자 입력 예시                               | Agent 동작                              |
| ------------ | --------------------------------------- | ------------------------------------- |
| 문서 리팩토링      | "이 긴 문서를 3개로 분리해줘"                      | 문서 분석 → 분리 기준 제안 → 3개 파일 생성 + 링크 갱신   |
| 일괄 번역        | "docs/ 폴더를 영어로 번역, 원본 보존"               | 파일 순회 → 각 파일 번역 → `docs-en/` 에 저장     |
| 용어 통일        | "vault에서 'ML'을 'Machine Learning'으로 통일" | tantivy 검색 → 해당 위치 파악 → 맥락 고려 치환      |
| Skills 일괄 개선 | "모든 스킬의 프롬프트 품질을 개선해줘"                  | Prompt Lint 분석 → 문제 수집 → 개선안 생성 → 적용  |
| 링크 정리        | "깨진 위키링크를 찾아서 수정 제안해줘"                  | 백링크 인덱스 스캔 → 깨진 링크 탐지 → 유사 파일 매칭 → 수정 |
| README 생성    | "이 프로젝트의 README를 작성해줘"                  | 파일 트리 + 주요 문서 분석 → README.md 생성       |

### §11.6.5 구현 범위

<!-- colwidths:363,438 -->

| 파일                                       | 역할                                                               |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `src/stores/agent-store.ts`              | Agent 상태 머신 (idle/planning/reviewing/executing/paused/completed) |
| `src/components/ai/AgentPanel.tsx`       | Agent Mode 전용 패널 UI (계획 뷰 + 진행 뷰 + 결과 뷰)                         |
| `src/components/ai/AgentPlanView.tsx`    | 계획 검토 UI (체크박스, 위험도 배지, 수정 입력)                                   |
| `src/components/ai/AgentDiffView.tsx`    | PR 리뷰 형태 통합 diff 뷰                                               |
| `src/components/ai/AgentProgressBar.tsx` | 실행 진행 상황 (파일별 상태)                                                |
| `src/utils/agent-planner.ts`             | 계획 생성 (LLM 호출 + 파일 트리 분석)                                        |
| `src/utils/agent-executor.ts`            | 계획 실행 (파일별 LLM 호출 + diff 생성)                                     |
| `src/utils/agent-risk-detector.ts`       | 위험 감지 로직                                                         |
| `src/utils/agent-snapshot.ts`            | §71 File Snapshot 연동 — 실행 전 스냅샷                                  |

---

## 11.7 Phase 3C: Authorship Visualization — AI 기여 추적

iA Writer의 Authorship Tracking에서 영감을 받았으나, iA Writer가 AI 생성을 금지하는 반면, Baram은 **AI 생성을 허용하되 투명하게 추적**한다.

### §11.7.1 설계 원칙

```
[Authorship Visualization — 핵심 제약]

  1. 마크다운 파일에 어떠한 추적 마커도 삽입하지 않음
     · 저장된 .md 파일은 순수 마크다운
     · 추적 데이터는 별도 사이드카 파일에 저장

  2. ProseMirror 레벨에서만 시각화
     · Mark 또는 Decoration으로 표시
     · 에디터 내에서만 보임, 내보내기 시 제거

  3. 사용자가 원하지 않으면 완전히 비활성화 가능
     · 설정 토글 하나로 모든 추적 중지
     · 기존 추적 데이터 일괄 삭제 가능
```

### §11.7.2 추적 데이터 구조

```typescript
// .baram/authorship/{filePath}.json
interface AuthorshipData {
  filePath: string;
  version: number;                  // 스키마 버전
  lastUpdated: number;

  segments: AuthorshipSegment[];
}

interface AuthorshipSegment {
  from: number;                     // 텍스트 시작 오프셋 (0-based, 마크다운 소스 기준)
  to: number;                       // 텍스트 끝 오프셋
  origin: 'human' | 'ai-generated' | 'ai-modified';
  timestamp: number;

  // AI 기원 메타데이터
  aiMeta?: {
    provider: string;               // "claude" | "openai" | etc.
    model: string;                  // "claude-sonnet-4-5"
    action: string;                 // "ghost-text" | "inline-edit" | "chat-apply" | "agent"
    prompt?: string;                // 사용된 프롬프트 요약 (최대 200자)
  };
}
```

### §11.7.3 추적 수집 시점

<!-- colwidths:179,302,266 -->

| AI 액션                  | 수집 방식                          | origin 값                        |
| ---------------------- | ------------------------------ | ------------------------------- |
| Ghost Text 수락 (Tab)    | 삽입된 텍스트 범위 기록                  | `ai-generated`                  |
| Inline Edit 수락         | 변경된 범위 기록 (원본 → AI)            | `ai-modified`                   |
| Chat "Apply to Editor" | 적용된 텍스트 범위 기록                  | `ai-generated`                  |
| Agent Mode 결과 수락       | 각 파일의 변경 범위 기록                 | `ai-generated` 또는 `ai-modified` |
| 사용자 직접 편집              | 편집된 범위의 origin을 `human`으로 덮어쓰기 | `human`                         |

**origin 전환 규칙**:

```
  ai-generated 영역에 사용자가 타이핑 → human으로 변환
  human 영역에 AI가 수정 → ai-modified로 변환
  ai-modified 영역에 사용자가 타이핑 → human으로 변환
```

### §11.7.4 시각화 UI

```
[Authorship 시각화 — 토글 ON 시]

  일반 모드 (기본):
  "이 프로젝트는 Tauri 기반입니다."   ← 변화 없음 (human)
  "WYSIWYG 편집을 제공합니다."       ← 변화 없음 (human)
  "AI 통합이 핵심 차별화입니다."      ← 연한 보라색 배경 (ai-generated)
  "성능 최적화를 통해 빠른 응답을"     ← 연한 노란색 배경 (ai-modified)

  통계 모드 (StatusBar 클릭 시 패널):
  ┌─────────────────────────────────────┐
  │ 📊 문서 Authorship                   │
  │                                     │
  │  👤 사용자 작성:    73% (1,240자)     │
  │  🤖 AI 생성:        18% (306자)      │
  │  ✏️ AI 수정:         9% (153자)      │
  │                                     │
  │  ██████████████░░░░░░               │
  │  73%           18%  9%              │
  │                                     │
  │  최근 AI 활동:                       │
  │  · 2분 전 — Ghost Text 수락 (3문장)  │
  │  · 15분 전 — Inline Edit (1문단)    │
  └─────────────────────────────────────┘
```

**시각화 CSS**:

```css
/* Authorship Decoration 스타일 */
.authorship-ai-generated {
  background-color: rgba(168, 85, 247, 0.08);    /* 연한 보라 */
  border-left: 2px solid rgba(168, 85, 247, 0.3);
}
.authorship-ai-modified {
  background-color: rgba(234, 179, 8, 0.08);     /* 연한 노랑 */
  border-left: 2px solid rgba(234, 179, 8, 0.3);
}

/* 다크 모드 */
[data-theme="dark"] .authorship-ai-generated {
  background-color: rgba(168, 85, 247, 0.12);
}
[data-theme="dark"] .authorship-ai-modified {
  background-color: rgba(234, 179, 8, 0.12);
}
```

### §11.7.5 사이드카 파일 동기화

```
[Authorship 데이터 동기화]

  파일 저장 시:
  1. 현재 ProseMirror Doc의 authorship 세그먼트 수집
  2. 마크다운 소스 텍스트의 오프셋으로 변환
  3. .baram/authorship/{filePath}.json 저장

  파일 열기 시:
  1. .baram/authorship/{filePath}.json 로드
  2. 마크다운 소스 오프셋 → ProseMirror 위치로 변환
  3. Decoration으로 시각화

  외부 편집 감지 시 (notify):
  · 사이드카 데이터 무효화 → 전체 영역을 "human"으로 리셋
  · (외부 편집은 추적 불가하므로 보수적으로 처리)
```

### §11.7.6 구현 범위

<!-- colwidths:397,349 -->

| 파일                                           | 역할                                     |
| -------------------------------------------- | -------------------------------------- |
| `src/extensions/plugins/authorship.ts`       | ProseMirror Plugin — Decoration 기반 시각화 |
| `src/stores/authorship-store.ts`             | Zustand — 파일별 authorship 데이터 관리        |
| `src/utils/authorship-tracker.ts`            | AI 액션 수집 + origin 전환 로직                |
| `src/utils/authorship-sync.ts`               | 사이드카 파일 저장/로드 + 오프셋 변환                 |
| `src/components/toolbar/AuthorshipPanel.tsx` | 통계 패널 UI                               |

---

## 11.8 Phase 3C: Smart Templates — AI 기반 문서 생성

사용자가 문서 유형만 지정하면 AI가 프로젝트 컨텍스트를 분석하여 적절한 구조와 내용을 갖춘 문서를 생성한다.

### §11.8.1 동작 흐름

```
[Smart Template 흐름]

  진입: 슬래시 커맨드 /ai-template 또는 커맨드 팔레트 "AI: New from Template"
       │
       ▼
  템플릿 유형 선택
  ┌────────────────────────────────────┐
  │ 📝 Smart Template                  │
  │                                    │
  │  📄 API Documentation              │
  │  📋 Meeting Notes                  │
  │  📊 Technical Spec                 │
  │  📖 Tutorial / How-to             │
  │  📝 Blog Post                      │
  │  📑 Release Notes                  │
  │  📓 Research Notes                 │
  │  ⌨️ Custom...                      │
  └────────────────────────────────────┘
       │
       ▼
  컨텍스트 수집 (자동)
  ├── 프로젝트 루트의 README.md / package.json 분석
  ├── 현재 폴더의 기존 문서 패턴 분석 (frontmatter, 헤딩 구조)
  ├── 최근 편집 파일의 주제/스타일 참조
  └── Skills 파일이 있으면 관련 Skills 연동
       │
       ▼
  LLM 호출 → 문서 구조 생성
  ├── frontmatter (적절한 메타데이터)
  ├── 섹션별 헤딩 구조
  ├── 각 섹션에 placeholder 텍스트
  └── Ghost Text 준비 (각 섹션에서 멈출 때 맥락에 맞는 제안)
       │
       ▼
  새 파일 생성 + 에디터에서 열기
  · 첫 번째 placeholder 위치에 커서 배치
  · Ghost Text가 즉시 활성화
```

### §11.8.2 내장 템플릿 정의

<!-- colwidths:146,401,199 -->

| 템플릿                   | 생성되는 구조                                                        | 컨텍스트 활용                  |
| --------------------- | -------------------------------------------------------------- | ------------------------ |
| **API Documentation** | Overview / Auth / Endpoints / Errors / Examples                | package.json에서 API 정보 추출 |
| **Meeting Notes**     | Date / Attendees / Agenda / Discussion / Action Items          | 최근 회의 노트 패턴 참조           |
| **Technical Spec**    | Overview / Background / Design / API / Testing / Timeline      | 기존 기술 문서 스타일 학습          |
| **Tutorial**          | Introduction / Prerequisites / Steps / Troubleshooting         | 프로젝트 기술 스택 기반            |
| **Blog Post**         | Title / Hook / Body / Conclusion / Call to Action              | 기존 블로그 포스트 톤 참조          |
| **Release Notes**     | Version / Highlights / New Features / Fixes / Breaking Changes | git log에서 최근 변경 추출       |
| **Research Notes**    | Question / Background / Methods / Findings / Next Steps        | 기존 연구 노트 패턴              |
| **Custom**            | 사용자가 설명 → AI가 구조 제안                                            | 전체 Vault 컨텍스트            |

### §11.8.3 Ghost Text 연동

Smart Template으로 생성된 문서는 Writing Flow Awareness(§11.3)와 연동하여 각 placeholder 섹션에 특화된 Ghost Text를 제공한다.

```
[Template + Ghost Text 연동]

  생성된 문서:
  ---
  title: API Documentation
  template: api-doc
  ---

  # Overview
  |                               ← 커서 여기에서 멈추면:
                                     Ghost Text: "Baram은 Tauri 기반의
                                     마크다운 에디터로, 다음과 같은 API를..."

  ## Authentication
  |                               ← 커서 여기에서 멈추면:
                                     Ghost Text: "인증은 JWT 토큰 기반으로
                                     수행됩니다. 다음 헤더를 포함하세요:..."

  템플릿 메타데이터가 WritingFlowStore에 전달되어
  각 섹션의 의도에 맞는 Ghost Text 프롬프트 생성
```

---

## 11.9 구현 로드맵

### §11.9.1 Phase별 구현 계획

```
Phase 3A — 기존 기능 완성 및 빠른 개선 (1~2주)
──────────────────────────────────────────────────

  §11.2.1 Per-task 모델 라우팅
    · model-selection.ts → IPC 연결
    · use-llm-stream.ts에 task 기반 config 주입
    · 예상: 2일

  §11.2.2 Ghost Text 프리페치 + 캐싱
    · GhostTextCache 구현 (50 엔트리, 5분 TTL)
    · 프리페치 트리거 (문단 끝 감지)
    · 예상: 3일

  §11.2.3 Contextual AI Toolbar
    · content-type-detector.ts 구현
    · 모드별 메뉴 정의 (5종)
    · FloatingToolbar 분기 로직
    · 예상: 3일

  §11.2.4 Privacy Mode 강화
    · Rust: no-store 헤더 추가
    · per-file frontmatter privacy 감지
    · StatusBar 표시
    · 예상: 2일


Phase 3B — 핵심 차별화 (3~4주)
──────────────────────────────────────────────────

  §11.3 Writing Flow Awareness
    · WritingFlowPlugin (ProseMirror)
    · WritingModeDetector (7모드)
    · SessionContext 편집 패턴 분석
    · SessionMemory 수집/주입
    · 예상: 1.5주

  §11.4 Knowledge Q&A (하이브리드 검색)
    · Rust: 임베딩 모듈 (Ollama/OpenAI/Gemini)
    · Rust: 청크 분할 + 벡터 저장소
    · Rust: 하이브리드 랭커 (BM25 + 벡터 + 그래프)
    · Frontend: @vault 참조 + Citation UI
    · 인덱싱 생명주기 (초기 빌드 + 증분 갱신)
    · 예상: 2주

  §11.5 Semantic Wikilink
    · 엔티티 추출 (파일명 사전 매칭)
    · Ghost Link Decoration
    · Knowledge Q&A 인덱스 연동 (선택적)
    · 제안 빈도 제어
    · 예상: 1주


Phase 3C — 고급 기능 (4~6주)
──────────────────────────────────────────────────

  §11.6 Agent Mode
    · Agent State Machine + Store
    · Planner (LLM 기반 계획 생성)
    · Executor (파일별 LLM 호출 + diff)
    · Risk Detector (6종 위험 감지)
    · Agent Panel UI (계획/진행/결과 뷰)
    · §71 File Snapshot 연동 (Undo)
    · 예상: 3주

  §11.7 Authorship Visualization
    · ProseMirror Plugin (Decoration)
    · 추적 수집 (5종 AI 액션)
    · 사이드카 파일 동기화
    · 통계 패널 UI
    · 예상: 1.5주

  §11.8 Smart Templates
    · 내장 템플릿 7종 정의
    · 컨텍스트 수집 (프로젝트 분석)
    · LLM 호출 → 문서 생성
    · Writing Flow 연동
    · 예상: 1주
```

### §11.9.2 의존 관계

```
[구현 의존 관계 그래프]

  Phase 3A (독립적, 병렬 가능)
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ Per-task 모델 │  │ Ghost Text   │  │ Contextual   │  │ Privacy Mode │
  │ 라우팅       │  │ 캐싱/프리페치 │  │ AI Toolbar   │  │ 강화         │
  └──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────────────┘
         │                 │
         ▼                 ▼
  Phase 3B
  ┌──────────────────────────┐
  │ Writing Flow Awareness    │ ← Ghost Text 캐싱 활용
  │ (§11.3)                   │ ← Per-task 라우팅 활용
  └──────────────┬───────────┘
                 │
  ┌──────────────┴───────────┐
  │ Knowledge Q&A             │ ← Writing Mode가 검색 가중치 조정에 활용
  │ (§11.4)                   │
  └──────────────┬───────────┘
                 │
  ┌──────────────┴───────────┐
  │ Semantic Wikilink         │ ← Knowledge Q&A 인덱스 필요 (벡터 검색)
  │ (§11.5)                   │ ← 파일명 사전 매칭은 독립적으로 동작 가능
  └──────────────────────────┘

  Phase 3C
  ┌──────────────────────────┐
  │ Agent Mode               │ ← Knowledge Q&A (파일 검색)
  │ (§11.6)                  │ ← Per-task 라우팅 (Opus 자동 선택)
  └──────────────────────────┘
  ┌──────────────────────────┐
  │ Authorship Visualization │ ← 독립적 (AI 액션 수집만)
  │ (§11.7)                  │
  └──────────────────────────┘
  ┌──────────────────────────┐
  │ Smart Templates          │ ← Writing Flow (Ghost Text 연동)
  │ (§11.8)                  │ ← Knowledge Q&A (컨텍스트 수집)
  └──────────────────────────┘
```

### §11.9.3 성능 기준 (Part 8 §8.4 확장)

<!-- colwidths:225,200,299 -->

| 지표                    | 목표                    | 측정 방법                            |
| --------------------- | --------------------- | -------------------------------- |
| Ghost Text 캐시 히트 시 표시 | < 50ms                | 캐시 조회 → Decoration 갱신            |
| Knowledge Q\&A 검색 응답  | < 2초 (10개 결과)         | 사용자 질문 → 검색 완료                   |
| Knowledge Q\&A 초기 인덱싱 | < 2분 (100 파일, Ollama) | Vault 열기 → 인덱싱 완료                |
| Knowledge Q\&A 증분 갱신  | < 500ms (단일 파일)       | 파일 저장 → 재임베딩 완료                  |
| Agent Mode 계획 생성      | < 10초                 | 목표 입력 → 계획 표시                    |
| Agent Mode 파일당 실행     | < 5초                  | 단일 파일 변경 완료                      |
| Semantic Wikilink 제안  | < 200ms               | 문단 완성 → 제안 표시                    |
| Authorship 시각화 오버헤드   | < 5ms per transaction | ProseMirror transaction 처리 추가 시간 |
| Writing Mode 감지       | < 100ms               | 파일 열기 → 모드 결정                    |
| 임베딩 저장소 크기            | < 500MB (1000 파일)     | .baram/embeddings/ 디렉토리          |

---

## 11.10 기술 리스크 및 대응

<!-- colwidths:150,250,346 -->

| 리스크                 | 영향                                  | 대응                                                |
| ------------------- | ----------------------------------- | ------------------------------------------------- |
| 임베딩 API 비용          | 대형 Vault에서 초기 인덱싱 비용                | Ollama 로컬 임베딩 우선, 증분 갱신으로 재인덱싱 최소화                |
| 벡터 검색 정확도           | 하이브리드 검색의 가중치 튜닝 어려움                | 기본 가중치 제공 + 사용자 조절 가능 + 질문 유형별 자동 조정              |
| Agent Mode 안전성      | 자율 실행 시 의도하지 않은 변경                  | 계획 검토 + 위험 감지 중단 + File Snapshot Undo + 파일별 수락/거절 |
| Writing Mode 오감지    | 잘못된 모드로 부적절한 제안                     | confidence score 임계값(0.6) + 수동 모드 지정 설정           |
| Authorship 오프셋 드리프트 | 외부 편집 시 오프셋 불일치                     | 외부 편집 감지 → 전체 human 리셋 (보수적 처리)                   |
| Ghost Link 과도한 제안   | 사용자 집중 방해                           | 빈도 제한 (30초 간격) + 문단당 최대 3개 + 쉬운 비활성화              |
| Ollama 임베딩 품질       | 로컬 모델의 임베딩 품질이 Cloud 대비 낮을 수 있음     | BM25 + 링크 그래프가 보완, 사용자에게 Cloud 임베딩 권장 옵션 제공       |
| 인덱스 저장 용량           | 대형 Vault (1000+ 파일)에서 .baram/ 크기 증가 | 용량 제한(500MB) + 자동 정리 + 선택적 폴더 인덱싱                 |
| 세션 메모리 프롬프트 길이      | reject/prefer 패턴이 누적되어 프롬프트 비대화     | 최대 10개 항목으로 제한, 오래된 항목 자동 퇴출                      |

---

## 11.11 Baram AI 차별화 포지셔닝

```
[Baram AI 정체성]

  "마크다운 파워유저를 위한 AI"

  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  🔒 로컬 가능     — Ollama 기반, 오프라인에서도 AI 사용    │
  │                                                         │
  │  👁️ 투명하게 추적  — AI가 쓴 부분을 시각적으로 구분         │
  │                                                         │
  │  🔗 지식 연결     — BM25 + 벡터 + 링크 그래프 3중 검색     │
  │                                                         │
  │  ✍️ 맥락 인지     — 글쓰기 모드/패턴에 맞춘 AI 제안         │
  │                                                         │
  │  📄 문서 전용 Agent — 리팩토링, 번역, 용어 통일, 링크 정리  │
  │                                                         │
  └─────────────────────────────────────────────────────────┘

  vs 경쟁자:
  ┌──────────────┬────────────────────────────────────────────┐
  │ Cursor/VS Code│ 코드 Agent만 → Baram은 마크다운 전용 Agent  │
  │ Notion AI     │ 클라우드 종속 → Baram은 로컬 우선           │
  │ Obsidian     │ 벡터만 → Baram은 3중 하이브리드 검색         │
  │ Craft        │ On-device만 → Baram은 On-device + Cloud 하이브리드 │
  │ iA Writer    │ AI 금지 → Baram은 AI 허용 + 투명 추적        │
  │ Windsurf     │ 코딩 Flow → Baram은 글쓰기 Flow             │
  └──────────────┴────────────────────────────────────────────┘
```

---

*Part 11 끝. 본 설계는 Part 6(AI 통합 설계)의 확장이며, 기존 §6.1\~§6.4의 원칙과 아키텍처를 계승한다.*
