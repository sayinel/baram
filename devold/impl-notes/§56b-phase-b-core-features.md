# §56b-§56l Phase B: 핵심 기능 — 구현 노트

## Batch 분할

### Batch B-1: 유틸리티 + 타입 + 스토어 (테스트 가능)
- B1 core: One Line 추출 함수, Memories 데이터 로딩 로직
- B6 core: 무드/에너지 타입, frontmatter 파싱/직렬화 헬퍼
- B9 core: 캡처 타입 4종, 캡처 마크다운 파싱/직렬화
- Journal store: Memories 데이터, 무드 캐시

### Batch B-2: UI 컴포넌트
- MemoriesView (right panel — Journal/Photos/Notes 탭)
- MoodBar (에디터 상단 무드/에너지 입력)
- QuickCaptureDialog (Cmd+Shift+N)
- AppLayout 통합 (memories 모드 렌더링)
- ActivityBar 통합 (memories 아이콘)

### Batch B-3: 통합 + 슬래시 커맨드
- 슬래시 커맨드 (/idea, /link, /quote, /note)
- CalendarPanel 계층적 경로 지원
- Capture → Notes 승격 워크플로우

## Requirements (Batch B-1 — 이번 구현 대상)

### One Line 추출 (§4.4)
- frontmatter `oneline` 필드 우선
- Diary 섹션에서만 추출 (## Diary ~ 다음 ## 사이)
- ## Diary 없으면 본문 전체에서 추출 (하위 호환)
- Captures 섹션 제외
- 최대 100자, 초과 시 `…`

### 무드/에너지 타입 (§56e)
- mood: "deep" | "calm" | "neutral" | "warm" | "bright" | undefined
- energy: 1~5 | undefined
- frontmatter에서 읽기/쓰기 헬퍼

### 캡처 타입 (§56l)
- 4종: idea(✦), link(↗), quote(❝), note(☰)
- 마크다운: `- ✦ **제목**: 내용 #태그`
- 파싱: 불릿 리스트에서 캡처 아이콘 접두사 감지
- 직렬화: CaptureItem → 마크다운 불릿 문자열

### Memories 데이터 (§4.6)
- 현재 날짜의 MM-DD에 맞는 과거 일기 파일 스캔
- 연도 역순 정렬
- One Line 모드: 각 연도의 첫 줄만 로드

## Dependencies
- `src/utils/journal.ts` — 기존 유틸
- `src/stores/settings-store.ts` — journal 설정
- `src/ipc/invoke.ts` — listDir, readFile

## Files to Create/Modify

### 생성
- `src/utils/journal-memories.ts` — One Line 추출, Memories 데이터 로딩
- `src/utils/journal-mood.ts` — 무드/에너지 타입, frontmatter 헬퍼
- `src/utils/journal-capture.ts` — 캡처 파싱/직렬화
- `src/utils/__tests__/journal-memories.test.ts`
- `src/utils/__tests__/journal-mood.test.ts`
- `src/utils/__tests__/journal-capture.test.ts`

### 수정
- (없음 — Batch B-1은 순수 유틸리티만 추가)

## Implementation Order
1. 타입/인터페이스 정의
2. journal-mood.ts — 무드/에너지 헬퍼
3. journal-memories.ts — One Line 추출 + Memories 로딩
4. journal-capture.ts — 캡처 파싱/직렬화
5. 테스트 작성 및 통과 확인
