# #35 인스톨러 — 구현 노트

## Requirements (§8.2, §8.5)
- macOS: .dmg 인스톨러
- Windows: .msi 또는 NSIS 인스톨러
- Linux: .AppImage, .deb
- 앱 바이너리 < 15MB
- .md 파일 연결 (File Association)
- 버전: v0.1.0 (MVP Beta)

## Dependencies
- Tauri 2.0 내장 bundler (각 플랫폼별 자동 생성)
- 아이콘 세트: 이미 존재 (`src-tauri/icons/`)
- CI: GitHub Actions 3-platform matrix 이미 존재

## Technical Details

### 1. tauri.conf.json bundle 강화
- macOS: category, minimumSystemVersion, DMG 설정
- Windows: NSIS (Tauri 2 권장, MSI보다 현대적)
- Linux: deb depends, desktop entry, AppImage
- 공통: .md 파일 연결 (fileAssociations)

### 2. CI 아티팩트 업로드
- 기존 build job에 actions/upload-artifact 추가
- 플랫폼별 번들 산출물 경로 매핑

### 3. Release 워크플로우 신규 생성
- v* 태그 push 시 트리거
- 3플랫폼 빌드 → GitHub Release 생성 + 에셋 업로드

## Files to Create/Modify
- `src-tauri/tauri.conf.json` — bundle 설정 강화
- `.github/workflows/ci.yml` — 아티팩트 업로드 추가
- `.github/workflows/release.yml` — 신규: 태그 릴리스 워크플로우

## Implementation Order
1. tauri.conf.json bundle 설정 강화
2. CI workflow 아티팩트 업로드
3. Release workflow 생성
