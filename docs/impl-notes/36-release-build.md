# #36 릴리스 빌드 — 구현 노트

## Requirements (§8.2, §8.4, §8.5)
- 앱 바이너리 크기 < 15MB
- 릴리스 프로파일 최적화 (strip, LTO, opt-level)
- devtools는 개발 모드에서만 활성화
- 버전 v0.1.0 (MVP Beta)
- 3플랫폼 빌드 검증 (macOS/Windows/Linux)

## Technical Details

### 1. Cargo release profile
- `opt-level = "s"`: 크기 최적화 (속도와 균형)
- `lto = true`: Link-Time Optimization으로 데드코드 제거
- `strip = "symbols"`: 디버그 심볼 제거
- `codegen-units = 1`: 최적화 품질 향상 (빌드 느려지지만 바이너리 작아짐)
- `panic = "abort"`: unwinding 코드 제거

### 2. devtools 분리
- Tauri 2: debug 빌드에서는 devtools 자동 활성
- release에서 devtools feature 제거 → 바이너리 크기 감소

### 3. 로컬 릴리스 빌드 검증
- `npm run tauri build` 실행
- 바이너리 크기 측정
- DMG 생성 확인 (macOS)

## Files to Create/Modify
- `src-tauri/Cargo.toml` — release profile + devtools 조건부
- `docs/progress.json` — #36 완료 처리

## Implementation Order
1. Cargo.toml release profile 추가
2. devtools를 dev-only로 분리
3. 로컬 릴리스 빌드 + 크기 검증
