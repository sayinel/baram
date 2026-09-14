// issue 549 — the `dangerouslySetInnerHTML` value for a diagram view.
//
// React 19 (19.2.8) takes the generic host-property path for a <div>,
// compares each prop value by identity, and for dangerouslySetInnerHTML then
// assigns `innerHTML` without looking at `__html` (react-dom-client
// updateProperties → setProp). An inline `{{ __html: s }}` literal is a new
// object every render, so the svg was re-parsed and its DOM re-created on
// every re-render of the view — the block menu opening, a caption edit, every
// mousemove of a resize drag — while `s` had not changed. (Not the hover
// toolbar: its reveal is pure CSS. A selection that ENTERS editing remounts
// the diagram anyway; a keyboard traversal under modal vim keeps the preview,
// and that re-render is one of them.) Handing React the same object while the
// string holds is what stops that.
//
// Call it AT the injection sink — in the component whose JSX carries the
// attribute — and pass strings between components, never the wrapper: a
// wrapper crossing a component boundary can be spread or copied into a fresh
// object on the way, which silently restores the per-render re-seed. The
// source scan (diagram-inner-html-source.test.ts) holds every node view to
// that: the attribute's value must be a const bound to this hook in the same
// function.
//
// ‼️ React 19.3 STOPPED doing that. Measured with the same probe on both
// versions (an inline `{{ __html: s }}` literal, i.e. a new object every
// render, and a DOM mutation made between renders):
//   - 19.2.8: the mutation is WIPED — React re-assigned innerHTML
//   - 19.3.0: the mutation SURVIVES — React compares the `__html` STRING now
// So on 19.3 this memo no longer decides the outcome: mutating the hook away
// at a call site leaves `diagram-inner-html-stable.test.tsx` green (measured;
// the same mutation fails 3 of its cases on 19.2.8). The hook stays because
// the behaviour it guards is React's private detail, not a documented API —
// but the live structural guard is the source scan
// (`diagram-inner-html-source.test.ts`), not the stability test.
//
// html-block-view.tsx does NOT use this. It used to rely on the per-render
// re-seed; on 19.3 it resets its injected DOM deliberately with
// `key={baseDir}` instead (see the comment there).
import { useMemo } from "react";

export interface InnerHtml {
  readonly __html: string;
}

/** Keeps the wrapper's identity stable while `html` is unchanged; a changed
 *  string produces a new wrapper. React may discard this cache under memory
 *  pressure, which re-seeds the element once — acceptable, not a correctness
 *  concern. */
export function useInnerHtml(html: string): InnerHtml {
  return useMemo(() => ({ __html: html }), [html]);
}
