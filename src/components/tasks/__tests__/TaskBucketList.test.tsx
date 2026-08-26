import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cssRules } from "../../../styles/__tests__/css-rules";
import { TaskBucketList } from "../TaskBucketList";

type Props = Parameters<typeof TaskBucketList>[0];

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "a.md",
    priority: 0,
    raw: "- [ ] 하나",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "하나",
    ...over,
  };
}

const noop = () => {};

describe("TaskBucketList", () => {
  it("renders nothing when the bucket is empty", () => {
    const { container } = render(
      <TaskBucketList
        bucket="today"
        label="Today"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[]}
        titleFor={(t) => t}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("collapses the Done bucket by default (I3)", () => {
    render(
      <TaskBucketList
        bucket="done"
        label="Done"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task({ state: "done" })]}
        titleFor={(t) => t}
      />,
    );
    const details = screen.getByText(/Done/).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("leaves non-Done buckets open by default (I3)", () => {
    render(
      <TaskBucketList
        bucket="overdue"
        label="Overdue"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task()]}
        titleFor={(t) => t}
      />,
    );
    const details = screen.getByText(/Overdue/).closest("details");
    expect(details).toHaveAttribute("open");
  });

  it("still shows the count in the (collapsible) summary line", () => {
    render(
      <TaskBucketList
        bucket="done"
        label="Done"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task({ state: "done" }), task({ state: "done", line: 1 })]}
        titleFor={(t) => t}
      />,
    );
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("prefers the user's [[id|alias]] display text over titleFor (小fix #4)", () => {
    const titleFor = vi.fn((t: string) => `Title of ${t}`);
    render(
      <TaskBucketList
        bucket="today"
        label="Today"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task({ text: "회의 [[202607051530|팀 미팅]]" })]}
        titleFor={titleFor}
      />,
    );
    expect(screen.getByText("회의 팀 미팅")).toBeInTheDocument();
    expect(titleFor).not.toHaveBeenCalled();
  });

  it("the shipped completed-row selector still matches when a priority marker sits in between (I1)", () => {
    // Not a computed-style assertion: jsdom does not apply tasks.css in this
    // render (TaskBucketList never imports it), and even where a stylesheet
    // is processed, jsdom's engine does not reliably resolve computed style
    // through sibling combinators. What jsdom's querySelector/matches DOES
    // implement correctly, independent of any stylesheet being loaded, is
    // CSS selector matching itself (nwsapi) — `+` vs `~` is exactly a
    // structural distinction. So this reads the actual selector text out of
    // the SHIPPED tasks.css (via the project's css-rules.ts convention,
    // rather than restating it here where it could drift) and asks jsdom to
    // match it against the real rendered DOM. With the old adjacent-sibling
    // `+` selector this returns null for a prioritised row (the priority
    // span breaks adjacency); with `~` it finds the text button.
    const rule = cssRules().find(
      (r) =>
        r.file.endsWith("tasks.css") &&
        r.selector.includes(".task-row-check:checked") &&
        r.selector.includes(".task-row-text"),
    );
    expect(rule).toBeDefined();

    const { container } = render(
      <TaskBucketList
        bucket="done"
        label="Done"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task({ priority: 2, state: "done", text: "urgent done" })]}
        titleFor={(t) => t}
      />,
    );
    const row = container.querySelector("li.task-row");
    expect(row).not.toBeNull();
    const matched = row!.querySelector(rule!.selector);
    expect(matched).not.toBeNull();
    expect(matched).toHaveTextContent("urgent done");
  });

  // §312 the stale badge is the whole reason Task 4 exists, and every other call
  // site here passes showAge={false} — deleting the badge block left the suite
  // green (review Major 4). These fail if it goes.
  describe("stale capture badge", () => {
    // Fixed so the threshold is arithmetic, not "whenever the suite runs".
    const now = new Date(2026, 7, 25); // 2026-08-25
    // ‼️ Local formatting, not toISOString(): the parser reads ➕ dates as local
    // dates, and in a UTC+ timezone toISOString() shifts them a day back — which
    // silently turned "29 days" into "30 days" here.
    const ago = (days: number) => {
      const d = new Date(2026, 7, 25 - days);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };

    function renderBucket(
      over: Partial<TaskEntry>,
      props: Partial<Props> = {},
    ) {
      return render(
        <TaskBucketList
          bucket="noDate"
          label="No date"
          now={now}
          onJump={noop}
          onToggle={noop}
          onTriage={noop}
          showAge
          showOverdueAge={false}
          tasks={[task(over)]}
          titleFor={(t) => t}
          {...props}
        />,
      );
    }

    it("badges a capture that has sat for 30 days", () => {
      const { container } = renderBucket({ created: ago(30) });
      const badge = container.querySelector(".task-row-stale");
      expect(badge).not.toBeNull();
      expect(badge).toHaveTextContent("30d");
    });

    it("does not badge one day short of the threshold", () => {
      const { container } = renderBucket({ created: ago(29) });
      expect(container.querySelector(".task-row-stale")).toBeNull();
    });

    it("does not badge a task with no creation date — ➕ is the only source", () => {
      const { container } = renderBucket({ created: null });
      expect(container.querySelector(".task-row-stale")).toBeNull();
    });

    it("stays off in buckets that do not ask for it — an overdue task is not stale", () => {
      // The overdue row still gets its own −Nd badge, so this discriminates the
      // showAge gate rather than "no badges rendered at all".
      const { container } = renderBucket(
        { created: ago(60), due: "2026-08-20" },
        { bucket: "overdue", showAge: false, showOverdueAge: true },
      );
      expect(container.querySelector(".task-row-stale")).toBeNull();
      expect(container.querySelector(".task-row-age")).toHaveTextContent("−5d");
    });
  });

  it("falls back to titleFor when the wikilink has no alias", () => {
    render(
      <TaskBucketList
        bucket="today"
        label="Today"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        onTriage={noop}
        showAge={false}
        showOverdueAge={false}
        tasks={[task({ text: "회의 [[202607051530]]" })]}
        titleFor={() => "팀 미팅"}
      />,
    );
    expect(screen.getByText("회의 팀 미팅")).toBeInTheDocument();
  });
});
