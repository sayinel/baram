// §298 Vim Phase 0a IME probe — event capture.
//
// Records key/composition/input events on BOTH capture and bubble phases, on
// both contentDOM and document, plus a MutationObserver on contentDOM.
//
// Why both targets: if `editable=false` drops contenteditable, contentDOM may
// stop being focusable and keystrokes land on document/body instead. Which
// element actually receives the key decides where Phase 0a must attach its
// listener, so it has to be measured rather than assumed.
//
// Why MutationObserver: comparing only the final document hides a composing
// character that was inserted and then removed.

import type { RecordedEvent, TargetLabel } from "./types";

const KEY_EVENTS = ["keydown", "keyup"] as const;
const COMPOSITION_EVENTS = [
  "compositionstart",
  "compositionupdate",
  "compositionend",
] as const;
const INPUT_EVENTS = ["beforeinput", "input"] as const;

export class EventRecorder {
  private contentDOM: HTMLElement | null = null;
  private disposers: (() => void)[] = [];
  private events: RecordedEvent[] = [];
  private mutationObserver: MutationObserver | null = null;
  private seq = 0;
  private t0 = 0;

  /** Attach all listeners. Call once per probe session. */
  arm(contentDOM: HTMLElement): void {
    this.stop();
    this.contentDOM = contentDOM;
    this.t0 = performance.now();

    // Labels are resolved per event by labelOf(), so only the targets matter.
    const targets: EventTarget[] = [contentDOM, document];

    for (const target of targets) {
      for (const phase of [true, false]) {
        for (const type of [
          ...KEY_EVENTS,
          ...COMPOSITION_EVENTS,
          ...INPUT_EVENTS,
        ]) {
          const handler = (e: Event) => this.record(e, phase);
          target.addEventListener(type, handler, phase);
          this.disposers.push(() =>
            target.removeEventListener(type, handler, phase),
          );
        }
      }
    }

    this.mutationObserver = new MutationObserver((records) => {
      for (const r of records) {
        this.push({
          type: "mutation",
          phase: "bubble",
          targetLabel: "contentDOM",
          mutation: summarizeMutation(r),
        });
      }
    });
    this.mutationObserver.observe(contentDOM, {
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  /** Drop recorded events but keep listeners armed (between steps). */
  reset(): void {
    this.events = [];
    this.seq = 0;
    this.t0 = performance.now();
    // Discard mutations already queued so they cannot leak into the next step.
    this.mutationObserver?.takeRecords();
  }

  snapshot(): RecordedEvent[] {
    return [...this.events];
  }

  stop(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.contentDOM = null;
  }

  private labelOf(target: EventTarget | null): TargetLabel {
    if (target === this.contentDOM) return "contentDOM";
    if (target === document) return "document";
    if (target === document.body) return "body";
    return "other";
  }

  private push(partial: Omit<RecordedEvent, "seq" | "t">): void {
    this.events.push({
      ...partial,
      seq: this.seq++,
      t: Math.round(performance.now() - this.t0),
    });
  }

  private record(e: Event, capture: boolean): void {
    const base = {
      type: e.type,
      phase: capture ? ("capture" as const) : ("bubble" as const),
      targetLabel: this.labelOf(e.target),
      defaultPrevented: e.defaultPrevented,
    };

    if (e instanceof KeyboardEvent) {
      this.push({
        ...base,
        code: e.code,
        isComposing: e.isComposing,
        key: e.key,
        keyCode: e.keyCode,
      });
      return;
    }
    if (e instanceof CompositionEvent) {
      this.push({ ...base, data: e.data });
      return;
    }
    if (typeof InputEvent !== "undefined" && e instanceof InputEvent) {
      this.push({
        ...base,
        cancelable: e.cancelable,
        data: e.data,
        inputType: e.inputType,
      });
      return;
    }
    this.push(base);
  }
}

function summarizeMutation(r: MutationRecord): string {
  if (r.type === "characterData") {
    return `characterData: ${JSON.stringify(r.oldValue)} → ${JSON.stringify(r.target.textContent)}`;
  }
  const added = [...r.addedNodes].map((n) => n.nodeName).join(",");
  const removed = [...r.removedNodes].map((n) => n.nodeName).join(",");
  return `childList: +[${added}] -[${removed}]`;
}
