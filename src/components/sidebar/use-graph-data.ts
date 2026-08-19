// §30 Graph View — link-graph data fetching + cytoscape element population
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type { LinkGraph } from "../../ipc/types";
import type { GraphScope } from "../../stores/ui/graph-settings";
import type { GraphSimulation } from "./graph-simulation";
import type { GraphViewport } from "./graph-viewport";
import type { Core, ElementDefinition, EventObject } from "cytoscape";

import { getLinkIndex, refreshIndex } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useGraphSettingsStore } from "../../stores/ui/graph-settings";
import { logger } from "../../utils/logger";
import {
  assignNamespaceColors,
  mergeGraphs,
  nodeSize,
  toGraphElements,
} from "./graph-utils";
import {
  boxOf,
  isUsableViewport,
  shouldRunViewportWork,
} from "./graph-viewport";

/**
 * Fetch the link graph (single- or multi-vault §87), transform it into
 * cytoscape elements, and populate the instance. Re-runs on index refresh.
 * Positions are seeded from the simulation so refreshes don't jump.
 */
export function useGraphData(params: {
  /** §286 그래프가 보이는가 — 숨은 동안에는 뷰포트를 재지 않는다(graph-viewport.ts). */
  active: boolean;
  cyReady: boolean;
  cyRef: RefObject<Core | null>;
  graphScope: GraphScope;
  handleNodeTap: (evt: EventObject) => void;
  simRef: RefObject<GraphSimulation | null>;
}): { edgeCount: number; graphEpoch: number; nodeCount: number } {
  const { active, cyReady, cyRef, graphScope, handleNodeTap, simRef } = params;
  const rootPath = useFileStore((s) => s.rootPath);
  const indexVersion = useLinkStore((s) => s.indexVersion);
  const contexts = useContextStore((s) => s.contexts);
  const settingsNodeSize = useGraphSettingsStore((s) => s.nodeSize);
  const colorByNamespace = useGraphSettingsStore((s) => s.colorByNamespace);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  // Monotonic populate counter. Counts alone can stay identical across a
  // refresh while element identity / bypass styles changed — downstream
  // filters key on this so they re-apply after EVERY re-population.
  const [graphEpoch, setGraphEpoch] = useState(0);

  useEffect(() => {
    if (!rootPath) return;
    const cy = cyRef.current;
    if (!cy) return;

    let cancelled = false;

    (async () => {
      try {
        let graph: LinkGraph;
        let effectiveRootPath = rootPath;
        let nodeVaultMapRef: Map<string, string> | undefined;

        // §87 Read contexts fresh from store (not closure) to avoid stale data
        const freshContexts = useContextStore.getState().contexts;
        if (graphScope === "all" && freshContexts.length > 1) {
          // §87 Multi-vault: fetch and merge graphs from all contexts
          const vaultFolderContexts = freshContexts.filter(
            (c) => c.contextType !== "file",
          );
          const graphs: Array<{
            ctx: (typeof vaultFolderContexts)[0];
            graph: LinkGraph;
          }> = [];

          // §87 Fetch existing indices for each vault. Don't call refreshIndex
          // here — it changes indexVersion which re-triggers this effect and
          // cancels before completion. Indices are built when vaults are opened.
          for (const ctx of vaultFolderContexts) {
            try {
              const g = await getLinkIndex(ctx.path);
              if (g.nodes.length > 0) {
                graphs.push({ ctx, graph: g });
              }
            } catch {
              // Skip contexts that fail
            }
          }

          // Merge all graphs into one, tracking node→vault membership
          const merged = mergeGraphs(graphs.map((g) => g.graph));
          graph = merged;
          // §87 Build nodeVaultMap for cross-vault edge detection
          nodeVaultMapRef = new Map<string, string>();
          for (const { ctx, graph: g } of graphs) {
            for (const node of g.nodes) {
              if (!nodeVaultMapRef.has(node)) {
                nodeVaultMapRef.set(node, ctx.id);
              }
            }
          }
          // Use empty string as rootPath so namespace extraction works per-node
          effectiveRootPath = "";
        } else {
          // Single-vault: existing behavior
          await refreshIndex(rootPath);
          if (cancelled) return;
          graph = await getLinkIndex();
          if (cancelled) return;
          nodeVaultMapRef = undefined;
        }

        const { nodes, edges } = toGraphElements(
          graph,
          effectiveRootPath || rootPath,
          nodeVaultMapRef,
        );
        const maxNodeSize = Math.min(settingsNodeSize * 3, 80);

        const nodesWithSize = nodes.map((n) => {
          // §87 In All mode, assign vault color to each node
          let vaultColor: string | undefined;
          if (nodeVaultMapRef) {
            const ctxId = nodeVaultMapRef.get(n.data.id);
            if (ctxId) {
              const ctx = useContextStore
                .getState()
                .contexts.find((c) => c.id === ctxId);
              if (ctx) vaultColor = ctx.color;
            }
          }
          return {
            ...n,
            data: {
              ...n.data,
              size: nodeSize(n.data.degree, settingsNodeSize, maxNodeSize),
              ...(vaultColor && { vaultColor }),
            },
          };
        });

        // §61 Namespace colors
        if (colorByNamespace) {
          const namespaces = nodesWithSize
            .filter((n) => !n.data.isTag)
            .map((n) => n.data.namespace ?? "");
          const nsColorMap = assignNamespaceColors(namespaces);
          for (const n of nodesWithSize) {
            if (!n.data.isTag && !n.data.isGhost) {
              (n.data as Record<string, unknown>).nsColor =
                nsColorMap.get(n.data.namespace ?? "") ?? "";
            }
          }
        }

        // §30.2 Seed added elements with their last known simulation positions
        // so index refreshes don't flash at the origin.
        const posMap = simRef.current?.getPositions();
        cy.elements().remove();
        cy.add([
          ...nodesWithSize.map((n) => {
            const prev = posMap?.get(n.data.id);
            return prev ? { ...n, position: { ...prev } } : n;
          }),
          ...edges,
        ] as ElementDefinition[]);

        // Mark orphan nodes
        cy.nodes().forEach((node) => {
          if (node.degree() === 0) {
            node.addClass("orphan");
          }
        });

        // §30.3c Restore pinned indicators after element re-creation
        simRef.current?.getPinnedIds().forEach((id) => {
          const el = cy.getElementById(id);
          if (el.length > 0) el.addClass("pinned");
        });

        // Ensure container dimensions are available before first paint.
        //
        // ‼️ 숨은 동안에는 재지 않는다 — `display: none`이면 0×0이 나와 뷰포트가
        // degenerate해진다. 다시 보이게 될 때 아래 별도 effect가 잰다.
        // Ensure container dimensions are available before first paint.
        //
        // ‼️ 숨은 동안에는 재지 않는다 — `display: none`이면 0×0이 나와 뷰포트가
        // degenerate해진다. 그때는 아래 별도 effect가 다시 보이는 순간 잰다.
        if (shouldRunViewportWork(active, boxOf(cy.container()))) {
          cy.resize();
        }
        // §87 Force style recalculation for newly added nodes
        // (without this, nodes from non-active vaults may not render)
        cy.style().update();

        setNodeCount(nodes.length);
        setEdgeCount(edges.length);
        setGraphEpoch((v) => v + 1);

        // Bind click handler
        cy.off("tap", "node");
        cy.on("tap", "node", handleNodeTap);
      } catch (err) {
        logger.error("§30 GraphView: failed to load link graph", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // settingsNodeSize intentionally omitted: adding it would re-fetch all
    // graph data on every settings tweak; the node-size effect in GraphView
    // handles size updates incrementally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rootPath,
    indexVersion,
    handleNodeTap,
    colorByNamespace,
    cyReady,
    graphScope,
    contexts,
  ]);

  // §286 숨은 동안 건너뛴 측정을 다시 보이는 순간 한 번 한다.
  //
  // ‼️ 이걸 populate effect의 deps에 `active`를 넣어 해결하려 했다가, **탭 전환마다 링크
  // 그래프를 다시 가져오고 요소 119개를 다시 만드는** 회귀를 만들었다(계측 로그에서
  // `populate`가 전환마다 두 번 찍혔다). 측정은 측정만 다시 하면 된다.
  // §286 카메라를 기억했다 되돌린다.
  //
  // ‼️ 실측이 원인을 특정했다: 탭을 오갈 때 **노드는 그대로고 카메라만 움직인다.** MD를 오갈
  // 때마다 pan이 조금씩 밀리고(402,443 → 407,66 → 454,208), PDF를 다녀오면 zoom 1 / pan 0,0 —
  // cytoscape의 손대지 않은 초기 뷰포트 — 로 되돌아간다. 그리고 그 값은 우리 `cy.resize()`
  // **이전에** 이미 그렇다. 컨테이너가 0×0이 되면 라이브러리가 스스로 카메라를 흔든다.
  //
  // 우리 게이트는 *우리* 호출만 막을 수 있으므로, §291과 같은 결론을 쓴다: 지킬 수 없는
  // 상태는 기억했다 되돌린다. 기록은 viewport 이벤트로(숨는 순간에 읽으면 이미 늦다),
  // 복원은 보이게 된 직후에.
  const cameraRef = useRef<GraphViewport | null>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const remember = () => {
      const vp = { pan: cy.pan(), zoom: cy.zoom() };
      if (isUsableViewport(vp)) cameraRef.current = vp;
    };
    cy.on("viewport", remember);
    return () => void cy.off("viewport", remember);
  }, [cyRef, cyReady]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!shouldRunViewportWork(active, boxOf(cy.container()))) return;
    cy.resize();
    const saved = cameraRef.current;
    if (!saved) return;
    cy.viewport({ pan: saved.pan, zoom: saved.zoom });
  }, [active, cyRef, cyReady]);

  return { edgeCount, graphEpoch, nodeCount };
}
