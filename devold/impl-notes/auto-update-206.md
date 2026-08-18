# 자동 업데이트 (Issue #206) — 릴리스 절차 및 운영 노트

작성: 2026-07-19 · 브랜치: feature/auto-update-206 · 계획: `.omc/plans/auto-update-issue-206.md`

## 아키텍처 요약

- **서명**: Tauri minisign 키쌍 (Apple 코드사이닝과 무관, 무료). pubkey는 `src-tauri/tauri.conf.json` `plugins.updater.pubkey`에 임베드
- **endpoint**: `https://github.com/sayinel/baram/releases/latest/download/latest.json`
- **플랫폼 정책**: Windows/Linux(AppImage) = 완전 자동 설치 · **macOS = notify-only** (다운로드 페이지 열기 — 무서명 ad-hoc 앱 교체 시 TCC 폴더 권한 리셋 회피). Apple Developer 가입 후 `src/services/app-update.ts`의 macOS 분기만 제거하면 완전 자동화
- **Linux deb/rpm**: in-app 업데이트 미지원 (Tauri는 AppImage만) → 설치 실패 시 releases 페이지 폴백

## 릴리스 절차 (v0.4.0부터)

1. 버전 3파일 + Cargo.lock 범프, `npm run version:check`
2. `v*` 태그 push → CI 3-플랫폼 빌드 → **draft** 릴리스 자동 생성
   - tauri-action이 `latest.json` + `.sig`를 자동 생성·병합 (서명 시크릿 필수 — 없으면 updater 아티팩트 미생성)
3. **Publish 전 릴리스 본문을 실제 변경사항으로 작성** — 본문이 곧 인앱 릴리스 노트(latest.json `notes`)로 표시됨
4. Publish 클릭 → 이 시점부터 업데이트 배포 시작
   - draft 상태에서는 이중으로 차단됨(fail-safe): `releases/latest/download/*`는 published만 조회 + draft 자산은 인증 필요

## 서명 키 관리 (CRITICAL)

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — GitHub repo secrets
- 키 파일: `~/.tauri/baram-updater.key` (로컬) — **passphrase와 함께 오프라인 백업 필수**
- **키 분실 = 기존 설치 사용자 전원에게 업데이트 영구 배포 불가** (pubkey가 바이너리에 임베드)
- 릴리스 체크리스트에 "백업 존재 확인" 포함할 것

## tauri-action 동작 (action-v1.0.0 소스 검증, 2026-07-19)

- **latest.json 병합 레이스**: 3개 matrix job이 동시에 latest.json을 읽고-병합-재업로드 (CAS 없음, retry로 수렴). 릴리스 후 latest.json에 플랫폼 항목이 빠져 있으면 → tauri-action step에 `retryAttempts` 증가로 대응 (matrix 직렬화는 비권장)
- **Windows msi/nsis**: `updaterJsonPreferNsis`는 **설정하지 않음** (기본 false = 무접미사 키가 MSI). v0.5.24+부터 `windows-x86_64-msi` / `windows-x86_64-nsis` 키가 무조건 병기되고, 클라이언트 plugin-updater ≥2.10.0(우리는 2.10.1)이 자기 설치 형식에 맞는 키를 조회 → msi/nsis 사용자 각각 올바른 형식으로 업데이트. **NSIS→MSI 방향은 공식 미지원** (이중 설치 위험, tauri#6859) — MSI fallback 유지가 안전한 방향
- **macOS universal**: 단일 universal `.app.tar.gz`가 `darwin-aarch64`/`darwin-x86_64` 양쪽 키에 기입됨 (클라이언트는 자기 네이티브 arch 키를 조회) — 추가 설정 불필요

## 소급 불가 주의

- v0.3.0 이하 사용자는 updater가 없어 자동 업데이트 불가 → v0.4.0 릴리스 노트에 "마지막 수동 설치" 안내 필요
- 완전한 자동 업데이트 E2E는 v0.4.0 → v0.5.0에서 최초 검증 가능

## dev 모드

- `import.meta.env.DEV`에서 자동 체크 비활성 (dev 0.x.0 < published 최신 오탐 방지)
