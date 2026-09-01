// §89 Home screen surface — lazy-loaded HomeScreen wrapped in the
// editor-area-scroll container the other surface branches share.
import { lazy, Suspense } from "react";

import { createVaultFromDialog } from "../../services/vault-create";

const HomeScreen = lazy(() =>
  import("./HomeScreen").then((m) => ({ default: m.HomeScreen })),
);

interface HomeSurfaceProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecentFile: (path: string) => void;
  onOpenRecentFolder: (path: string) => void;
}

export function HomeSurface({
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenRecentFile,
  onOpenRecentFolder,
}: HomeSurfaceProps) {
  return (
    <div className="editor-area-scroll" data-editor-scroll>
      <Suspense fallback={null}>
        <HomeScreen
          onNewFile={onNewFile}
          onNewVault={createVaultFromDialog}
          onOpenFile={onOpenFile}
          onOpenFolder={onOpenFolder}
          onOpenRecentFile={onOpenRecentFile}
          onOpenRecentFolder={onOpenRecentFolder}
        />
      </Suspense>
    </div>
  );
}
