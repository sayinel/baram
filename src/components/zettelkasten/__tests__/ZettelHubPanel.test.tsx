import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/tag", () => ({
  getFilesByTag: vi.fn().mockResolvedValue([]),
}));
vi.mock("../use-zettel-hub-data", () => ({
  useZettelHubData: vi.fn(),
}));
vi.mock("../../../services/journal-file-service", () => ({
  openFileInTab: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../services/zettelkasten-service", () => ({
  promoteFleeting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../utils/confirm-dialog", () => ({
  showConfirm: vi.fn().mockResolvedValue(true),
}));

import { deleteFile, readFile } from "../../../ipc/invoke";
import { openFileInTab } from "../../../services/journal-file-service";
import { promoteFleeting } from "../../../services/zettelkasten-service";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { showConfirm } from "../../../utils/confirm-dialog";
import { useZettelHubData } from "../use-zettel-hub-data";
import { ZettelHubPanel } from "../ZettelHubPanel";

const mockedUseZettelHubData = vi.mocked(useZettelHubData);

const noop = () => Promise.resolve(undefined);

describe("ZettelHubPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
    useUIStore.getState().closeZettelTitleDialog();
    mockedUseZettelHubData.mockReturnValue({
      inbox: [],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });
  });

  it("renders the Actions bar (New / Capture / MOC)", () => {
    render(<ZettelHubPanel />);

    expect(
      screen.getByRole("button", { name: /new zettel/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /quick capture/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new moc/i }),
    ).toBeInTheDocument();
  });

  it("renders the INBOX count badge and each inbox row", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: ["idea"],
          title: "First idea",
        },
        {
          id: "2",
          path: "/vault/zettel/inbox/2.md",
          tags: [],
          title: "Meeting notes",
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);

    expect(screen.getByText("INBOX (2)")).toBeInTheDocument();
    expect(screen.getByText("First idea")).toBeInTheDocument();
    expect(screen.getByText("Meeting notes")).toBeInTheDocument();
    expect(screen.getByText("#idea")).toBeInTheDocument();
  });

  it("opens an inbox note when its row is clicked", async () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: "First idea",
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });
    vi.mocked(readFile).mockResolvedValue("note body");

    render(<ZettelHubPanel />);
    fireEvent.click(screen.getByText("First idea"));

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith("/vault/zettel/inbox/1.md");
      expect(openFileInTab).toHaveBeenCalledWith(
        "/vault/zettel/inbox/1.md",
        "note body",
      );
    });
  });

  it("shows the capture hint when the inbox is empty", () => {
    render(<ZettelHubPanel />);

    expect(screen.getByText(/inbox is empty/i)).toBeInTheDocument();
  });

  it("suppresses empty-state hints while the initial load is pending", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [],
      mocs: [],
      recent: [],
      loading: true,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);

    expect(screen.queryByText(/inbox is empty/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no mocs yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no notes yet/i)).not.toBeInTheDocument();
  });

  it("renders live items during a refresh (loading=true) without gating on loading", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: "First idea",
        },
      ],
      mocs: [],
      recent: [],
      loading: true,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);

    expect(screen.getByText("First idea")).toBeInTheDocument();
    expect(screen.queryByText(/inbox is empty/i)).not.toBeInTheDocument();
  });

  it("shows empty-state hints once loading resolves with empty data", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);

    expect(screen.getByText(/inbox is empty/i)).toBeInTheDocument();
    expect(screen.getByText(/no mocs yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument();
  });

  it("renders a MOC row and a Recent row", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [],
      mocs: [{ path: "/vault/zettel/notes/10.md", title: "Knowledge Map" }],
      recent: [{ path: "/vault/zettel/notes/11.md", title: "Atomicity" }],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);

    expect(screen.getByText("Knowledge Map")).toBeInTheDocument();
    expect(screen.getByText("Atomicity")).toBeInTheDocument();
  });

  it("opens a MOC note and a Recent note when their rows are clicked", async () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [],
      mocs: [{ path: "/vault/zettel/notes/10.md", title: "Knowledge Map" }],
      recent: [{ path: "/vault/zettel/notes/11.md", title: "Atomicity" }],
      loading: false,
      refresh: vi.fn(noop),
    });
    vi.mocked(readFile).mockResolvedValue("note body");

    render(<ZettelHubPanel />);
    fireEvent.click(screen.getByText("Knowledge Map"));
    fireEvent.click(screen.getByText("Atomicity"));

    await waitFor(() => {
      expect(openFileInTab).toHaveBeenCalledWith(
        "/vault/zettel/notes/10.md",
        "note body",
      );
      expect(openFileInTab).toHaveBeenCalledWith(
        "/vault/zettel/notes/11.md",
        "note body",
      );
    });
  });

  it("truncates a long inbox title to exactly 80 chars for the promote dialog", () => {
    const longTitle = "a".repeat(85);
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: longTitle,
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: `Promote "${longTitle}"` }),
    );

    const dialog = useUIStore.getState().zettelTitleDialog;
    expect(dialog.initialTitle).toBe(longTitle.slice(0, 80));
    expect(dialog.initialTitle).toHaveLength(80);
  });

  it("shows the not-configured hint (and no sections) when the space is disabled", () => {
    useSettingsStore.getState().setZettelkastenEnabled(false);

    render(<ZettelHubPanel />);

    expect(screen.getByText(/set up/i)).toBeInTheDocument();
    expect(screen.queryByText(/INBOX/)).not.toBeInTheDocument();
    expect(screen.queryByText("MOCs")).not.toBeInTheDocument();
  });

  it("opens the Settings modal from the not-configured hint", () => {
    useSettingsStore.getState().setZettelkastenEnabled(false);

    render(<ZettelHubPanel />);
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));

    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("opens the Promote dialog prefilled with the inbox item's title", () => {
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: "First idea",
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: /promote "first idea"/i }),
    );

    const dialog = useUIStore.getState().zettelTitleDialog;
    expect(dialog.open).toBe(true);
    expect(dialog.title).toBe("Promote to Permanent Note");
    expect(dialog.confirmLabel).toBe("Promote");
    expect(dialog.initialTitle).toBe("First idea");

    dialog.onSubmit?.("First Idea (edited)");
    expect(promoteFleeting).toHaveBeenCalledWith(
      "/vault/zettel",
      "/vault/zettel/inbox/1.md",
      "First Idea (edited)",
    );
  });

  it("deletes an inbox note after confirming", async () => {
    const refresh = vi.fn(noop);
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: "First idea",
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh,
    });
    const removeByPath = vi.spyOn(
      useZettelIndexStore.getState(),
      "removeByPath",
    );

    render(<ZettelHubPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: /delete "first idea"/i }),
    );

    await waitFor(() => {
      expect(showConfirm).toHaveBeenCalled();
      expect(deleteFile).toHaveBeenCalledWith("/vault/zettel/inbox/1.md");
      expect(removeByPath).toHaveBeenCalledWith("/vault/zettel/inbox/1.md");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    mockedUseZettelHubData.mockReturnValue({
      inbox: [
        {
          id: "1",
          path: "/vault/zettel/inbox/1.md",
          tags: [],
          title: "First idea",
        },
      ],
      mocs: [],
      recent: [],
      loading: false,
      refresh: vi.fn(noop),
    });

    render(<ZettelHubPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: /delete "first idea"/i }),
    );

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
