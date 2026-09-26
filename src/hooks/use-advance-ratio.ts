// §365 다이얼 8 — 병합된 본문 서체의 한 글자 폭(em 비율)을 잰다. 서체 · 언어가 바뀌면 다시 잰다.

import { useEffect, useState } from "react";

import type { Locale } from "../i18n";

import { editorFontStack } from "../utils/editor/font-surfaces";
import {
  ADVANCE_SAMPLES,
  measureAdvanceRatio,
} from "../utils/font/char-advance";

/** 재는 중이거나 잴 수 없으면 `null`. `measure` 는 테스트가 주입한다. */
export function useAdvanceRatio(
  fontFamily: string,
  locale: Locale,
  measure: typeof measureAdvanceRatio = measureAdvanceRatio,
): null | number {
  const stack = editorFontStack(fontFamily);
  const sample = ADVANCE_SAMPLES[locale];
  const key = `${stack}\n${sample}`;
  const [result, setResult] = useState<null | {
    key: string;
    ratio: null | number;
  }>(null);
  useEffect(() => {
    let cancelled = false;
    void measure(stack, sample).then((ratio) => {
      if (!cancelled) setResult({ key, ratio });
    });
    return () => {
      cancelled = true;
    };
  }, [key, measure, sample, stack]);
  // 이전 서체의 결과를 새 서체의 답으로 쓰지 않는다 — 키가 다르면 아직 재는 중이다.
  return result?.key === key ? result.ratio : null;
}
