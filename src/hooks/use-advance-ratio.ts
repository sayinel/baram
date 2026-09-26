// §365 다이얼 8 — 병합된 본문 서체의 한 글자 폭(em 비율)을 잰다. 서체 · 언어가 바뀌면 다시 재고,
// 문서의 서체 집합(`document.fonts`)에서 서체 로드가 시작되면(`loading`) 그 로드가 끝난 뒤 같은
// 서체를 다시 잰다.
//
// 두 번째 신호가 필요한 이유: `measureAdvanceRatio` 는 `document.fonts.load` 뒤에 재는데, 그때 스택의
// 첫 패밀리를 선언한 `@font-face` 가 아직 문서에 없으면 `load` 는 면 없이 끝나고 canvas 는 대체 서체를
// 잰다. 서체 문자열은 그대로이므로 첫 신호로는 다시 잴 일이 없다. 그런 때가 둘이다 — 자기
// `@font-face` 를 싣는 테마가 이 행이 떠 있는 동안 유효해질 때(자식인 이 훅의 이펙트가 테마 `<style>`
// 을 붙이는 앱 이펙트보다 먼저 돈다)와, 시작 직후 설치 테마의 CSS 가 캐시에 들어오기 전. 테마 CSS 를
// 키에 넣는 것으로는 안 된다 — 그 값은 테마와 같은 커밋에 바뀌고, 그 커밋에서도 이 이펙트가
// `<style>` 을 붙이기 전에 돈다.
//
// 왜 `loadingdone` 이 아니라 `loading` → 그 순간의 `ready` 인가 — macOS 26.6.2(25G83) 시스템 WebKit
// 의 `WKWebView` 실측(2026-09-26, Swift 스크립트로 앱처럼 `<style>` 을 나중에 붙임, data URI ·
// 파일 URL · `FontFace` API 네 경우): 면은 `loaded` 가 되지만 `loadingdone` 은 한 번도 오지 않았다.
// `loading` 은 오고, 그 핸들러에서 읽은 `ready` 는 면이 로드된 뒤 풀리며, 그때 재면 로드된 서체의
// 폭이 나온다. WebView2(Windows) · WebKitGTK(Linux)는 재지 않았다.
//
// 자기 자신을 깨우는 고리는 한 바퀴로 끝난다: 같은 실측에서 아무것도 그리지 않은 data URI 면에 이
// 측정의 `load` 가 로드를 시작하자 `loading` 이 한 번 왔다 — 그래서 한 번 더 잰다. 그 재측정의 `load`
// 는 이미 `loaded` 인 면을 만나 `loading` 을 내지 않았다.
//
// 남는 구멍: 면이 문서에 들어온 뒤 그 면을 아무것도 그리지 않으면 `loading` 이 오지 않아, 서체 · 언어가
// 바뀔 때까지 대체 서체의 비율이 남는다. 로드를 시작하는 다른 길인 `document.fonts.load` 는 앱에서 이
// 측정(`char-advance.ts`)만 부르고(2026-09-26 `src` grep, 테스트 밖), 그 측정은 서체 · 언어가 바뀌거나
// `loading` 이 와야 돈다.

import { useEffect, useState } from "react";

import type { Locale } from "../i18n";

import { editorFontStack } from "../utils/editor/font-surfaces";
import {
  ADVANCE_SAMPLES,
  measureAdvanceRatio,
} from "../utils/font/char-advance";

/** 다시 잴 신호를 내는 곳 — `document.fonts`(`FontFaceSet`)에서 `loading` 과 `ready` 만 쓴다. */
interface FontLoadSignal extends EventTarget {
  readonly ready: Promise<unknown>;
}

/**
 * 재는 중이거나 잴 수 없으면 `null`. `measure` 와 `fontSet` 은 테스트가 주입한다. `fontSet` 이
 * `null` 이면(`document.fonts` 가 없는 jsdom) 서체 · 언어가 바뀔 때만 잰다.
 */
export function useAdvanceRatio(
  fontFamily: string,
  locale: Locale,
  measure: typeof measureAdvanceRatio = measureAdvanceRatio,
  fontSet: FontLoadSignal | null = documentFontSet(),
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
    // 같은 키의 측정이 겹치면 가장 나중에 시작한 것만 착지한다 — 먼저 시작해 대체 서체를 잰 측정이
    // 늦게 끝나 다시 잰 값을 덮지 않게.
    let latest = 0;
    const run = () => {
      const ticket = ++latest;
      void measure(stack, sample).then((ratio) => {
        if (!cancelled && ticket === latest) setResult({ key, ratio });
      });
    };
    run();
    // `ready` 는 로드가 시작될 때 새 약속으로 바뀐다 — 등록할 때가 아니라 이벤트 때 읽는다.
    const onLoading = () => {
      void fontSet?.ready.then(() => {
        if (!cancelled) run();
      });
    };
    fontSet?.addEventListener("loading", onLoading);
    return () => {
      cancelled = true;
      fontSet?.removeEventListener("loading", onLoading);
    };
  }, [fontSet, key, measure, sample, stack]);
  // 이전 서체의 결과를 새 서체의 답으로 쓰지 않는다 — 키가 다르면 아직 재는 중이다.
  return result?.key === key ? result.ratio : null;
}

/** 문서의 서체 집합. jsdom 에는 없다(2026-09-26 실측: `"fonts" in document` 가 false). */
function documentFontSet(): FontLoadSignal | null {
  return "fonts" in document ? document.fonts : null;
}
