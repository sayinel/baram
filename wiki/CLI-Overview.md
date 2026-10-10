# CLI Overview

**앱 실행 파일 하나가 인자를 보고 편집기와 명령줄 도구 둘로 돈다.** 명령줄 도구는 AI 에이전트와
스크립트가 vault 를 조회하는 길이고, 읽기만 한다. 이 페이지는 그 성질과 각각의 이유를 한 줄씩 요약한다 —
모양은 [Architecture](CLI-Architecture), 이유의 전문은 [Decisions and history](CLI-Decisions-and-history)
가 답한다.

| 성질                    | 무엇                                                                 | 왜                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실행 파일 하나, 모드 둘 | argv 만 보고 GUI 와 CLI 를 가른다 (`cli::mode_for`)                  | 두 번째 실행 파일을 번들에 싣지 않으므로 서명 · 공증 · universal 빌드가 그대로이고, CLI 와 앱의 버전이 어긋날 수 없다 ([결정](CLI-Decisions-and-history))      |
| 앱 없이 직접 읽는다     | 앱을 거치지 않고 앱과 같은 Rust 함수로 디스크의 vault 를 직접 읽는다 | 앱을 거치면 앱에 새 입구(소켓)가 생기고 그 입구의 인증 · 경로 제한을 따로 설계해야 한다. 앱이 꺼져 있으면 창도 띄워야 한다 ([결정](CLI-Decisions-and-history)) |
| 읽기 전용               | vault, 앱의 `config.json`, 앱 로그 파일에 쓰지 않는다                | 쓰기 명령은 열린 탭과 충돌하지 않으려면 앱을 거쳐야 한다 — 윗줄이 피한 새 입구를 요구한다 ([결정](CLI-Decisions-and-history))                                  |
| JSON 은 공개 계약       | IPC 구조체를 그대로 직렬화하지 않고 CLI 전용 구조체로 옮겨 담는다    | IPC 구조체는 프런트엔드의 필요로 바뀐다 ([결정](CLI-Decisions-and-history))                                                                                    |

## 앱과 같은 답이 목표다

vault 를 읽는 명령은 앱과 같은 Rust 함수를 부른다 — 앱과 같은 답을 내는 것이 목표이기 때문이다.
다른 곳은 이유를 적어 둔다. 함수를 나눠 쓰는 구조는 [Architecture](CLI-Architecture) 의 경계 2,
갈림의 종류는 [Links and app parity](CLI-Links-and-app-parity), 갈림의 목록과 예는
[사용자 문서](https://baram.ing/ko/docs/command-line/) 의 "앱과 다른 점" 이 답한다.

## 읽는 순서

1. **[Architecture](CLI-Architecture)** — 먼저 읽는다. 층과 경계, 그리고 경로 인자나 출력 한 주제에
   속하지 않는 불변식. 나머지 페이지는 이 그림 위의 이야기다.
2. 그 다음은 관심 영역으로. 경로 인자를 더하거나 고친다면
   **[Paths and vault boundary](CLI-Paths-and-vault-boundary)**, 출력이나 오류를 건드린다면
   **[Output contract](CLI-Output-contract)**, CLI 와 앱의 답이 갈린다는 보고를 받았다면
   **[Links and app parity](CLI-Links-and-app-parity)**.
3. **[Decisions and history](CLI-Decisions-and-history)** — 결정을 되짚거나 뒤집기 전에 읽는다.

## 어디까지 와 있나

**이 wiki 의 CLI 페이지는 main 브랜치의 코드를 적는다.** 명령 목록과 쓰는 법은
[사용자 문서](https://baram.ing/ko/docs/command-line/) 가, CLI 가 든 릴리스가 있는지와 무엇이 머지됐고
다음 단계가 무엇인지는 [#847](https://github.com/sayinel/baram/issues/847) 이 답한다.

## 여기 없는 것

wiki 는 거의 변하지 않는 것만 싣는다. 자주 변하는 것은 canonical 한 집이 있다.

| 찾는 것                                               | 가는 곳                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| 명령 · 플래그 · 출력 형식 · 오류 코드 · 앱과 다른 점  | [사용자 문서](https://baram.ing/ko/docs/command-line/)      |
| 무엇이 머지됐고 다음 단계는 무엇인가 · 남은 수동 확인 | [추적 이슈](https://github.com/sayinel/baram/issues/847)    |
| 코드가 지키는 계약                                    | `src-tauri/src/cli/` 의 모듈 헤더와 함수 · 타입의 문서 주석 |
| 왜 이렇게 정했나                                      | [Decisions and history](CLI-Decisions-and-history)          |
