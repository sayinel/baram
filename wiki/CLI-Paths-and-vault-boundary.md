# CLI Paths and vault boundary

노트 · 폴더 경로 인자를 vault 안의 경로로 바꾸는 규칙과, 결과에 경로를 쓰는 규칙이다. 이 층이
흐름의 어디에 서는지는 [Architecture](CLI-Architecture), 개요는 [Overview](CLI-Overview) 에 있다.
쓰는 쪽에서 본 규칙과 예는 [사용자 문서](https://baram.ing/ko/docs/command-line/) 의 "경로와 줄 번호" 가
canonical 이다.

## 상대 경로와 출력 경로

**상대 경로는 vault 루트 기준이고, 출력은 `/` 로 쓴다** — 노트 · 폴더 경로 인자의 상대 경로와,
결과 행이 vault 안의 파일을 가리키는 경로. 인자로는 vault 안의 절대 경로도 받는다.

한 명령의 출력을 다음 명령의 인자로 그대로 넣을 수 있다. vault 자신의 경로(봉투의 `vault.path`,
`vaults` 의 행)는 절대 경로다.

## 걷기가 가지 않는 자리

**걷기가 가지 않는 자리를 받지 않는 인자가 있다** — `--folder` 는 앱의 vault 걷기가 건너뛰는 폴더를,
`tasks --file` · `links` 는 걷기가 목록에 올리지 않는 파일(마크다운이 아닌 파일 · 숨김 파일 · 건너뛰는
폴더 안의 파일)을 거절한다.

받으면 그 답은 앱이 보여 주지 않는 것을 보여 주게 된다. 이 규칙이 걸리지 않는 명령도 있다 — `read` 는 vault
안의 파일이면 받고, `backlinks` 는 아직 없는 노트와 첨부를 받으며, `search` 는 앱의 검색 함수를 그대로
써서 일반 폴더 안의 숨김 파일도 읽는다.

## 없음과 닿지 못함

**경로 인자는 없음과 닿지 못함을 가른다** — `read` · `links` · `tasks --file` · `--folder` 에서 없는 것은
`FILE_NOT_FOUND`, 있는데 닿지 못한 것은 `IO` 와 OS 의 사유다.

권한 없는 파일을 "없다" 고 하면 사용자는 파일이 지워졌다고 믿는다. 경로 인자의 판정은
`paths::file_arg` · `paths::folder_arg` 에 모여 있다.

## vault 경계는 범위 규칙이다

`PATH_OUTSIDE_VAULT` 는 보안 경계가 아니라 에이전트가 범위를 벗어나지 않게 하는 규칙이다 — 왜인지는
[Decisions and history](CLI-Decisions-and-history) 의 승인 저장소 결정이 답한다.

## 두 번 밟지 말 것

1. **`Path::exists` · `is_file` · `is_dir` 은 메타데이터를 읽지 못하면 거짓이다.** 그 결과로 거르면
   권한 없는 파일이 `FILE_NOT_FOUND` 가 된다. v1 의 계획 코드에 이 결함이 세 번(`read` · `--folder` ·
   `tasks --file`) 있었다. `std::fs::metadata` 의 결과를 직접 가르는 판정이 `paths` 에 있으니, 새 경로
   인자는 그 판정을 지나게 할 것.
2. **`search --folder` 를 기존 글로브 필터로 만들지 말 것.** 그 폴더 접두사는 문자열 접두사라 `docs`
   가 `docs-old/` 까지 먹고, 상한이 걷기 중에 먼저 차서 결과를 나중에 걸러도 늦다. 검색 루트 자체를
   그 폴더로 옮긴다.
