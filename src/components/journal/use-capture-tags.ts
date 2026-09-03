// §99 A Quick Capture 태그 칸 — 인덱스 스캔 + `#` 자동완성.
//
// 다이얼로그에서 떼어낸 이유는 길이 하나뿐이다: 태그 상태 6개와 핸들러 3개가
// 다이얼로그의 절반을 차지해, 저장 분기를 읽으려면 그것들을 먼저 넘겨야 했다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AddressableNote } from "./use-capture-targets";

import { getVaultTags } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { filterTags } from "../../utils/journal/journal-tags";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";

export interface CaptureTags {
  activeIndex: number;
  index: Map<string, number>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** `#` 없는 태그 목록 — fleeting note의 프론트매터와 태스크 줄이 함께 쓴다. */
  list: string[];
  onBlur: () => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (tag: string) => void;
  query: string;
  /**
   * §324-b 후속 제안 목록 — 노트 이름이 태그보다 먼저 온다. ‼️ 여기서 **한 번만**
   * 계산된다. `TagSuggest`는 이 배열을 받아 그리기만 한다 — 그렇지 않고 렌더링에서
   * 다시 `filterTags`를 부르면, 같은 입력에 대해 두 출처가 갈릴 수 있다(키보드가
   * 고르는 것과 화면에 보이는 것이 서로 다른 계산이 되는 것) — 이 브랜치가 반복해
   * 찾아온 결함 부류다.
   */
  suggestions: TagSuggestion[];
  value: string;
  visible: boolean;
}

export interface TagSuggestion {
  /** 태그면 그 태그를 쓴 파일 수, 노트면 그 노트의 캡처 수. */
  count: number;
  /** 이 이름의 노트가 있다 — 캡처가 그리로 간다. */
  isNote: boolean;
  name: string;
}

