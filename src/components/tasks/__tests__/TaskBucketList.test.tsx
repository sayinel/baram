import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskBucketList } from "../TaskBucketList";

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
        showOverdueAge={false}
        tasks={[task({ text: "회의 [[202607051530|팀 미팅]]" })]}
        titleFor={titleFor}
      />,
    );
    expect(screen.getByText("회의 팀 미팅")).toBeInTheDocument();
    expect(titleFor).not.toHaveBeenCalled();
  });

  it("falls back to titleFor when the wikilink has no alias", () => {
    render(
      <TaskBucketList
        bucket="today"
        label="Today"
        now={new Date()}
        onJump={noop}
        onToggle={noop}
        showOverdueAge={false}
        tasks={[task({ text: "회의 [[202607051530]]" })]}
        titleFor={() => "팀 미팅"}
      />,
    );
    expect(screen.getByText("회의 팀 미팅")).toBeInTheDocument();
  });
});
