// §320 Quick Capture 대상 로딩 훅 — 다이얼로그가 열릴 때 `notes/`를 한 번 읽고,
// 태그가 바뀔 때마다 그 결과 위에서 대상을 다시 푼다.
//
// 미리보기(§324-c, Task 7)와 저장(§320, Task 5)이 **같은 값**을 써야 하므로 훅
// 하나로 묶는다. 각각 따로 계산하면 미리보기가 "영감노트에 갑니다"라고 말한 뒤
// 저장이 다른 곳에 붙이는 날이 온다 — `imagesToLinks`가 세는 것과 바꾸는 것을
// 같은 함수로 하는 이유와 같다(`QuickCaptureDialog.tsx:184-185`).

import { useEffect, useMemo, useState } from "react";

import type {
  CaptureTarget,
  NoteCandidate,
} from "../../utils/zettelkasten/capture-target";

import { listDir, readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";
import { countCaptures } from "../../utils/zettelkasten/capture-append";
import { resolveCaptureMatches } from "../../utils/zettelkasten/capture-target";
import { parseNoteTitle } from "../../utils/zettelkasten/parse-note-title";
import { parseFrontmatterAliases } from "../../utils/zettelkasten/zettel-note";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";

export interface AddressableNote {
  /** 이 노트의 `## Captures` 절 안 캡처 수(`countCaptures`). 새 노트는 0이다. */
  captureCount: number;
  /** 표시용 원본 케이스 — 매칭은 소문자 키로 한다. */
  display: string;
}

export interface CaptureTargets {
  /**
   * §324-b 후속 태그로 **닿을 수 있는** 노트 이름들 — 공백 없는 제목 + 별칭만.
   * 소문자 키 → 그 노트. 캡처 창의 태그 자동완성(`use-capture-tags.ts`)이 "제목의
   * 노트를 만들면 그 이름이 뜬다"를 위해 쓴다. `resolveCaptureMatches`가 매칭에 쓰는
   * 것과 같은 공백 규칙이라 — 여기 없는 이름은 애초에 태그로도 닿지 못한다.
   *
   * ‼️ 이름과 캡처 수를 **평행한 두 맵**으로 두지 않는다. 같은 키를 쓰는 두 맵은
   * 갈라지는 형태다 — 한쪽에만 이름을 더하거나 한쪽만 필터하면 제안에 **다른 노트의
   * 카운트**가 붙고, 두 조회가 모두 성공하므로 조용하다. 키 하나에 레코드 하나면
   * 자기 자신과 어긋날 수 없다.
   */
  addressableNames: Map<string, AddressableNote>;
  /**
   * 후보 목록을 **못 읽었다**. `targets`가 빈 것과는 다른 사실이다: 빈 배열은 "찾아봤고
   * 없다"이고, 이것은 "찾아보지 못했다"다. 둘을 같은 모양으로 다루면 IPC가 한 번 흔들린
   * 것 때문에 멀쩡한 태그가 `inbox/` 낙오로 이어지면서 문구가 사용자의 태그를 탓한다.
   *
   * 목록 자체를 못 읽은 **전면 실패**만 여기 해당한다. 노트 하나를 못 읽은 부분 실패는
   * 그대로 진행한다 — 그것까지 막으면 `notes/` 안의 파일 하나가 깨졌을 때 태그가 붙은
   * 모든 캡처가 멈춘다.
   */
  failed: boolean;
  /** 아직 노트를 읽는 중 — 미리보기가 아무 말도 하지 않아야 하는 상태 */
  loading: boolean;
  /** 현재 태그 목록이 지목하는 노트들. 빈 배열 = inbox 폴백 */
  targets: (CaptureTarget & { captureCount: number })[];
  /**
   * 어떤 노트도 지목하지 못한 태그들. §324-a: 태그 하나가 맞으면 나머지 오타가 성공에
   * 묻히므로, 미리보기와 토스트가 이것을 따로 말한다.
   *
   * ‼️ `loading`/`failed` 동안에는 후보가 비어 있어 **모든** 태그가 여기 담긴다. 소비자는
   * 그 두 상태를 먼저 걸러야 한다 — 미리보기와 저장 가드가 실제로 그렇게 한다.
   */
  unmatchedTags: string[];
}

/**
 * `notes/`(허브 후보) 아래를 열릴 때마다 한 번 읽는다. **주의**: `open`에만
 * 의존한다 — `tags`를 의존성에 넣으면 한 글자 칠 때마다 Zettel 공간 전체를
 * 다시 훑어 IPC 폭풍을 만든다(`use-capture-tags.ts:43-84`가 같은 형태의
 * 선례). 태그 목록은 아래 `useMemo`의 입력일 뿐이다.
 *
 * `SCAN_LIMIT` 같은 상한을 두지 않는다 — 태그가 주소인 설계에서 목록에서 빠진
 * 허브는 오타를 유발하고 `inbox/` 낙오로 이어진다(§324-b).
 *
 * ‼️ 닫혀 있는 동안은 아무것도 리셋하지 않는다 — `loading`/`targets`는 직전
 * 세션의 값을 그대로 들고 있다. 이것이 안전한 이유는 오직 소비자가
 * `QuickCaptureDialog.tsx:323`처럼 닫힌 동안 `null`을 반환하기 때문이다.
 * 만약 미래의 어떤 소비자가 닫히는 동안에도 계속 렌더한다면(예: 페이드아웃
 * 애니메이션) 이 가정이 깨져 직전 세션의 대상을 잠깐 보여주게 된다.
 */
export function useCaptureTargets(
  open: boolean,
  tags: string[],
): CaptureTargets {
  const [notes, setNotes] = useState<NoteCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // React's documented "adjust state while rendering" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // — this runs during render, **before paint**, unlike the effect below
  // which only runs after the commit. Without it, reopening the dialog after
  // a completed session (open: false → true) would paint one frame with the
  // *previous* session's `loading: false` and its resolved `targets` before
  // the effect's own `setLoading(true)` catches up on the next tick — Task
  // 7's preview would flash the wrong note name for that frame, which is
  // worse than showing nothing (§324-c exists precisely so a mistyped tag is
  // caught by eye; briefly asserting the *wrong* answer defeats that).
  //
  // Pinned by "reopening the dialog commits the reset state exactly once…"
  // in the test file, using `React.Profiler.onRender` rather than a counter
  // in the component body — a body-level counter also fires on React's
  // discarded pre-commit re-invoke of this very reset (the `setState` calls
  // below trigger exactly that), so it can't tell "one commit, already
  // correct" apart from "two commits, the first one stale" — the two shapes
  // this block exists to distinguish. `onRender` fires once per actual
  // commit, which is the distinction that matters.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setNotes([]);
      setLoading(true);
      setFailed(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { zettelkastenDirectory } = useSettingsStore.getState();
        const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
        if (!zettelDir) return;

        // ‼️ `[]`로 삼키지 않는다. 삼키면 실패가 "일치하는 노트 없음"과 **같은 모양**이
        // 되어, 호출부는 사용자의 태그를 탓하는 문구를 고른다. 실패는 실패로 올린다.
        const entries = await listDir(`${zettelDir}/notes`, true).catch(
          (err: unknown) => {
            logger.error("[QuickCapture] Target note listing failed:", err);
            if (!cancelled) setFailed(true);
            return null;
          },
        );
        if (entries === null) return;
        // ‼️ 취소된 스캔은 파일을 **읽지 않는다.** 아래 `Promise.all`은 후보 노트마다
        // `readFile` 하나씩을 띄우는 팬아웃이고, 취소 확인이 그 뒤에만 있으면 이미 버릴
        // 것이 확정된 스캔이 그 값을 전부 치른다. 태스크 모드로 열린 캡처가 정확히
        // 그렇다 — 목록 요청은 이미 출발한 뒤이고, 여기가 멈출 수 있는 첫 지점이다.
        if (cancelled) return;
        const mdFiles = entries.filter(
          (e) => !e.isDir && e.name.endsWith(".md"),
        );

        const loaded = await Promise.all(
          mdFiles.map(async (e): Promise<NoteCandidate | null> => {
            try {
              return {
                content: await readFile(e.path),
                filename: e.name,
                path: e.path,
              };
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setNotes(loaded.filter((n): n is NoteCandidate => n !== null));
        }
      } catch (err) {
        logger.error("[QuickCapture] Target note scan failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const { targets, unmatchedTags } = useMemo(() => {
    const matches = resolveCaptureMatches(tags, notes);
    return {
      targets: matches.targets.map((t) => ({
        ...t,
        captureCount: countCaptures(
          notes.find((n) => n.path === t.path)?.content ?? "",
        ),
      })),
      unmatchedTags: matches.unmatchedTags,
    };
  }, [tags, notes]);

  // §324-b 후속 태그 칸의 노트-이름 제안 출처. `tags`가 아니라 `notes`에만 의존한다 —
  // 이 목록은 "이 세션에 어떤 노트가 있는가"만 답하고, 지금 입력 중인 태그와는 무관하다.
  const addressableNames = useMemo(() => {
    const map = new Map<string, AddressableNote>();
    for (const note of notes) {
      const title = parseNoteTitle(note.filename, note.content);
      const aliases = parseFrontmatterAliases(note.content);
      const captureCount = countCaptures(note.content);
      // ‼️ 공백 있는 이름은 건너뛴다 — 태그는 공백을 담지 못하므로(`is_tag_char`,
      // `src-tauri/src/md/mod.rs:25`) 애초에 매칭될 수 없는 이름을 제안하지 않는다.
      // `resolveCaptureMatches`가 매칭에 쓰는 것과 같은 규칙이다.
      for (const name of [title, ...aliases]) {
        if (!name || /\s/.test(name)) continue;
        const key = name.toLowerCase();
        // 먼저 온 이름이 이긴다 — 제목이 별칭보다 먼저이므로 같은 노트 안에서는
        // 제목이, 노트 사이에서는 먼저 읽힌 노트가 우선한다.
        if (!map.has(key)) map.set(key, { captureCount, display: name });
      }
    }
    return map;
  }, [notes]);

  return { addressableNames, failed, loading, targets, unmatchedTags };
}
