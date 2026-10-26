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
`FILE_NOT_FOUND`, 있는데 닿지 못한 것은 `IO` 와 OS 의 사유다. 셋째 갈래로, 시스템이 적힌 대로 받지 못하는
경로(NUL 이 든 경로, 너무 긴 이름이나 경로)는 `INVALID_ARGUMENT` 다 — 고칠 것은 디스크가 아니라 인자다
(`paths::refused_as_written`). 아직 없는 노트를 받는 `backlinks` 도 이 판정을 불러, 그런 경로를 빈 답 대신
오류로 끝낸다.

권한 없는 파일을 "없다" 고 하면 사용자는 파일이 지워졌다고 믿는다. 경로 인자의 판정은
`paths::file_arg` · `paths::folder_arg` 에 모여 있다.

## vault 경계가 지키는 것

**`PATH_OUTSIDE_VAULT` 가 무엇을 지키는지는 호출자가 정한다.** CLI 에서는 보안 경계가 아니라 에이전트가
범위를 벗어나지 않게 하는 규칙이다 — 호출자의 셸은 그 파일을 어차피 읽을 수 있다. 왜 승인 저장소와
대조하지 않는지는 [Decisions and history](CLI-Decisions-and-history) 의 승인 저장소 결정이 답한다.

`baram mcp` 에서는 도구의 파일 경계다. 호출자는 셸이 없는 모델이고, 그 인자는 모델이 읽은 노트 본문이
움직일 수 있다. 도구가 받는 노트 · 폴더 경로는 모두 `paths::locate` 를 지난다 — `backlinks` 는 직접,
나머지는 `paths::note_names_first` · `paths::folder_arg` 를 거쳐서. 그래서 이 셋이 도구와 vault 밖의 파일
사이에 선 판정이다.

도구의 `vault` 경로와 절대 경로 인자는 디스크에 묻기 전에 글자로 맞춘다 — vault 루트의 표기(정규 경로 ·
앱이 등록한 경로 · 그 vault 를 경로로 부른 `--vault`) 가운데 하나여야 하고(절대 경로 인자는 그 표기로 시작해야 하고),
맞지 않으면 디스크에 묻지 않고 밖이라고 답한다. 먼저 디스크에 물으면 vault 로 풀리는 링크가 있는지가 답에
드러난다. CLI 의 `Vault` 는 표기를 갖지 않는다 — 디스크에서 푼 뒤 루트 안인지만 본다.

`note_names_first` 는 CLI 의 `note_arg` 와 규칙이 같고 순서가 다르다 — 노트 규칙(이름 · 걷기가 가지 않는
자리)을 파일이 있는지 묻기 전에 묻는다. 그래서 노트를 읽는 도구는 그 규칙이 거절하는 경로에 파일이 있든
없든 같은 답을 준다. CLI 는 있는지를 먼저 묻는다 — 없는 `notes.txt` 는 `FILE_NOT_FOUND` 다.

규칙은 `locate` 가 푼 경로에 묻는다 — 대소문자를 접는 볼륨에서 `X.MD` 는 `x.md` 가 있으면 그 노트로
읽힌다. 푼 경로의 글자가 적힌 글자와 다르고(대소문자 · 링크) 규칙이 푼 경로를 거절하면, 적힌 글자에 아무것도
없을 때의 답을 낸다 — 적힌 글자도 규칙에 걸리면 그 거절, 아니면 `FILE_NOT_FOUND` 다. 그래서 `b.MD` 옆의
`b.md`, `node_modules/` 폴더 옆의 `NODE_MODULES/m.md`, `.env` 를 가리키는 `link.md` 는 그 파일이 없는
vault 에서와 같은 답을 받는다. 있는 것에 따라 답이 갈리는 길은 남아 있다 — vault 밖으로 나가는 링크
(`PATH_OUTSIDE_VAULT`), 들어갈 수 없는 폴더(`IO`)가 그렇다.

## 두 번 밟지 말 것

1. **`Path::exists` · `is_file` · `is_dir` 은 메타데이터를 읽지 못하면 거짓이다.** 그 결과로 거르면
   권한 없는 파일이 `FILE_NOT_FOUND` 가 된다. v1 의 계획 코드에 이 결함이 세 번(`read` · `--folder` ·
   `tasks --file`) 있었다. `std::fs::metadata` 의 결과를 직접 가르는 판정이 `paths` 에 있으니, 새 경로
   인자는 그 판정을 지나게 할 것.
2. **`search --folder` 를 기존 글로브 필터로 만들지 말 것.** 그 폴더 접두사는 문자열 접두사라 `docs`
   가 `docs-old/` 까지 먹고, 상한이 걷기 중에 먼저 차서 결과를 나중에 걸러도 늦다. 검색 루트 자체를
   그 폴더로 옮긴다.
