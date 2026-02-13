# /perf-bench — 성능 벤치마크 실행

Part 8 §8.4의 성능 기준을 기반으로 벤치마크를 실행하고 결과를 보고한다.

## 사용법

```
/perf-bench              # 전체 벤치마크
/perf-bench startup      # 앱 시작 시간만
/perf-bench typing       # 타이핑 레이턴시만
/perf-bench file-open    # 파일 열기 속도만
```

## 인자

- `$ARGUMENTS`: (선택) 특정 벤치마크 카테고리

---

## 벤치마크 항목 및 기준 (Part 8 §8.4)

| 지표 | 목표 | 측정 방법 | 시작 시점 |
|------|------|-----------|-----------|
| 앱 시작 → 에디터 준비 (콜드) | < 1.5초 | `performance.now()` 타이머 | M1 |
| 앱 시작 → 에디터 준비 (웜) | < 0.5초 | 캐시 있는 상태에서 측정 | M1 |
| 1,000줄 파일 열기 | < 200ms | `invoke('read_file')` → 에디터 렌더링 완료 | M2 |
| 10,000줄 파일 열기 | < 1초 | 동일 | M3 |
| 타이핑 레이턴시 (키→화면) | < 16ms | requestAnimationFrame 기반 측정 | M2 |
| KaTeX 렌더링 (복잡 수식) | < 50ms | KaTeX.renderToString 프로파일링 | M3 |
| Ghost Text 응답 (첫 토큰) | < 1.5초 | LLM API 호출 → 첫 토큰 수신 | M5 |
| 파일 저장 | < 100ms | `invoke('write_file')` 완료 | M2 |
| 전체 인덱싱 (1,000파일) | < 10초 | `invoke('refresh_index')` 완료 | M7 |
| 증분 인덱싱 (1파일) | < 50ms | 파일 변경 → 인덱스 갱신 완료 | M7 |
| 검색 쿼리 응답 | < 100ms | `invoke('search_files')` 완료 | M7 |
| 앱 바이너리 크기 | < 15MB | 빌드 결과물 크기 | M6 |
| 유휴 메모리 사용 | < 100MB | process.memoryUsage() | M2 |
| 편집 중 메모리 (10,000줄) | < 300MB | 대용량 파일 편집 중 측정 | M3 |

---

## 벤치마크 스크립트 생성

실행 시 다음 파일들을 생성/업데이트한다:

### `tests/bench/startup-bench.ts`
앱 시작 시간 측정 (Tauri process spawn → 에디터 ready 이벤트)

### `tests/bench/file-open-bench.ts`
다양한 크기의 .md 파일 열기 속도 측정

### `tests/bench/typing-bench.ts`
에디터에 텍스트 입력 후 렌더링 완료까지 시간 측정

### `tests/bench/memory-bench.ts`
다양한 시나리오에서 메모리 사용량 측정

### `tests/bench/roundtrip-perf-bench.ts`
마크다운 파싱/직렬화 파이프라인 성능

---

## 결과 보고

```
=== Baram Performance Benchmark ===

Startup (cold):     1.2s    target < 1.5s    ✅ PASS
Startup (warm):     0.4s    target < 0.5s    ✅ PASS
File open (1K):     180ms   target < 200ms   ✅ PASS
File open (10K):    850ms   target < 1.0s    ✅ PASS
Typing latency:     12ms    target < 16ms    ✅ PASS
KaTeX render:       35ms    target < 50ms    ✅ PASS
File save:          45ms    target < 100ms   ✅ PASS
Binary size:        12MB    target < 15MB    ✅ PASS
Idle memory:        85MB    target < 100MB   ✅ PASS
Edit memory (10K):  250MB   target < 300MB   ✅ PASS

Overall: 10/10 PASS ✅
```

결과를 `docs/progress.json`의 performance 필드에 업데이트한다.

## 기준 미달 시

벤치마크가 목표를 초과하면:
1. 프로파일링으로 병목 지점 식별
2. 최적화 방안 제안
3. 해당 마일스톤의 완료를 보류 권고