export function useCaptureTags(
  open: boolean,
  /** 주소 가능한 노트 — 제안 맨 위에 노트로 표시된다. 태스크 모드에서는 빈 Map. */
  addressableNames: Map<string, AddressableNote>,
): CaptureTags {
  const [index, setIndex] = useState<Map<string, number>>(() => new Map());
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<null | string>(null);
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 다이얼로그가 열릴 때마다 칸을 비우고 Zettel 공간을 다시 훑는다 — 캡처가
  // 그곳에 쌓이므로 제안의 출처도 그곳이다.
  useEffect(() => {
    if (!open) return;

    setValue("");
    setVisible(false);
    setQuery(null);
    setActiveIndex(0);

    (async () => {
      try {
        const { rootPath } = useFileStore.getState();
        const { zettelkastenDirectory } = useSettingsStore.getState();
        const scanDir = resolveZettelDir(rootPath, zettelkastenDirectory);
        if (!scanDir) return;

        const entries = await getVaultTags(scanDir);
        setIndex(new Map(entries.map((e) => [e.tag, e.count])));
      } catch (err) {
        logger.error("[QuickCapture] Tag index build failed:", err);
      }
    })();
  }, [open]);

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setValue(next);

      const cursor = e.target.selectionStart ?? next.length;
      const typed = currentTagQuery(next, cursor);
      if (typed !== null) {
        setQuery(typed);
        // ‼️ `query` state가 아직 갱신되지 않은 시점이라 아래 `suggestions` memo를
        // 못 쓴다 — 같은 순수 함수(`buildSuggestions`)를 직접 불러 이번 타이핑에
        // 대한 답을 즉시 얻는다. 다음 렌더에서 memo가 같은 함수로 같은 값에
        // 수렴하므로 두 출처가 갈리지 않는다.
        setVisible(buildSuggestions(typed, addressableNames, index).length > 0);
        setActiveIndex(0);
      } else {
        setVisible(false);
        setQuery(null);
      }
    },
    [addressableNames, index],
  );

  // 고른 태그로 커서 위치의 부분 `#prefix`를 갈아끼운다.
  const onSelect = useCallback(
    (tag: string) => {
      const input = inputRef.current;
      if (!input) return;

      const cursor = input.selectionStart ?? value.length;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);

      // ‼️ 하이픈이 태그 이름의 일부다 — Rust `is_tag_char`가 그렇게 판정한다
      // (`src-tauri/src/md/mod.rs:25-27`). 여기서 빼면 §320의 `#Baram-Dev-Note` 별칭이
      // 자동완성으로 닿지 않고, `onSelect`가 접두를 절반만 갈아끼워
      // `#Baram-#baram-dev-note`를 만든다. 문자 클래스 **끝**의 `-`는 리터럴이다.
      const prefix = before.match(/#[\w가-힣-]*$/);
      const newBefore = prefix
        ? before.slice(0, before.length - prefix[0].length) + `#${tag}`
        : before + `#${tag}`;

      setValue(
        (newBefore + (after.startsWith(" ") ? after : " " + after)).trimEnd() +
          " ",
      );
      setVisible(false);
      setQuery(null);
      setActiveIndex(0);

      setTimeout(() => {
        const pos = newBefore.length + 1;
        inputRef.current?.setSelectionRange(pos, pos);
        inputRef.current?.focus();
      }, 0);
    },
    [value],
  );

  // ‼️ ①: 여기서 한 번만 계산해 키보드 탐색과 `TagSuggest`의 렌더링이 **같은
  // 배열**을 본다. 각자 `filterTags`를 다시 부르면 지금은 순수 함수라 일치하지만,
  // 노트 이름이라는 두 번째 출처가 생긴 뒤로는 갈릴 수 있는 형태다 — 키보드가
  // 고르는 것과 화면에 보이는 것이 다른 계산이 되는 것.
  const suggestions = useMemo(
    () => buildSuggestions(query ?? "", addressableNames, index),
    [query, addressableNames, index],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!visible) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions[activeIndex]) {
          e.preventDefault();
          e.stopPropagation(); // 다이얼로그의 Enter 저장이 겹쳐 발화하지 않게
          onSelect(suggestions[activeIndex].name);
        }
      } else if (e.key === "Escape") {
        e.stopPropagation(); // 다이얼로그가 닫히지 않게
        setVisible(false);
      }
    },
    [visible, suggestions, activeIndex, onSelect],
  );

  const onBlur = useCallback(() => {
    // 제안의 onMouseDown이 먼저 발화하도록 숨김을 늦춘다.
    setTimeout(() => setVisible(false), 150);
  }, []);

  const list = useMemo(
    () =>
      value
        .split(/\s+/)
        .map((tag) => tag.replace(/^#/, "").trim())
        .filter(Boolean),
    [value],
  );

  return {
    activeIndex,
    index,
    inputRef,
    list,
    onBlur,
    onChange,
    onKeyDown,
    onSelect,
    query: query ?? "",
    suggestions,
    value,
    visible,
  };
}

/**
 * 제안 목록 — 노트 이름 맵과 태그 맵으로 `filterTags`를 각각 한 번씩 부른 뒤 이어
 * 붙이고, 소문자 키로 중복 제거한다(노트가 이긴다). `filterTags`의 시그니처는 바꾸지
 * 않는다 — `tag-suggest.ts`의 에디터 본문 자동완성이 같은 함수를 쓰는 완전히 다른
 * 표면이기 때문이다.
 *
 * ‼️ 평행한 두 맵으로 나누지 않는다. `noteCounts`는 이 함수 호출 동안만 존재하는
 * 파생값이고, 이름과 표시 케이스는 항상 `addressableNames` 하나에서만 읽는다.
 */
function buildSuggestions(
  query: string,
  addressableNames: Map<string, AddressableNote>,
  tagIndex: Map<string, number>,
): TagSuggestion[] {
  const noteCounts = new Map(
    [...addressableNames].map(([key, note]) => [key, note.captureCount]),
  );
  const noteMatches = filterTags(query, noteCounts);
  const tagMatches = filterTags(query, tagIndex);

  const seen = new Set<string>();
  const suggestions: TagSuggestion[] = [];

  for (const key of noteMatches) {
    if (seen.has(key)) continue;
    seen.add(key);
    const note = addressableNames.get(key);
    if (!note) continue;
    suggestions.push({
      count: note.captureCount,
      isNote: true,
      name: note.display,
    });
  }
  for (const tag of tagMatches) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    suggestions.push({
      count: tagIndex.get(tag) ?? 0,
      isNote: false,
      name: tag,
    });
  }

  return suggestions.slice(0, 10);
}

/** 커서 위치에서 입력 중인 `#tag` 접두를 뽑는다. */
function currentTagQuery(value: string, cursor: number): null | string {
  // ‼️ `-`가 없으면 `#Baram-`을 입력하는 중간에 쿼리가 끊겨 하이픈 뒤의 타이핑이
  // 자동완성 드롭다운에 반영되지 않는다 — `onSelect`의 같은 함정 참조.
  const match = value.slice(0, cursor).match(/#([\w가-힣-]*)$/);
  return match ? match[1] : null;
}
