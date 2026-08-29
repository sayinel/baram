# 설계 문서 § 지도

> CLAUDE.md에서 이전된 조회용 문서 — **어떤 §가 어느 설계 문서에 있는지 찾을 때 읽을 것.** ("구현 시 § 참조·커밋에 § 유지" 규칙 자체는 CLAUDE.md에 있다.)

| 영역        | 설계 문서                                  | 핵심 참조                                                                                                                                     |
| --------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 아키텍처      | `dev/design/part3-architecture.md`    | §3.1 스택, §3.2 IPC, §3.3 엔진, §3.4 Extension, §3.5 상태, §3.6 파일                                                                              |
| UI/UX     | `dev/design/part4-uiux.md`            | §4.1 원칙, §4.2 레이아웃, §4.3~§4.8 각 요소                                                                                                        |
| 기능 상세     | `dev/design/part5-core-features.md`   | §5.1~§5.15 각 기능 상세 스펙                                                                                                                     |
| AI 통합     | `dev/design/part6-ai-integration.md`  | §6.1 전략, §6.2 5-Level, §6.3 Provider                                                                                                      |
| 데이터 모델    | `dev/design/part7-data-models.md`     | §7.1 MD 규격, §7.2 PM 스키마, §7.3~§7.5 DB                                                                                                     |
| 로드맵       | `dev/design/part8-roadmap.md`         | §8.1 Phase, §8.2 마일스톤, §8.4 품질, §8.6 의존성                                                                                                  |
| AI 고도화    | `dev/design/part11-ai-enhancement.md` | §11.2 빠른 개선, §11.3 Writing Flow, §11.4 Knowledge Q&A, §11.5 Semantic Wikilink, §11.6 Agent Mode, §11.7 Authorship, §11.8 Smart Templates |
| Vault 시스템 | `dev/design/part12-vault-system.md`   | §80 Context 모델, §81 워크스페이스, §82~§84 UI, §85 Journal, §86 설정 계층, §87 Cross-vault 링크, §88 ContextManager, §89~§90 파일/시작                     |

주의: `dev/` 설계 문서 원본은 프로젝트 원주인 소유라 이 머신에 없을 수 있다 — 없는 것이 정상이며 경로를 "수정"하지 말 것.
